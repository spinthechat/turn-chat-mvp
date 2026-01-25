-- ============================================
-- Group Details & Prompt Frequency Migration
-- ============================================

-- ============================================
-- A) Leave Room functionality
-- ============================================

-- Function to leave a room
CREATE OR REPLACE FUNCTION leave_room(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  member_role TEXT;
  member_count INT;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if user is a member
  SELECT role INTO member_role
  FROM room_members
  WHERE room_id = p_room_id AND user_id = caller_id;

  IF member_role IS NULL THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  -- Count remaining members
  SELECT COUNT(*) INTO member_count
  FROM room_members
  WHERE room_id = p_room_id;

  -- If host is leaving and there are other members, transfer host role
  IF member_role = 'host' AND member_count > 1 THEN
    UPDATE room_members
    SET role = 'host'
    WHERE user_id = (
      SELECT user_id FROM room_members
      WHERE room_id = p_room_id
        AND user_id != caller_id
        AND role = 'member'
      LIMIT 1
    );
  END IF;

  -- Remove the user from room_members
  DELETE FROM room_members
  WHERE room_id = p_room_id AND user_id = caller_id;

  -- Also remove from turn_order if game is active
  UPDATE turn_sessions
  SET turn_order = array_remove(turn_order, caller_id)
  WHERE room_id = p_room_id AND is_active = true;

  -- If room is now empty, optionally clean up (or leave for history)
  -- For now, we leave the room intact

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- B) Prompt Frequency System
-- ============================================

-- 1. Add prompt frequency columns to room_members
ALTER TABLE room_members
ADD COLUMN IF NOT EXISTS prompt_interval_minutes INT NOT NULL DEFAULT 0;

ALTER TABLE room_members
ADD COLUMN IF NOT EXISTS last_prompt_completed_at TIMESTAMPTZ;

-- 2. Add waiting_until to turn_sessions
ALTER TABLE turn_sessions
ADD COLUMN IF NOT EXISTS waiting_until TIMESTAMPTZ;

-- 3. Function to update prompt frequency for current user
CREATE OR REPLACE FUNCTION update_prompt_frequency(
  p_room_id UUID,
  p_interval_minutes INT
)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate interval (0, 60, 180, 360, 1440)
  IF p_interval_minutes NOT IN (0, 60, 180, 360, 1440) THEN
    RAISE EXCEPTION 'Invalid interval. Must be 0, 60, 180, 360, or 1440 minutes';
  END IF;

  UPDATE room_members
  SET prompt_interval_minutes = p_interval_minutes
  WHERE room_id = p_room_id AND user_id = caller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Helper function to check if a user is ready for their prompt
CREATE OR REPLACE FUNCTION get_user_prompt_ready_at(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  interval_mins INT;
  last_completed TIMESTAMPTZ;
BEGIN
  SELECT prompt_interval_minutes, last_prompt_completed_at
  INTO interval_mins, last_completed
  FROM room_members
  WHERE room_id = p_room_id AND user_id = p_user_id;

  -- If never completed or interval is 0 (immediate), ready now
  IF last_completed IS NULL OR interval_mins = 0 THEN
    RETURN NULL; -- NULL means ready now
  END IF;

  -- Calculate when they'll be ready
  RETURN last_completed + (interval_mins || ' minutes')::INTERVAL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Updated submit_turn function with cooldown tracking
CREATE OR REPLACE FUNCTION submit_turn(p_room_id UUID, p_content TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  sess RECORD;
  current_idx INT;
  next_idx INT;
  next_user_id UUID;
  next_ready_at TIMESTAMPTZ;
  new_prompt TEXT;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get active session
  SELECT * INTO sess
  FROM turn_sessions
  WHERE room_id = p_room_id AND is_active = true;

  IF sess IS NULL THEN
    RAISE EXCEPTION 'No active session';
  END IF;

  -- Check it's caller's turn
  current_idx := sess.current_turn_index;
  IF sess.turn_order[current_idx + 1] != caller_id THEN
    RAISE EXCEPTION 'Not your turn';
  END IF;

  -- Check if waiting period has passed (if any)
  IF sess.waiting_until IS NOT NULL AND sess.waiting_until > NOW() THEN
    RAISE EXCEPTION 'Still in cooldown period';
  END IF;

  -- Insert the turn response message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, caller_id, 'turn_response', p_content);

  -- Record completion time for the current user
  UPDATE room_members
  SET last_prompt_completed_at = NOW()
  WHERE room_id = p_room_id AND user_id = caller_id;

  -- Advance to next player
  next_idx := (current_idx + 1) % array_length(sess.turn_order, 1);
  next_user_id := sess.turn_order[next_idx + 1];

  -- Check if next user is ready or needs cooldown
  next_ready_at := get_user_prompt_ready_at(p_room_id, next_user_id);

  -- Pick a new random prompt for next user
  SELECT text INTO new_prompt
  FROM prompts
  ORDER BY random()
  LIMIT 1;

  -- Update session with next player and their waiting status
  UPDATE turn_sessions
  SET current_turn_index = next_idx,
      prompt_text = new_prompt,
      waiting_until = next_ready_at
  WHERE room_id = p_room_id AND is_active = true;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Updated start_session to initialize with cooldown check
CREATE OR REPLACE FUNCTION start_session(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  member_ids UUID[];
  first_user_id UUID;
  first_ready_at TIMESTAMPTZ;
  prompt TEXT;
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
  UPDATE turn_sessions
  SET is_active = false
  WHERE room_id = p_room_id AND is_active = true;

  -- Get member IDs in random order
  SELECT array_agg(user_id ORDER BY random()) INTO member_ids
  FROM room_members
  WHERE room_id = p_room_id;

  IF array_length(member_ids, 1) < 2 THEN
    RAISE EXCEPTION 'Need at least 2 members to start';
  END IF;

  -- Get first user and their ready status
  first_user_id := member_ids[1];
  first_ready_at := get_user_prompt_ready_at(p_room_id, first_user_id);

  -- Pick a random prompt
  SELECT text INTO prompt
  FROM prompts
  ORDER BY random()
  LIMIT 1;

  -- Create session
  INSERT INTO turn_sessions (room_id, prompt_text, turn_order, current_turn_index, is_active, waiting_until)
  VALUES (p_room_id, prompt, member_ids, 0, true, first_ready_at);

  -- System message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, NULL, 'system', 'Game started! Taking turns to answer prompts.');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Function to check and advance if cooldown passed (can be called periodically or on load)
CREATE OR REPLACE FUNCTION check_turn_cooldown(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  sess RECORD;
  current_user_id UUID;
  current_ready_at TIMESTAMPTZ;
BEGIN
  -- Get active session
  SELECT * INTO sess
  FROM turn_sessions
  WHERE room_id = p_room_id AND is_active = true;

  IF sess IS NULL THEN
    RETURN FALSE;
  END IF;

  -- If no waiting period, nothing to do
  IF sess.waiting_until IS NULL THEN
    RETURN FALSE;
  END IF;

  -- If waiting period has passed, clear it
  IF sess.waiting_until <= NOW() THEN
    UPDATE turn_sessions
    SET waiting_until = NULL
    WHERE room_id = p_room_id AND is_active = true;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
