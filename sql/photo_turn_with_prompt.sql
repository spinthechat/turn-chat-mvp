-- ============================================
-- Photo Turn: Store prompt text with image
-- ============================================
-- Updates submit_photo_turn to store both the prompt and image URL
-- as a turn_response type (not 'image' type) so it displays correctly
-- with the turn styling and shows the prompt.

-- Updated submit_photo_turn that includes prompt text
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
  current_prompt TEXT;
  photo_turn_content TEXT;
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

  SELECT COALESCE(prompt_interval_minutes, 0) INTO room_interval FROM rooms WHERE id = p_room_id;

  -- Get the current prompt text
  current_prompt := sess.prompt_text;

  -- Build JSON content for photo turn response
  photo_turn_content := json_build_object(
    'kind', 'photo_turn',
    'prompt', current_prompt,
    'image_url', p_image_url
  )::TEXT;

  -- Insert as turn_response with JSON content (not 'image' type)
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, caller_id, 'turn_response', photo_turn_content);

  -- Note: Removed the "Photo prompt completed!" system message

  -- GET NEXT USER FROM CURRENT ROOM_MEMBERS
  next_user_id := get_next_turn_user(p_room_id, caller_id);

  IF room_interval > 0 THEN
    next_waiting_until := NOW() + (room_interval || ' minutes')::INTERVAL;
  ELSE
    next_waiting_until := NULL;
  END IF;

  SELECT text, COALESCE(prompt_type, 'text') INTO new_prompt_text, new_prompt_type
  FROM prompts ORDER BY random() LIMIT 1;

  UPDATE turn_sessions
  SET current_turn_user_id = next_user_id,
      prompt_text = new_prompt_text,
      current_prompt_type = new_prompt_type,
      waiting_until = next_waiting_until,
      last_turn_completed_at = NOW()
  WHERE room_id = p_room_id AND is_active = true;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
