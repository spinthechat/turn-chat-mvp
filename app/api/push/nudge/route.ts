import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    // Check VAPID configuration
    const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
    const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:hello@spinthechat.com'

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return NextResponse.json({ success: false, error: 'VAPID not configured' }, { status: 500 })
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

    // Check Supabase configuration
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 })
    }

    // Get the user's access token from Authorization header
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Missing authorization' }, { status: 401 })
    }
    const accessToken = authHeader.slice(7)

    // Create a client with the user's token to call the RPC (respects RLS)
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    })

    // Create admin client for push subscriptions lookup
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    const body = await request.json()
    const { roomId } = body

    if (!roomId) {
      return NextResponse.json({ success: false, error: 'Missing roomId' }, { status: 400 })
    }

    // Call the send_nudge RPC (handles validation, rate limiting, and recording)
    const { data: nudgeResult, error: nudgeError } = await supabaseUser
      .rpc('send_nudge', { p_room_id: roomId })

    if (nudgeError) {
      console.error('Nudge RPC error:', nudgeError)
      return NextResponse.json({ success: false, error: 'Failed to send nudge' }, { status: 500 })
    }

    if (!nudgeResult.success) {
      return NextResponse.json({ success: false, error: nudgeResult.error })
    }

    const { nudged_user_id, room_name } = nudgeResult

    // Get the nudged user's push subscriptions
    const { data: subscriptions, error: subError } = await supabaseAdmin
      .rpc('get_user_push_subscriptions', { p_user_id: nudged_user_id })

    if (subError || !subscriptions || subscriptions.length === 0) {
      // Nudge was recorded but user has no push subscriptions
      return NextResponse.json({
        success: true,
        sent: false,
        message: 'Nudge recorded but user has notifications off'
      })
    }

    // Prepare notification payload
    const payload = JSON.stringify({
      title: room_name || 'Spin the Chat',
      body: "👀 Nudge — it's your turn!",
      roomId,
      url: `/room/${roomId}`,
      tag: `nudge-${roomId}`,
    })

    // Send to all subscriptions
    let sent = 0
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
          return { success: true }
        } catch (err: unknown) {
          const error = err as { statusCode?: number }
          if (error.statusCode === 404 || error.statusCode === 410) {
            // Subscription expired, clean up
            await supabaseAdmin
              .from('push_subscriptions')
              .delete()
              .eq('id', sub.id)
          }
          return { success: false }
        }
      })
    )

    sent = results.filter(r => r.status === 'fulfilled' && (r.value as { success: boolean }).success).length

    return NextResponse.json({ success: true, sent: sent > 0 })
  } catch (err) {
    console.error('Nudge API error:', err)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
