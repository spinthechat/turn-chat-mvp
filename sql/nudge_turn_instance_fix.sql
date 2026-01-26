-- ============================================
-- FIX: Nudge per-turn reset with turn_instance_id
-- ============================================
-- This migration introduces turn_instance_id (UUID) that changes
-- every time a turn advances, enabling proper nudge reset behavior.

-- ============================================
-- PART 1: Add turn_instance_id to turn_sessions
-- ============================================

-- 1. Add column to turn_sessions
ALTER TABLE turn_sessions ADD COLUMN IF NOT EXISTS turn_instance_id UUID;

-- 2. Set default for existing sessions
UPDATE turn_sessions SET turn_instance_id = gen_random_uuid() WHERE turn_instance_id IS NULL;

-- ============================================
-- PART 2: Update nudges table to use turn_instance_id
-- ============================================

-- 3. Add turn_instance_id column to nudges
ALTER TABLE nudges ADD COLUMN IF NOT EXISTS turn_instance_id UUID;

-- 4. Drop old constraints/indexes that used turn_index
DROP INDEX IF EXISTS nudges_once_per_turn_idx;
DROP INDEX IF EXISTS nudges_nudger_idx;
DROP INDEX IF EXISTS nudges_room_turn_idx;

-- 5. Create new unique index for per-turn-instance enforcement
CREATE UNIQUE INDEX IF NOT EXISTS nudges_per_turn_instance_idx
  ON nudges (room_id, nudger_user_id, turn_instance_id);

-- 6. Create index for querying
CREATE INDEX IF NOT EXISTS nudges_lookup_idx
  ON nudges (nudger_user_id, room_id, turn_instance_id);

-- ============================================
-- PART 3: Update turn advancement functions to generate new turn_instance_id
-- ============================================

-- 7. Update start_session to generate turn_instance_id
CREATE OR REPLACE FUNCTION start_session(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  member_ids UUID[];
  first_user_id UUID;
  first_prompt_text TEXT;
  first_prompt_type TEXT;
  v_prompt_mode TEXT;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify caller is host
  IF NOT EXISTS (
    SELECT 1 FROM room_members
    WHERE room_id = p_room_id AND user_id = caller_id AND role = 'host'
  ) THEN
    RAISE EXCEPTION 'Only the host can start a session';
  END IF;

  -- End any existing session
  UPDATE turn_sessions SET is_active = false WHERE room_id = p_room_id AND is_active = true;

  -- Get ALL current members ordered by user_id
  SELECT array_agg(user_id ORDER BY user_id) INTO member_ids
  FROM room_members WHERE room_id = p_room_id;

  IF array_length(member_ids, 1) < 2 THEN
    RAISE EXCEPTION 'Need at least 2 members to start';
  END IF;

  first_user_id := member_ids[1];

  -- Get room's prompt mode
  SELECT COALESCE(prompt_mode, 'fun') INTO v_prompt_mode FROM rooms WHERE id = p_room_id;

  -- Pick a random prompt based on room's mode
  SELECT text, COALESCE(prompt_type, 'text') INTO first_prompt_text, first_prompt_type
  FROM prompts
  WHERE mode = v_prompt_mode OR mode IS NULL
  ORDER BY random() LIMIT 1;

  -- Delete old session if exists
  DELETE FROM turn_sessions WHERE room_id = p_room_id;

  -- Create session with turn_instance_id
  INSERT INTO turn_sessions (
    room_id,
    prompt_text,
    current_prompt_type,
    turn_order,
    current_turn_index,
    current_turn_user_id,
    turn_instance_id,
    is_active,
    waiting_until
  )
  VALUES (
    p_room_id,
    first_prompt_text,
    first_prompt_type,
    member_ids,
    0,
    first_user_id,
    gen_random_uuid(),  -- NEW: Generate turn_instance_id
    true,
    NULL
  );

  -- System message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, NULL, 'system', 'Game started!');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Update submit_turn to generate new turn_instance_id on advancement
CREATE OR REPLACE FUNCTION submit_turn(p_room_id UUID, p_content TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  sess RECORD;
  room_interval INT;
  next_user_id UUID;
  new_prompt_text TEXT;
  new_prompt_type TEXT;
  next_waiting_until TIMESTAMPTZ;
  curr_turn_user UUID;
  all_members UUID[];
  v_prompt_mode TEXT;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get active session
  SELECT * INTO sess FROM turn_sessions WHERE room_id = p_room_id AND is_active = true;
  IF sess IS NULL THEN
    RAISE EXCEPTION 'No active session';
  END IF;

  -- Determine whose turn it is
  curr_turn_user := COALESCE(sess.current_turn_user_id, sess.turn_order[sess.current_turn_index + 1]);

  IF curr_turn_user != caller_id THEN
    RAISE EXCEPTION 'Not your turn';
  END IF;

  IF sess.waiting_until IS NOT NULL AND sess.waiting_until > NOW() THEN
    RAISE EXCEPTION 'Still in cooldown period';
  END IF;

  -- Check prompt type
  IF sess.current_prompt_type = 'photo' THEN
    RAISE EXCEPTION 'This prompt requires a photo.';
  END IF;

  -- Get room interval and prompt mode
  SELECT COALESCE(prompt_interval_minutes, 0), COALESCE(prompt_mode, 'fun')
  INTO room_interval, v_prompt_mode
  FROM rooms WHERE id = p_room_id;

  -- Insert turn response
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, caller_id, 'turn_response', p_content);

  -- Get next user from current room members
  next_user_id := get_next_turn_user(p_room_id, caller_id);

  -- Calculate cooldown
  IF room_interval > 0 THEN
    next_waiting_until := NOW() + (room_interval || ' minutes')::INTERVAL;
  ELSE
    next_waiting_until := NULL;
  END IF;

  -- Get new prompt based on room's mode
  SELECT text, COALESCE(prompt_type, 'text') INTO new_prompt_text, new_prompt_type
  FROM prompts
  WHERE mode = v_prompt_mode OR mode IS NULL
  ORDER BY random() LIMIT 1;

  -- Update session with NEW turn_instance_id (key fix for nudge reset!)
  UPDATE turn_sessions
  SET current_turn_user_id = next_user_id,
      current_turn_index = current_turn_index + 1,
      turn_instance_id = gen_random_uuid(),  -- NEW: Reset nudge eligibility
      prompt_text = new_prompt_text,
      current_prompt_type = new_prompt_type,
      waiting_until = next_waiting_until,
      last_turn_completed_at = NOW()
  WHERE room_id = p_room_id AND is_active = true;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Update submit_photo_turn to generate new turn_instance_id
CREATE OR REPLACE FUNCTION submit_photo_turn(p_room_id UUID, p_image_url TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  sess RECORD;
  room_interval INT;
  next_user_id UUID;
  new_prompt_text TEXT;
  new_prompt_type TEXT;
  next_waiting_until TIMESTAMPTZ;
  curr_turn_user UUID;
  v_prompt_mode TEXT;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO sess FROM turn_sessions WHERE room_id = p_room_id AND is_active = true;
  IF sess IS NULL THEN
    RAISE EXCEPTION 'No active session';
  END IF;

  curr_turn_user := COALESCE(sess.current_turn_user_id, sess.turn_order[sess.current_turn_index + 1]);
  IF curr_turn_user != caller_id THEN
    RAISE EXCEPTION 'Not your turn';
  END IF;

  IF sess.waiting_until IS NOT NULL AND sess.waiting_until > NOW() THEN
    RAISE EXCEPTION 'Still in cooldown period';
  END IF;

  IF sess.current_prompt_type != 'photo' THEN
    RAISE EXCEPTION 'Current prompt does not require a photo';
  END IF;

  IF p_image_url IS NULL OR p_image_url = '' THEN
    RAISE EXCEPTION 'Photo URL is required';
  END IF;

  SELECT COALESCE(prompt_interval_minutes, 0), COALESCE(prompt_mode, 'fun')
  INTO room_interval, v_prompt_mode
  FROM rooms WHERE id = p_room_id;

  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, caller_id, 'image', p_image_url);

  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, NULL, 'system', 'Photo prompt completed!');

  -- Get next user
  next_user_id := get_next_turn_user(p_room_id, caller_id);

  IF room_interval > 0 THEN
    next_waiting_until := NOW() + (room_interval || ' minutes')::INTERVAL;
  ELSE
    next_waiting_until := NULL;
  END IF;

  SELECT text, COALESCE(prompt_type, 'text') INTO new_prompt_text, new_prompt_type
  FROM prompts
  WHERE mode = v_prompt_mode OR mode IS NULL
  ORDER BY random() LIMIT 1;

  -- Update session with NEW turn_instance_id
  UPDATE turn_sessions
  SET current_turn_user_id = next_user_id,
      current_turn_index = current_turn_index + 1,
      turn_instance_id = gen_random_uuid(),  -- NEW: Reset nudge eligibility
      prompt_text = new_prompt_text,
      current_prompt_type = new_prompt_type,
      waiting_until = next_waiting_until,
      last_turn_completed_at = NOW()
  WHERE room_id = p_room_id AND is_active = true;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 4: Update nudge functions to use turn_instance_id
-- ============================================

-- 10. Update has_nudged_this_turn to use turn_instance_id
CREATE OR REPLACE FUNCTION has_nudged_this_turn(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_turn_instance_id UUID;
BEGIN
  -- Get current turn_instance_id from active session
  SELECT turn_instance_id INTO v_turn_instance_id
  FROM turn_sessions
  WHERE room_id = p_room_id AND is_active = true;

  -- If no active session or no turn_instance_id, return false
  IF v_turn_instance_id IS NULL THEN
    RETURN false;
  END IF;

  -- Check if user has nudged during THIS specific turn instance
  RETURN EXISTS (
    SELECT 1 FROM nudges
    WHERE room_id = p_room_id
      AND nudger_user_id = auth.uid()
      AND turn_instance_id = v_turn_instance_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Update send_nudge to use turn_instance_id
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

  IF v_turn_instance_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Turn instance not initialized');
  END IF;

  -- Block self-nudge
  IF v_current_turn_user_id = caller_id THEN
    RETURN json_build_object('success', false, 'error', 'Cannot nudge yourself');
  END IF;

  -- Get room name
  SELECT name INTO v_room_name FROM rooms WHERE id = p_room_id;

  -- Try to insert the nudge (will fail if already nudged this turn instance)
  BEGIN
    INSERT INTO nudges (room_id, nudger_user_id, nudged_user_id, turn_instance_id)
    VALUES (p_room_id, caller_id, v_current_turn_user_id, v_turn_instance_id);
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

-- ============================================
-- PART 5: Initialize turn_instance_id for all active sessions
-- ============================================

-- 12. Ensure all active sessions have a turn_instance_id
UPDATE turn_sessions
SET turn_instance_id = gen_random_uuid()
WHERE is_active = true AND turn_instance_id IS NULL;
