-- ============================================
-- Message Notifications: Preferences + Rate Limiting
-- ============================================

-- 1. User notification preferences per room
CREATE TABLE IF NOT EXISTS notification_prefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  turn_notifs_enabled BOOLEAN NOT NULL DEFAULT true,
  message_notifs_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, room_id)
);

-- 2. Rate limiting for message notifications
CREATE TABLE IF NOT EXISTS notification_rate_limit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pending_count INT NOT NULL DEFAULT 0,
  UNIQUE(user_id, room_id)
);

-- 3. Enable RLS
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rate_limit ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies for notification_prefs
DROP POLICY IF EXISTS "Users can view own notification prefs" ON notification_prefs;
CREATE POLICY "Users can view own notification prefs" ON notification_prefs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own notification prefs" ON notification_prefs;
CREATE POLICY "Users can insert own notification prefs" ON notification_prefs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notification prefs" ON notification_prefs;
CREATE POLICY "Users can update own notification prefs" ON notification_prefs
  FOR UPDATE USING (auth.uid() = user_id);

-- 5. RLS policies for notification_rate_limit (service role only for writes)
DROP POLICY IF EXISTS "Users can view own rate limits" ON notification_rate_limit;
CREATE POLICY "Users can view own rate limits" ON notification_rate_limit
  FOR SELECT USING (auth.uid() = user_id);

-- 6. Function to get or create notification prefs for a room
CREATE OR REPLACE FUNCTION get_notification_prefs(p_room_id UUID)
RETURNS TABLE(turn_notifs_enabled BOOLEAN, message_notifs_enabled BOOLEAN) AS $$
BEGIN
  -- Insert default prefs if not exists
  INSERT INTO notification_prefs (user_id, room_id)
  VALUES (auth.uid(), p_room_id)
  ON CONFLICT (user_id, room_id) DO NOTHING;

  -- Return the prefs
  RETURN QUERY
  SELECT np.turn_notifs_enabled, np.message_notifs_enabled
  FROM notification_prefs np
  WHERE np.user_id = auth.uid() AND np.room_id = p_room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Function to update notification prefs
CREATE OR REPLACE FUNCTION update_notification_prefs(
  p_room_id UUID,
  p_turn_notifs_enabled BOOLEAN DEFAULT NULL,
  p_message_notifs_enabled BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Ensure prefs exist
  INSERT INTO notification_prefs (user_id, room_id)
  VALUES (auth.uid(), p_room_id)
  ON CONFLICT (user_id, room_id) DO NOTHING;

  -- Update only provided fields
  UPDATE notification_prefs
  SET
    turn_notifs_enabled = COALESCE(p_turn_notifs_enabled, turn_notifs_enabled),
    message_notifs_enabled = COALESCE(p_message_notifs_enabled, message_notifs_enabled),
    updated_at = NOW()
  WHERE user_id = auth.uid() AND room_id = p_room_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Function to get room members with their notification prefs (for server-side use)
-- This is called by the API route with service role key
CREATE OR REPLACE FUNCTION get_room_members_for_notification(
  p_room_id UUID,
  p_exclude_user_id UUID
)
RETURNS TABLE(
  user_id UUID,
  message_notifs_enabled BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    rm.user_id,
    COALESCE(np.message_notifs_enabled, true) as message_notifs_enabled
  FROM room_members rm
  LEFT JOIN notification_prefs np ON np.user_id = rm.user_id AND np.room_id = rm.room_id
  WHERE rm.room_id = p_room_id
    AND rm.user_id != p_exclude_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Function to check and update rate limit (returns true if notification should be sent)
-- Called with service role key
CREATE OR REPLACE FUNCTION check_message_notification_rate_limit(
  p_user_id UUID,
  p_room_id UUID,
  p_rate_limit_seconds INT DEFAULT 60
)
RETURNS TABLE(
  should_send BOOLEAN,
  pending_count INT
) AS $$
DECLARE
  v_last_sent TIMESTAMPTZ;
  v_pending INT;
  v_should_send BOOLEAN;
BEGIN
  -- Get or create rate limit record
  INSERT INTO notification_rate_limit (user_id, room_id, last_sent_at, pending_count)
  VALUES (p_user_id, p_room_id, NOW() - INTERVAL '1 day', 0)
  ON CONFLICT (user_id, room_id) DO NOTHING;

  -- Get current state
  SELECT nrl.last_sent_at, nrl.pending_count
  INTO v_last_sent, v_pending
  FROM notification_rate_limit nrl
  WHERE nrl.user_id = p_user_id AND nrl.room_id = p_room_id;

  -- Check if enough time has passed
  IF v_last_sent + (p_rate_limit_seconds || ' seconds')::INTERVAL < NOW() THEN
    -- Can send notification
    v_should_send := true;
    -- Reset pending count and update last_sent
    UPDATE notification_rate_limit nrl
    SET last_sent_at = NOW(), pending_count = 0
    WHERE nrl.user_id = p_user_id AND nrl.room_id = p_room_id;
    v_pending := 0;
  ELSE
    -- Rate limited, increment pending count
    v_should_send := false;
    UPDATE notification_rate_limit nrl
    SET pending_count = pending_count + 1
    WHERE nrl.user_id = p_user_id AND nrl.room_id = p_room_id;
    v_pending := v_pending + 1;
  END IF;

  RETURN QUERY SELECT v_should_send, v_pending;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
