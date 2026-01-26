-- ============================================
-- Nudge Feature: Once-per-day nudge to current turn user
-- ============================================

-- 1. Create nudges table
CREATE TABLE IF NOT EXISTS nudges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  nudger_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nudged_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  nudge_date DATE NOT NULL DEFAULT (CURRENT_DATE)
);

-- 2. Create unique index for once-per-day-per-room enforcement
CREATE UNIQUE INDEX IF NOT EXISTS nudges_once_per_day_idx
  ON nudges (room_id, nudger_user_id, nudge_date);

-- 3. Index for querying user's nudges
CREATE INDEX IF NOT EXISTS nudges_nudger_idx ON nudges (nudger_user_id, room_id, nudge_date);

-- 4. Enable RLS
ALTER TABLE nudges ENABLE ROW LEVEL SECURITY;

-- 5. RLS policies
DROP POLICY IF EXISTS "Users can view nudges in their rooms" ON nudges;
CREATE POLICY "Users can view nudges in their rooms" ON nudges
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM room_members rm
      WHERE rm.room_id = nudges.room_id AND rm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert nudges in their rooms" ON nudges;
CREATE POLICY "Users can insert nudges in their rooms" ON nudges
  FOR INSERT WITH CHECK (
    nudger_user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM room_members rm
      WHERE rm.room_id = nudges.room_id AND rm.user_id = auth.uid()
    )
  );

-- 6. Function to check if user has nudged today in a room
CREATE OR REPLACE FUNCTION has_nudged_today(p_room_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM nudges
    WHERE room_id = p_room_id
      AND nudger_user_id = auth.uid()
      AND nudge_date = CURRENT_DATE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Main nudge function - validates and records the nudge
CREATE OR REPLACE FUNCTION send_nudge(p_room_id UUID)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
  v_current_turn_user_id UUID;
  v_room_name TEXT;
  v_is_member BOOLEAN;
BEGIN
  -- Check authentication
  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Check caller is a member of the room
  SELECT EXISTS (
    SELECT 1 FROM room_members WHERE room_id = p_room_id AND user_id = caller_id
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RETURN json_build_object('success', false, 'error', 'Not a member of this room');
  END IF;

  -- Get current turn user from active session
  SELECT current_turn_user_id INTO v_current_turn_user_id
  FROM turn_sessions
  WHERE room_id = p_room_id AND is_active = true;

  IF v_current_turn_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No active turn session');
  END IF;

  -- Block self-nudge
  IF v_current_turn_user_id = caller_id THEN
    RETURN json_build_object('success', false, 'error', 'Cannot nudge yourself');
  END IF;

  -- Get room name
  SELECT name INTO v_room_name FROM rooms WHERE id = p_room_id;

  -- Try to insert the nudge (will fail if already nudged today due to unique constraint)
  BEGIN
    INSERT INTO nudges (room_id, nudger_user_id, nudged_user_id)
    VALUES (p_room_id, caller_id, v_current_turn_user_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('success', false, 'error', 'Already nudged today');
  END;

  RETURN json_build_object(
    'success', true,
    'nudged_user_id', v_current_turn_user_id,
    'room_name', v_room_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
