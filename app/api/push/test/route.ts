import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    // Check VAPID configuration
    const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
    const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:hello@spinthechat.com'

    // Debug: check env var presence (never log values)
    console.log('[push/test] ENV check:', {
      hasVapidPublic: !!VAPID_PUBLIC_KEY,
      hasVapidPrivate: !!VAPID_PRIVATE_KEY,
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    })

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

    // Get the authorization header (Supabase JWT)
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')

    // Verify the user via Supabase
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Get user's push subscriptions
    const { data: subscriptions, error: fetchError } = await supabaseAdmin
      .rpc('get_user_push_subscriptions', { p_user_id: user.id })

    if (fetchError) {
      console.error('Error fetching subscriptions:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 })
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('[push/test] No subscriptions found for user:', user.id)
      return NextResponse.json({ error: 'No push subscriptions found. Enable notifications first.' }, { status: 400 })
    }

    console.log('[push/test] Found', subscriptions.length, 'subscription(s)')

    // Prepare test notification payload
    const payload = JSON.stringify({
      title: 'Spin the Chat',
      body: 'Test notification - Push is working!',
      tag: 'test-notification',
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
          const error = err as { statusCode?: number; message?: string }
          console.log('[push/test] Send failed:', { statusCode: error.statusCode, message: error.message })
          if (error.statusCode === 404 || error.statusCode === 410) {
            console.log('[push/test] Removing expired subscription:', sub.id)
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

    return NextResponse.json({
      success: true,
      sent,
      total: subscriptions.length,
      message: sent > 0 ? 'Test notification sent!' : 'No notifications delivered',
    })
  } catch (err) {
    console.error('Test push error:', err)
    return NextResponse.json({ error: 'Failed to send test push' }, { status: 500 })
  }
}
