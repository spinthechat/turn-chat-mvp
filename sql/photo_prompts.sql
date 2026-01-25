-- ============================================
-- Photo-Required Prompts
-- ============================================

-- 1. Add prompt_type to prompts table
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS prompt_type TEXT NOT NULL DEFAULT 'text';

-- Add check constraint
ALTER TABLE prompts DROP CONSTRAINT IF EXISTS prompts_type_check;
ALTER TABLE prompts ADD CONSTRAINT prompts_type_check CHECK (prompt_type IN ('text', 'photo'));

-- 2. Add current_prompt_type to turn_sessions for easy access
ALTER TABLE turn_sessions ADD COLUMN IF NOT EXISTS current_prompt_type TEXT NOT NULL DEFAULT 'text';

-- 3. Add some photo prompts
INSERT INTO prompts (text, prompt_type) VALUES
  ('Take a photo of your surroundings.', 'photo'),
  ('Take a selfie.', 'photo'),
  ('Take a selfie with someone else (can be a pet).', 'photo'),
  ('Take a photo of something random nearby.', 'photo'),
  ('Take a photo that represents your current mood.', 'photo'),
  ('Show us what you''re eating or drinking right now.', 'photo'),
  ('Take a photo of something that made you smile today.', 'photo'),
  ('Show us your view right now.', 'photo')
ON CONFLICT DO NOTHING;

-- 4. Function to submit a photo turn (for photo-required prompts)
CREATE OR REPLACE FUNCTION submit_photo_turn(p_room_id UUID, p_image_url TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  sess RECORD;
  room_interval INT;
  next_idx INT;
  new_prompt RECORD;
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

  -- Advance to next player
  next_idx := (sess.current_turn_index + 1) % array_length(sess.turn_order, 1);

  -- Calculate when next turn is available
  IF room_interval > 0 THEN
    next_waiting_until := NOW() + (room_interval || ' minutes')::INTERVAL;
  ELSE
    next_waiting_until := NULL;
  END IF;

  -- Pick a new random prompt (with its type)
  SELECT text, prompt_type INTO new_prompt FROM prompts ORDER BY random() LIMIT 1;

  -- Update session
  UPDATE turn_sessions
  SET current_turn_index = next_idx,
      prompt_text = new_prompt.text,
      current_prompt_type = new_prompt.prompt_type,
      waiting_until = next_waiting_until,
      last_turn_completed_at = NOW()
  WHERE room_id = p_room_id AND is_active = true;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Update submit_turn to reject photo prompts (must use submit_photo_turn)
CREATE OR REPLACE FUNCTION submit_turn(p_room_id UUID, p_content TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  sess RECORD;
  room_interval INT;
  next_idx INT;
  new_prompt RECORD;
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

  -- Advance to next player
  next_idx := (sess.current_turn_index + 1) % array_length(sess.turn_order, 1);

  -- Calculate when next turn is available
  IF room_interval > 0 THEN
    next_waiting_until := NOW() + (room_interval || ' minutes')::INTERVAL;
  ELSE
    next_waiting_until := NULL;
  END IF;

  -- Pick a new random prompt (with its type)
  SELECT text, prompt_type INTO new_prompt FROM prompts ORDER BY random() LIMIT 1;

  -- Update session
  UPDATE turn_sessions
  SET current_turn_index = next_idx,
      prompt_text = new_prompt.text,
      current_prompt_type = new_prompt.prompt_type,
      waiting_until = next_waiting_until,
      last_turn_completed_at = NOW()
  WHERE room_id = p_room_id AND is_active = true;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Update start_session to include prompt_type
CREATE OR REPLACE FUNCTION start_session(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  member_ids UUID[];
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

  -- Get member IDs in random order
  SELECT array_agg(user_id ORDER BY random()) INTO member_ids
  FROM room_members WHERE room_id = p_room_id;

  IF array_length(member_ids, 1) < 2 THEN
    RAISE EXCEPTION 'Need at least 2 members to start';
  END IF;

  -- Pick a random prompt with its type
  SELECT text, prompt_type INTO first_prompt FROM prompts ORDER BY random() LIMIT 1;

  -- Create session
  INSERT INTO turn_sessions (room_id, prompt_text, current_prompt_type, turn_order, current_turn_index, is_active, waiting_until, last_turn_completed_at)
  VALUES (p_room_id, first_prompt.text, first_prompt.prompt_type, member_ids, 0, true, NULL, NULL);

  -- System message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, NULL, 'system', 'Game started!');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
