-- ============================================
-- Prompt Modes: Fun & Family
-- ============================================

-- 1. Add mode column to prompts table
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'fun';

-- 2. Add prompt_mode to rooms table
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS prompt_mode TEXT NOT NULL DEFAULT 'fun';

-- 3. Create index for efficient mode-based queries
CREATE INDEX IF NOT EXISTS prompts_mode_idx ON prompts (mode);

-- 4. Update all existing prompts to be 'fun' mode (they already default to this, but be explicit)
UPDATE prompts SET mode = 'fun' WHERE mode IS NULL OR mode = '';

-- 5. Insert Family mode prompts (50 total)
INSERT INTO prompts (text, prompt_type, mode) VALUES
  -- WHO IN THE FAMILY IS MOST LIKELY TO… (1-10)
  ('Who in the family is most likely to forget where they put their keys?', 'text', 'family'),
  ('Who in the family is most likely to start a group chat and never reply?', 'text', 'family'),
  ('Who in the family is most likely to be late, no matter what?', 'text', 'family'),
  ('Who in the family is most likely to bring snacks "just in case"?', 'text', 'family'),
  ('Who in the family is most likely to fall asleep on the couch?', 'text', 'family'),
  ('Who in the family is most likely to tell the same story twice?', 'text', 'family'),
  ('Who in the family is most likely to organize a family event?', 'text', 'family'),
  ('Who in the family is most likely to fix something without reading instructions?', 'text', 'family'),
  ('Who in the family is most likely to suggest ordering food instead of cooking?', 'text', 'family'),
  ('Who in the family is most likely to remember everyone''s birthday?', 'text', 'family'),

  -- IF THE FAMILY HAD AN OFFICIAL… (11-20)
  ('If the family had an official anthem, what song would it be?', 'text', 'family'),
  ('If the family had an official mascot, what would it be?', 'text', 'family'),
  ('If the family had an official catchphrase, what would it be?', 'text', 'family'),
  ('If the family had an official holiday, how would you celebrate it?', 'text', 'family'),
  ('If the family had an official meal, what would be on the menu?', 'text', 'family'),
  ('If the family had an official emoji, which one fits best?', 'text', 'family'),
  ('If the family had an official color, what would it be?', 'text', 'family'),
  ('If the family had an official movie night pick, what genre would win?', 'text', 'family'),
  ('If the family had an official board game, which one would it be?', 'text', 'family'),
  ('If the family had an official "meeting place," where would it be?', 'text', 'family'),

  -- WHAT'S A TIME THE FAMILY… (21-30)
  ('What''s a time the family laughed way harder than expected?', 'text', 'family'),
  ('What''s a time the family pulled together to help someone out?', 'text', 'family'),
  ('What''s a time the family tradition didn''t go as planned?', 'text', 'family'),
  ('What''s a time the family tried something new together?', 'text', 'family'),
  ('What''s a time the family made the best of a bad situation?', 'text', 'family'),
  ('What''s a time the family surprised you?', 'text', 'family'),
  ('What''s a time the family couldn''t stop talking about something?', 'text', 'family'),
  ('What''s a time the family turned a small moment into a big memory?', 'text', 'family'),
  ('What''s a time the family disagreed but still had fun?', 'text', 'family'),
  ('What''s a time the family felt especially close?', 'text', 'family'),

  -- WARM & EVERYDAY FAMILY PROMPTS (31-40)
  ('What''s something you appreciate about your family right now?', 'text', 'family'),
  ('What''s a family habit that always makes you smile?', 'text', 'family'),
  ('What''s something your family does differently from others?', 'text', 'family'),
  ('What''s a small family moment you''d like to repeat?', 'text', 'family'),
  ('What''s something your family does really well together?', 'text', 'family'),
  ('What''s a family tradition you hope continues?', 'text', 'family'),
  ('What''s a family memory that still comes up in conversation?', 'text', 'family'),
  ('What''s something your family taught you without realizing it?', 'text', 'family'),
  ('What''s a family rule (spoken or unspoken) everyone follows?', 'text', 'family'),
  ('What''s something about your family that feels comforting?', 'text', 'family'),

  -- EVERYDAY LIFE & PLAYFUL (41-50)
  ('What''s a meal that feels like "family food"?', 'text', 'family'),
  ('What''s the most common topic in family conversations?', 'text', 'family'),
  ('What''s a typical family weekend like?', 'text', 'family'),
  ('What''s something the family always debates?', 'text', 'family'),
  ('What''s a family activity that never gets old?', 'text', 'family'),
  ('What''s something the family always packs too much of?', 'text', 'family'),
  ('What''s something the family never packs enough of?', 'text', 'family'),
  ('What''s a family joke outsiders wouldn''t understand?', 'text', 'family'),
  ('What''s a family habit that would confuse strangers?', 'text', 'family'),
  ('What''s something small that makes your family feel like your family?', 'text', 'family');

-- 6. Function to update room's prompt mode
CREATE OR REPLACE FUNCTION update_room_prompt_mode(p_room_id UUID, p_mode TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  -- Validate mode
  IF p_mode NOT IN ('fun', 'family') THEN
    RAISE EXCEPTION 'Invalid prompt mode';
  END IF;

  -- Verify caller is a member of the room
  IF NOT EXISTS (
    SELECT 1 FROM room_members WHERE room_id = p_room_id AND user_id = caller_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  -- Update the room's prompt mode
  UPDATE rooms SET prompt_mode = p_mode WHERE id = p_room_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Update start_session to use room's prompt mode
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

  -- Get room's prompt mode
  SELECT prompt_mode INTO v_prompt_mode FROM rooms WHERE id = p_room_id;
  v_prompt_mode := COALESCE(v_prompt_mode, 'fun');

  -- Get ALL current members ordered by user_id
  SELECT array_agg(user_id ORDER BY user_id) INTO member_ids
  FROM room_members WHERE room_id = p_room_id;

  IF array_length(member_ids, 1) < 2 THEN
    RAISE EXCEPTION 'Need at least 2 members to start';
  END IF;

  first_user_id := member_ids[1];

  -- Pick a random prompt FROM THE ROOM'S MODE
  SELECT text, COALESCE(prompt_type, 'text') INTO first_prompt_text, first_prompt_type
  FROM prompts
  WHERE mode = v_prompt_mode
  ORDER BY random()
  LIMIT 1;

  -- Delete old session if exists (handle unique constraint)
  DELETE FROM turn_sessions WHERE room_id = p_room_id;

  -- Create session with current_turn_user_id set
  INSERT INTO turn_sessions (
    room_id,
    prompt_text,
    current_prompt_type,
    turn_order,
    current_turn_index,
    current_turn_user_id,
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
    true,
    NULL
  );

  -- System message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, NULL, 'system', 'Game started!');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Update submit_turn to use room's prompt mode for next prompt
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

  -- Determine whose turn it is (prefer current_turn_user_id, fall back to array)
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

  -- GET NEXT USER FROM CURRENT ROOM_MEMBERS (the key fix!)
  next_user_id := get_next_turn_user(p_room_id, caller_id);

  -- Log for debugging
  SELECT array_agg(user_id ORDER BY user_id) INTO all_members FROM room_members WHERE room_id = p_room_id;
  RAISE NOTICE 'Turn complete by %. Next: %. All members: %', caller_id, next_user_id, all_members;

  -- Calculate cooldown
  IF room_interval > 0 THEN
    next_waiting_until := NOW() + (room_interval || ' minutes')::INTERVAL;
  ELSE
    next_waiting_until := NULL;
  END IF;

  -- Get new prompt FROM THE ROOM'S MODE
  SELECT text, COALESCE(prompt_type, 'text') INTO new_prompt_text, new_prompt_type
  FROM prompts
  WHERE mode = v_prompt_mode
  ORDER BY random()
  LIMIT 1;

  -- Update session with next user
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

-- 9. Update submit_photo_turn to use room's prompt mode for next prompt
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

  -- Get room settings including prompt mode
  SELECT COALESCE(prompt_interval_minutes, 0), COALESCE(prompt_mode, 'fun')
  INTO room_interval, v_prompt_mode
  FROM rooms WHERE id = p_room_id;

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

  -- GET NEXT USER FROM CURRENT ROOM_MEMBERS
  next_user_id := get_next_turn_user(p_room_id, caller_id);

  IF room_interval > 0 THEN
    next_waiting_until := NOW() + (room_interval || ' minutes')::INTERVAL;
  ELSE
    next_waiting_until := NULL;
  END IF;

  -- Get new prompt FROM THE ROOM'S MODE
  SELECT text, COALESCE(prompt_type, 'text') INTO new_prompt_text, new_prompt_type
  FROM prompts
  WHERE mode = v_prompt_mode
  ORDER BY random()
  LIMIT 1;

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
