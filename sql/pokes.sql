-- ============================================
-- POKES FEATURE
-- ============================================
-- Lightweight social interaction - "poke" another user
-- Rate limited: max 1 poke per user per 24 hours

-- ============================================
-- Pokes Table
-- ============================================
CREATE TABLE IF NOT EXISTS pokes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  poked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevent self-pokes
  CONSTRAINT no_self_poke CHECK (poker_id != poked_id)
);

-- Index for rate limiting lookup
CREATE INDEX IF NOT EXISTS idx_pokes_rate_limit ON pokes(poker_id, poked_id, created_at DESC);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE pokes ENABLE ROW LEVEL SECURITY;

-- Users can read pokes they sent or received
CREATE POLICY "Users can read own pokes"
  ON pokes FOR SELECT
  USING (poker_id = auth.uid() OR poked_id = auth.uid());

-- No direct inserts - use RPC only
-- ============================================
-- Update notification types to include poke
-- ============================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS valid_notification_type;
ALTER TABLE notifications ADD CONSTRAINT valid_notification_type CHECK (type IN (
  'followed_you',
  'unfollowed_you',
  'group_invite',
  'added_to_group',
  'removed_from_group',
  'your_turn',
  'nudged_you',
  'turn_skipped',
  'turn_completed',
  'story_reply',
  'story_view_milestone',
  'upvote_milestone',
  'upvote_whole_group',
  'poked_you'
));

-- ============================================
-- Send Poke Function
-- Rate limited: 1 poke per target per 24 hours
-- Returns: { success: boolean, error?: string }
-- ============================================
CREATE OR REPLACE FUNCTION send_poke(p_target_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_poker_id UUID := auth.uid();
  v_last_poke TIMESTAMPTZ;
  v_hours_remaining INT;
BEGIN
  -- Validate auth
  IF v_poker_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Not authenticated');
  END IF;

  -- Can't poke yourself
  IF v_poker_id = p_target_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Cannot poke yourself');
  END IF;

  -- Check if target user exists
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_id) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'User not found');
  END IF;

  -- Check rate limit (24 hours)
  SELECT created_at INTO v_last_poke
  FROM pokes
  WHERE poker_id = v_poker_id
    AND poked_id = p_target_id
    AND created_at > now() - INTERVAL '24 hours'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_last_poke IS NOT NULL THEN
    v_hours_remaining := CEIL(EXTRACT(EPOCH FROM (v_last_poke + INTERVAL '24 hours' - now())) / 3600);
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Rate limited',
      'hours_remaining', v_hours_remaining
    );
  END IF;

  -- Insert poke record
  INSERT INTO pokes (poker_id, poked_id)
  VALUES (v_poker_id, p_target_id);

  -- Create notification for the poked user
  INSERT INTO notifications (user_id, actor_user_id, type, metadata)
  VALUES (
    p_target_id,
    v_poker_id,
    'poked_you',
    jsonb_build_object('poked_at', now())
  );

  RETURN jsonb_build_object('success', TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Check if can poke (for UI state)
-- Returns: { can_poke: boolean, hours_remaining?: number }
-- ============================================
CREATE OR REPLACE FUNCTION can_poke(p_target_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_poker_id UUID := auth.uid();
  v_last_poke TIMESTAMPTZ;
  v_hours_remaining INT;
BEGIN
  IF v_poker_id IS NULL THEN
    RETURN jsonb_build_object('can_poke', FALSE);
  END IF;

  IF v_poker_id = p_target_id THEN
    RETURN jsonb_build_object('can_poke', FALSE);
  END IF;

  -- Check rate limit
  SELECT created_at INTO v_last_poke
  FROM pokes
  WHERE poker_id = v_poker_id
    AND poked_id = p_target_id
    AND created_at > now() - INTERVAL '24 hours'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_last_poke IS NOT NULL THEN
    v_hours_remaining := CEIL(EXTRACT(EPOCH FROM (v_last_poke + INTERVAL '24 hours' - now())) / 3600);
    RETURN jsonb_build_object('can_poke', FALSE, 'hours_remaining', v_hours_remaining);
  END IF;

  RETURN jsonb_build_object('can_poke', TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Check if user has active story
-- ============================================
CREATE OR REPLACE FUNCTION user_has_active_story(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM stories
    WHERE user_id = p_user_id
      AND expires_at > now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
