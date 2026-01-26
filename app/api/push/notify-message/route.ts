import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

interface NotifyMessagePayload {
  roomId: string
  messageId: string
  senderId: string
}

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

    const body: NotifyMessagePayload = await request.json()
    const { roomId, messageId, senderId } = body

    if (!roomId || !messageId || !senderId) {
      return NextResponse.json({ error: 'Missing roomId, messageId, or senderId' }, { status: 400 })
    }

    // Get the message details
    const { data: message, error: messageError } = await supabaseAdmin
      .from('messages')
      .select('content, type, user_id')
      .eq('id', messageId)
      .single()

    if (messageError || !message) {
      return NextResponse.json({ sent: 0, message: 'Message not found' })
    }

    // Get room name
    const { data: room } = await supabaseAdmin
      .from('rooms')
      .select('name')
      .eq('id', roomId)
      .single()

    const roomName = room?.name || 'Spin the Chat'

    // Get sender info for notification body
    const { data: sender } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', senderId)
      .single()

    const senderName = sender?.display_name || 'Someone'

    // Format notification body based on message type
    let messagePreview: string
    if (message.type === 'image') {
      messagePreview = `${senderName}: Sent a photo`
    } else if (message.type === 'turn_response') {
      // Check if it's a photo turn
      try {
        const parsed = JSON.parse(message.content)
        if (parsed.kind === 'photo_turn') {
          messagePreview = `${senderName}: Sent a photo`
        } else {
          messagePreview = `${senderName}: ${message.content.slice(0, 80)}${message.content.length > 80 ? '...' : ''}`
        }
      } catch {
        messagePreview = `${senderName}: ${message.content.slice(0, 80)}${message.content.length > 80 ? '...' : ''}`
      }
    } else {
      messagePreview = `${senderName}: ${message.content.slice(0, 80)}${message.content.length > 80 ? '...' : ''}`
    }

    // Get room members with their notification preferences (excluding sender)
    const { data: members, error: membersError } = await supabaseAdmin
      .rpc('get_room_members_for_notification', {
        p_room_id: roomId,
        p_exclude_user_id: senderId
      })

    if (membersError || !members || members.length === 0) {
      return NextResponse.json({ sent: 0, message: 'No eligible members' })
    }

    // Filter members who have message notifications enabled
    const eligibleMembers = members.filter((m: { message_notifs_enabled: boolean }) => m.message_notifs_enabled)

    if (eligibleMembers.length === 0) {
      return NextResponse.json({ sent: 0, message: 'All members have notifications disabled' })
    }

    // Check rate limits and send notifications
    let sent = 0
    const RATE_LIMIT_SECONDS = 60

    for (const member of eligibleMembers) {
      // Check rate limit
      const { data: rateLimitResult } = await supabaseAdmin
        .rpc('check_message_notification_rate_limit', {
          p_user_id: member.user_id,
          p_room_id: roomId,
          p_rate_limit_seconds: RATE_LIMIT_SECONDS
        })

      if (!rateLimitResult || rateLimitResult.length === 0) continue

      const { should_send, pending_count } = rateLimitResult[0]

      if (!should_send) {
        // Rate limited, skip this user
        continue
      }

      // Get user's push subscriptions
      const { data: subscriptions } = await supabaseAdmin
        .rpc('get_user_push_subscriptions', { p_user_id: member.user_id })

      if (!subscriptions || subscriptions.length === 0) continue

      // Build notification body (include pending count if any)
      let notificationBody = messagePreview
      if (pending_count > 0) {
        notificationBody = `${messagePreview} (+${pending_count} more)`
      }

      // Prepare notification payload
      const payload = JSON.stringify({
        title: roomName,
        body: notificationBody,
        roomId,
        url: `/room/${roomId}`,
        tag: `message-${roomId}`,
      })

      // Send to all subscriptions for this user
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

      const userSent = results.filter(r => r.status === 'fulfilled' && (r.value as { success: boolean }).success).length
      if (userSent > 0) sent++
    }

    return NextResponse.json({ sent, total: eligibleMembers.length })
  } catch (err) {
    console.error('Notify message error:', err)
    return NextResponse.json({ sent: 0, error: 'Failed to send' })
  }
}
