import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Vercel Cron: runs every 15 minutes
// Add to vercel.json: { "crons": [{ "path": "/api/cron/auto-skip", "schedule": "*/15 * * * *" }] }

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (Vercel adds this header for cron jobs)
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    // In production, verify the request is from Vercel Cron
    if (process.env.NODE_ENV === 'production' && cronSecret) {
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Call the process_stalled_turns function
    const { data, error } = await supabase.rpc('process_stalled_turns')

    if (error) {
      console.error('[auto-skip] Error processing stalled turns:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const skipped = data || []

    if (skipped.length > 0) {
      console.log(`[auto-skip] Processed ${skipped.length} stalled turns:`, skipped)

      // Send push notifications for skipped turns
      for (const skip of skipped) {
        try {
          // Notify the next user that it's their turn
          await notifyNextUser(supabase, skip.room_id)

          // If user was removed, we could send them a notification too
          if (skip.removed) {
            console.log(`[auto-skip] User ${skip.skipped_user_id} was removed from room ${skip.room_id}`)
          }
        } catch (notifyErr) {
          console.error('[auto-skip] Error sending notification:', notifyErr)
        }
      }
    }

    return NextResponse.json({
      success: true,
      processed: skipped.length,
      skipped: skipped
    })
  } catch (err) {
    console.error('[auto-skip] Cron job error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function notifyNextUser(supabase: any, roomId: string) {
  // Get the current turn user
  const { data: session } = await supabase
    .from('turn_sessions')
    .select('current_turn_user_id, prompt_text')
    .eq('room_id', roomId)
    .eq('is_active', true)
    .single()

  if (!session?.current_turn_user_id) return

  // Get room name
  const { data: room } = await supabase
    .from('rooms')
    .select('name')
    .eq('id', roomId)
    .single()

  // Get user's push subscriptions
  const { data: subscriptions } = await supabase
    .rpc('get_user_push_subscriptions', { p_user_id: session.current_turn_user_id })

  if (!subscriptions || subscriptions.length === 0) return

  // We'd need webpush here - for now just log
  console.log(`[auto-skip] Would notify user ${session.current_turn_user_id} for room ${roomId}`)
}

// Also support POST for manual triggering
export async function POST(request: NextRequest) {
  return GET(request)
}
