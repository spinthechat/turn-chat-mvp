-- ============================================
-- Dynamic Turn Order (Option A)
-- ============================================
-- Instead of storing a static turn_order array, we now:
-- 1. Store current_turn_user_id (who's turn it is now)
-- 2. Derive the next player dynamically from room_members
-- This automatically includes new members in the rotation.

-- Add current_turn_user_id column to turn_sessions
ALTER TABLE turn_sessions ADD COLUMN IF NOT EXISTS current_turn_user_id UUID;

-- Migrate existing sessions: set current_turn_user_id from turn_order[current_turn_index]
UPDATE turn_sessions
SET current_turn_user_id = turn_order[current_turn_index + 1]
WHERE is_active = true AND current_turn_user_id IS NULL;

-- Helper function: Get next member in rotation
-- Orders members by their join date (created_at) for stable ordering
CREATE OR REPLACE FUNCTION get_next_turn_user(p_room_id UUID, p_current_user_id UUID)
RETURNS UUID AS $$
DECLARE
  next_user UUID;
  member_count INT;
BEGIN
  -- Get count of members
  SELECT COUNT(*) INTO member_count FROM room_members WHERE room_id = p_room_id;

  IF member_count < 2 THEN
    RETURN NULL;
  END IF;

  -- Find the next member after current user (ordered by created_at, then user_id for stability)
  SELECT user_id INTO next_user
  FROM room_members
  WHERE room_id = p_room_id
    AND (created_at, user_id) > (
      SELECT created_at, user_id FROM room_members
      WHERE room_id = p_room_id AND user_id = p_current_user_id
    )
  ORDER BY created_at, user_id
  LIMIT 1;

  -- If no next user found (current was last), wrap to first
  IF next_user IS NULL THEN
    SELECT user_id INTO next_user
    FROM room_members
    WHERE room_id = p_room_id
    ORDER BY created_at, user_id
    LIMIT 1;
  END IF;

  RETURN next_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated start_session: Use current_turn_user_id instead of relying solely on array index
CREATE OR REPLACE FUNCTION start_session(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  member_ids UUID[];
  first_user_id UUID;
  first_prompt RECORD;
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

  -- Get member IDs ordered by join date (for stable ordering)
  SELECT array_agg(user_id ORDER BY created_at, user_id) INTO member_ids
  FROM room_members WHERE room_id = p_room_id;

  IF array_length(member_ids, 1) < 2 THEN
    RAISE EXCEPTION 'Need at least 2 members to start';
  END IF;

  -- First user is the first in the ordered list
  first_user_id := member_ids[1];

  -- Pick a random prompt with its type
  SELECT text, prompt_type INTO first_prompt FROM prompts ORDER BY random() LIMIT 1;

  -- Create session with current_turn_user_id
  INSERT INTO turn_sessions (
    room_id,
    prompt_text,
    current_prompt_type,
    turn_order,
    current_turn_index,
    current_turn_user_id,
    is_active,
    waiting_until,
    last_turn_completed_at
  )
  VALUES (
    p_room_id,
    first_prompt.text,
    first_prompt.prompt_type,
    member_ids,
    0,
    first_user_id,
    true,
    NULL,
    NULL
  );

  -- System message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, NULL, 'system', 'Game started!');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated submit_turn: Advance to next player dynamically
CREATE OR REPLACE FUNCTION submit_turn(p_room_id UUID, p_content TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  sess RECORD;
  room_interval INT;
  next_user_id UUID;
  new_prompt RECORD;
  next_waiting_until TIMESTAMPTZ;
  current_user UUID;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get active session
  SELECT * INTO sess FROM turn_sessions WHERE room_id = p_room_id AND is_active = true;
  IF sess IS NULL THEN
    RAISE EXCEPTION 'No active session';
  END IF;

  -- Check it's caller's turn (prefer current_turn_user_id, fall back to array)
  current_user := COALESCE(sess.current_turn_user_id, sess.turn_order[sess.current_turn_index + 1]);
  IF current_user != caller_id THEN
    RAISE EXCEPTION 'Not your turn';
  END IF;

  -- Check if waiting period has passed
  IF sess.waiting_until IS NOT NULL AND sess.waiting_until > NOW() THEN
    RAISE EXCEPTION 'Still in cooldown period';
  END IF;

  -- Reject if this is a photo prompt
  IF sess.current_prompt_type = 'photo' THEN
    RAISE EXCEPTION 'This prompt requires a photo. Please upload a photo to complete your turn.';
  END IF;

  -- Get room's interval setting
  SELECT prompt_interval_minutes INTO room_interval FROM rooms WHERE id = p_room_id;

  -- Insert the turn response message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, caller_id, 'turn_response', p_content);

  -- Get next player DYNAMICALLY from current room members
  next_user_id := get_next_turn_user(p_room_id, caller_id);

  -- Calculate when next turn is available
  IF room_interval > 0 THEN
    next_waiting_until := NOW() + (room_interval || ' minutes')::INTERVAL;
  ELSE
    next_waiting_until := NULL;
  END IF;

  -- Pick a new random prompt
  SELECT text, prompt_type INTO new_prompt FROM prompts ORDER BY random() LIMIT 1;

  -- Update session with new current user
  UPDATE turn_sessions
  SET current_turn_user_id = next_user_id,
      prompt_text = new_prompt.text,
      current_prompt_type = new_prompt.prompt_type,
      waiting_until = next_waiting_until,
      last_turn_completed_at = NOW()
  WHERE room_id = p_room_id AND is_active = true;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated submit_photo_turn: Advance to next player dynamically
CREATE OR REPLACE FUNCTION submit_photo_turn(p_room_id UUID, p_image_url TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  sess RECORD;
  room_interval INT;
  next_user_id UUID;
  new_prompt RECORD;
  next_waiting_until TIMESTAMPTZ;
  current_user UUID;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get active session
  SELECT * INTO sess FROM turn_sessions WHERE room_id = p_room_id AND is_active = true;
  IF sess IS NULL THEN
    RAISE EXCEPTION 'No active session';
  END IF;

  -- Check it's caller's turn (prefer current_turn_user_id, fall back to array)
  current_user := COALESCE(sess.current_turn_user_id, sess.turn_order[sess.current_turn_index + 1]);
  IF current_user != caller_id THEN
    RAISE EXCEPTION 'Not your turn';
  END IF;

  -- Check if waiting period has passed
  IF sess.waiting_until IS NOT NULL AND sess.waiting_until > NOW() THEN
    RAISE EXCEPTION 'Still in cooldown period';
  END IF;

  -- Verify this is a photo prompt
  IF sess.current_prompt_type != 'photo' THEN
    RAISE EXCEPTION 'Current prompt does not require a photo';
  END IF;

  -- Validate image URL
  IF p_image_url IS NULL OR p_image_url = '' THEN
    RAISE EXCEPTION 'Photo URL is required';
  END IF;

  -- Get room's interval setting
  SELECT prompt_interval_minutes INTO room_interval FROM rooms WHERE id = p_room_id;

  -- Insert the image message as turn response
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, caller_id, 'image', p_image_url);

  -- Also insert a system message indicating prompt completion
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, NULL, 'system', 'Photo prompt completed!');

  -- Get next player DYNAMICALLY from current room members
  next_user_id := get_next_turn_user(p_room_id, caller_id);

  -- Calculate when next turn is available
  IF room_interval > 0 THEN
    next_waiting_until := NOW() + (room_interval || ' minutes')::INTERVAL;
  ELSE
    next_waiting_until := NULL;
  END IF;

  -- Pick a new random prompt (with its type)
  SELECT text, prompt_type INTO new_prompt FROM prompts ORDER BY random() LIMIT 1;

  -- Update session with new current user
  UPDATE turn_sessions
  SET current_turn_user_id = next_user_id,
      prompt_text = new_prompt.text,
      current_prompt_type = new_prompt.prompt_type,
      waiting_until = next_waiting_until,
      last_turn_completed_at = NOW()
  WHERE room_id = p_room_id AND is_active = true;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
