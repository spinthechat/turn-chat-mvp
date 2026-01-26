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
      return NextResponse.json({ sent: 0, message: 'VAPID not configured' })
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

    // Check Supabase configuration
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ sent: 0, message: 'Supabase not configured' })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

    const body = await request.json()
    const { roomId } = body

    if (!roomId) {
      return NextResponse.json({ error: 'Missing roomId' }, { status: 400 })
    }

    // Get the current turn user and room info
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('turn_sessions')
      .select('current_turn_user_id, room_id')
      .eq('room_id', roomId)
      .eq('is_active', true)
      .single()

    if (sessionError || !session?.current_turn_user_id) {
      return NextResponse.json({ sent: 0, message: 'No active turn session' })
    }

    // Get room name
    const { data: room } = await supabaseAdmin
      .from('rooms')
      .select('name')
      .eq('id', roomId)
      .single()

    const roomName = room?.name || 'Spin the Chat'
    const userId = session.current_turn_user_id

    // Get user's push subscriptions
    const { data: subscriptions, error: fetchError } = await supabaseAdmin
      .rpc('get_user_push_subscriptions', { p_user_id: userId })

    if (fetchError || !subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ sent: 0, message: 'No subscriptions for user' })
    }

    // Prepare notification payload
    const payload = JSON.stringify({
      title: roomName,
      body: "It's your turn!",
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

    return NextResponse.json({ sent, total: subscriptions.length })
  } catch (err) {
    console.error('Notify turn error:', err)
    return NextResponse.json({ sent: 0, error: 'Failed to send' })
  }
}
