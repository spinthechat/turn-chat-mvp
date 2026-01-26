-- ============================================
-- Nudge Feature: Once-per-turn nudge to current turn user
-- ============================================

-- 1. Create nudges table (with turn_index for per-turn scoping)
CREATE TABLE IF NOT EXISTS nudges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  nudger_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nudged_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Migration: Add turn_index column if table already exists without it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nudges' AND column_name = 'nudge_date')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nudges' AND column_name = 'turn_index') THEN
    -- Add new column
    ALTER TABLE nudges ADD COLUMN turn_index INTEGER;
    -- Set default value for existing rows (they'll be considered old/invalid anyway)
    UPDATE nudges SET turn_index = 0 WHERE turn_index IS NULL;
    -- Make it NOT NULL
    ALTER TABLE nudges ALTER COLUMN turn_index SET NOT NULL;
    -- Drop old column
    ALTER TABLE nudges DROP COLUMN nudge_date;
  END IF;
END $$;

-- 3. Drop old index if exists, create new unique index for once-per-turn enforcement
DROP INDEX IF EXISTS nudges_once_per_day_idx;
CREATE UNIQUE INDEX IF NOT EXISTS nudges_once_per_turn_idx
  ON nudges (room_id, nudger_user_id, turn_index);

-- 4. Index for querying user's nudges
DROP INDEX IF EXISTS nudges_nudger_idx;
CREATE INDEX IF NOT EXISTS nudges_nudger_idx ON nudges (nudger_user_id, room_id, turn_index);

-- 5. Enable RLS
ALTER TABLE nudges ENABLE ROW LEVEL SECURITY;

-- 6. RLS policies
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

-- 7. Function to check if user has nudged this turn in a room
DROP FUNCTION IF EXISTS has_nudged_today(UUID);
CREATE OR REPLACE FUNCTION has_nudged_this_turn(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_current_turn_index INTEGER;
BEGIN
  -- Get current turn index from active session
  SELECT current_turn_index INTO v_current_turn_index
  FROM turn_sessions
  WHERE room_id = p_room_id AND is_active = true;

  -- If no active session, return false (can't have nudged a non-existent turn)
  IF v_current_turn_index IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM nudges
    WHERE room_id = p_room_id
      AND nudger_user_id = auth.uid()
      AND turn_index = v_current_turn_index
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Main nudge function - validates and records the nudge (scoped to current turn)
CREATE OR REPLACE FUNCTION send_nudge(p_room_id UUID)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
  v_current_turn_user_id UUID;
  v_current_turn_index INTEGER;
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

  -- Get current turn user and index from active session
  SELECT current_turn_user_id, current_turn_index
  INTO v_current_turn_user_id, v_current_turn_index
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

  -- Try to insert the nudge (will fail if already nudged this turn due to unique constraint)
  BEGIN
    INSERT INTO nudges (room_id, nudger_user_id, nudged_user_id, turn_index)
    VALUES (p_room_id, caller_id, v_current_turn_user_id, v_current_turn_index);
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('success', false, 'error', 'Already nudged this turn');
  END;

  RETURN json_build_object(
    'success', true,
    'nudged_user_id', v_current_turn_user_id,
    'room_name', v_room_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
