-- ============================================
-- Last Seen / Last Active Tracking
-- ============================================

-- Add last_seen_at column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS profiles_last_seen_idx ON profiles (last_seen_at DESC NULLS LAST);

-- ============================================
-- Update last_seen_at function
-- ============================================

-- Call this on: app open, sending message, replying to prompt, story interaction
CREATE OR REPLACE FUNCTION update_last_seen()
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  UPDATE profiles
  SET last_seen_at = NOW()
  WHERE id = v_user_id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Get last seen for a user (with privacy rules)
-- ============================================

-- Returns last_seen_at if:
-- 1. Viewing own profile
-- 2. Sharing a group or DM with the user
-- Otherwise returns NULL (privacy protection)
CREATE OR REPLACE FUNCTION get_last_seen(p_user_id UUID)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_last_seen TIMESTAMPTZ;
  v_shares_room BOOLEAN;
BEGIN
  -- If viewing own profile, always return
  IF v_caller_id = p_user_id THEN
    SELECT last_seen_at INTO v_last_seen
    FROM profiles
    WHERE id = p_user_id;
    RETURN v_last_seen;
  END IF;

  -- Check if they share any room (group or DM)
  SELECT EXISTS (
    SELECT 1
    FROM room_members rm1
    JOIN room_members rm2 ON rm1.room_id = rm2.room_id
    WHERE rm1.user_id = v_caller_id
    AND rm2.user_id = p_user_id
  ) INTO v_shares_room;

  IF v_shares_room THEN
    SELECT last_seen_at INTO v_last_seen
    FROM profiles
    WHERE id = p_user_id;
    RETURN v_last_seen;
  END IF;

  -- No shared room - return NULL for privacy
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Grant permissions
-- ============================================

GRANT EXECUTE ON FUNCTION update_last_seen() TO authenticated;
GRANT EXECUTE ON FUNCTION get_last_seen(UUID) TO authenticated;
