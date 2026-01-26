import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

interface PushPayload {
  userId: string
  roomId: string
  roomName: string
  message?: string
}

export async function POST(request: NextRequest) {
  try {
    // Verify this is an internal call (from our server)
    const authHeader = request.headers.get('authorization')
    const expectedToken = process.env.INTERNAL_API_SECRET

    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check VAPID configuration
    const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
    const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:hello@spinthechat.com'

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 500 })
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

    // Check Supabase configuration
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

    const body: PushPayload = await request.json()
    const { userId, roomId, roomName, message } = body

    if (!userId || !roomId) {
      return NextResponse.json({ error: 'Missing userId or roomId' }, { status: 400 })
    }

    // Get user's push subscriptions
    const { data: subscriptions, error: fetchError } = await supabaseAdmin
      .rpc('get_user_push_subscriptions', { p_user_id: userId })

    if (fetchError) {
      console.error('Error fetching subscriptions:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 })
    }

    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ sent: 0, message: 'No subscriptions found' })
    }

    // Prepare notification payload
    const payload = JSON.stringify({
      title: roomName || 'Spin the Chat',
      body: message || "It's your turn!",
      roomId,
      url: `/room/${roomId}`,
      tag: `turn-${roomId}`,
    })

    // Send to all subscriptions
    const results = await Promise.allSettled(
      subscriptions.map(async (sub: { id: string; endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            payload
          )
          return { success: true, id: sub.id }
        } catch (err: unknown) {
          const error = err as { statusCode?: number }
          if (error.statusCode === 404 || error.statusCode === 410) {
            await supabaseAdmin
              .from('push_subscriptions')
              .delete()
              .eq('id', sub.id)
            return { success: false, id: sub.id, expired: true }
          }
          throw err
        }
      })
    )

    const sent = results.filter((r) => r.status === 'fulfilled' && (r.value as { success: boolean }).success).length
    const failed = results.length - sent

    return NextResponse.json({ sent, failed, total: subscriptions.length })
  } catch (err) {
    console.error('Push send error:', err)
    return NextResponse.json({ error: 'Failed to send push' }, { status: 500 })
  }
}
