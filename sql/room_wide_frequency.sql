-- ============================================
-- Room-Wide Prompt Frequency
-- ============================================

-- 1. Add prompt_interval_minutes to rooms table (room-wide setting)
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS prompt_interval_minutes INT NOT NULL DEFAULT 0;

-- 2. Update turn_sessions to track when last turn was completed
ALTER TABLE turn_sessions ADD COLUMN IF NOT EXISTS last_turn_completed_at TIMESTAMPTZ;

-- 3. Function to update room frequency (any member can change it)
CREATE OR REPLACE FUNCTION update_room_frequency(p_room_id UUID, p_interval_minutes INT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify caller is a member
  IF NOT is_room_member(p_room_id, caller_id) THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  IF p_interval_minutes NOT IN (0, 60, 180, 360, 1440) THEN
    RAISE EXCEPTION 'Invalid interval. Must be 0, 60, 180, 360, or 1440 minutes';
  END IF;

  UPDATE rooms
  SET prompt_interval_minutes = p_interval_minutes
  WHERE id = p_room_id;

  -- Also update waiting_until for active session if needed
  UPDATE turn_sessions
  SET waiting_until = CASE
    WHEN p_interval_minutes = 0 THEN NULL
    WHEN last_turn_completed_at IS NOT NULL THEN last_turn_completed_at + (p_interval_minutes || ' minutes')::INTERVAL
    ELSE NULL
  END
  WHERE room_id = p_room_id AND is_active = true;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Updated submit_turn with room-wide cooldown
CREATE OR REPLACE FUNCTION submit_turn(p_room_id UUID, p_content TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  sess RECORD;
  room_interval INT;
  next_idx INT;
  next_user_id UUID;
  new_prompt TEXT;
  next_waiting_until TIMESTAMPTZ;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get active session
  SELECT * INTO sess FROM turn_sessions WHERE room_id = p_room_id AND is_active = true;
  IF sess IS NULL THEN
    RAISE EXCEPTION 'No active session';
  END IF;

  -- Check it's caller's turn
  IF sess.turn_order[sess.current_turn_index + 1] != caller_id THEN
    RAISE EXCEPTION 'Not your turn';
  END IF;

  -- Check if waiting period has passed (if any)
  IF sess.waiting_until IS NOT NULL AND sess.waiting_until > NOW() THEN
    RAISE EXCEPTION 'Still in cooldown period';
  END IF;

  -- Get room's interval setting
  SELECT prompt_interval_minutes INTO room_interval FROM rooms WHERE id = p_room_id;

  -- Insert the turn response message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, caller_id, 'turn_response', p_content);

  -- Advance to next player
  next_idx := (sess.current_turn_index + 1) % array_length(sess.turn_order, 1);
  next_user_id := sess.turn_order[next_idx + 1];

  -- Calculate when next turn is available (based on room interval)
  IF room_interval > 0 THEN
    next_waiting_until := NOW() + (room_interval || ' minutes')::INTERVAL;
  ELSE
    next_waiting_until := NULL;
  END IF;

  -- Pick a new random prompt
  SELECT text INTO new_prompt FROM prompts ORDER BY random() LIMIT 1;

  -- Update session
  UPDATE turn_sessions
  SET current_turn_index = next_idx,
      prompt_text = new_prompt,
      waiting_until = next_waiting_until,
      last_turn_completed_at = NOW()
  WHERE room_id = p_room_id AND is_active = true;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Updated start_session (no initial cooldown)
CREATE OR REPLACE FUNCTION start_session(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  member_ids UUID[];
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
  UPDATE turn_sessions SET is_active = false WHERE room_id = p_room_id AND is_active = true;

  -- Get member IDs in random order
  SELECT array_agg(user_id ORDER BY random()) INTO member_ids
  FROM room_members WHERE room_id = p_room_id;

  IF array_length(member_ids, 1) < 2 THEN
    RAISE EXCEPTION 'Need at least 2 members to start';
  END IF;

  -- Pick a random prompt
  SELECT text INTO prompt FROM prompts ORDER BY random() LIMIT 1;

  -- Create session (no initial cooldown - first person can go immediately)
  INSERT INTO turn_sessions (room_id, prompt_text, turn_order, current_turn_index, is_active, waiting_until, last_turn_completed_at)
  VALUES (p_room_id, prompt, member_ids, 0, true, NULL, NULL);

  -- System message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, NULL, 'system', 'Game started!');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
