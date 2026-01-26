-- ============================================
-- FIX: Make turn_index nullable since we now use turn_instance_id
-- ============================================

-- 1. Make turn_index nullable (it may have been NOT NULL from old schema)
ALTER TABLE nudges ALTER COLUMN turn_index DROP NOT NULL;

-- 2. Ensure turn_instance_id column exists
ALTER TABLE nudges ADD COLUMN IF NOT EXISTS turn_instance_id UUID;

-- 3. Recreate the send_nudge function to be explicit about columns
CREATE OR REPLACE FUNCTION send_nudge(p_room_id UUID)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
  v_current_turn_user_id UUID;
  v_turn_instance_id UUID;
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

  -- Get current turn user and turn_instance_id from active session
  SELECT current_turn_user_id, turn_instance_id
  INTO v_current_turn_user_id, v_turn_instance_id
  FROM turn_sessions
  WHERE room_id = p_room_id AND is_active = true;

  IF v_current_turn_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No active turn session');
  END IF;

  -- If turn_instance_id is null, generate one now (legacy session)
  IF v_turn_instance_id IS NULL THEN
    v_turn_instance_id := gen_random_uuid();
    UPDATE turn_sessions
    SET turn_instance_id = v_turn_instance_id
    WHERE room_id = p_room_id AND is_active = true;
  END IF;

  -- Block self-nudge
  IF v_current_turn_user_id = caller_id THEN
    RETURN json_build_object('success', false, 'error', 'Cannot nudge yourself');
  END IF;

  -- Get room name
  SELECT name INTO v_room_name FROM rooms WHERE id = p_room_id;

  -- Try to insert the nudge (will fail if already nudged this turn instance)
  BEGIN
    INSERT INTO nudges (room_id, nudger_user_id, nudged_user_id, turn_instance_id, created_at)
    VALUES (p_room_id, caller_id, v_current_turn_user_id, v_turn_instance_id, NOW());
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

-- 4. Ensure the unique index exists
DROP INDEX IF EXISTS nudges_per_turn_instance_idx;
CREATE UNIQUE INDEX nudges_per_turn_instance_idx
  ON nudges (room_id, nudger_user_id, turn_instance_id);
