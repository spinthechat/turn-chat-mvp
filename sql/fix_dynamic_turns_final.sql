-- ============================================
-- FINAL FIX: Dynamic Turn Order from room_members
-- ============================================
-- The turn system now ALWAYS derives the next player from
-- the current room_members table, not a stored array.

-- 1. Add created_at to room_members if missing (for stable ordering)
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Ensure current_turn_user_id column exists
ALTER TABLE turn_sessions ADD COLUMN IF NOT EXISTS current_turn_user_id UUID;

-- 3. Function to get next turn user from CURRENT room_members
-- This is the source of truth - always queries room_members directly
CREATE OR REPLACE FUNCTION get_next_turn_user(p_room_id UUID, p_current_user_id UUID)
RETURNS UUID AS $$
DECLARE
  next_user UUID;
  all_members UUID[];
  current_idx INT;
  next_idx INT;
BEGIN
  -- Get ALL current members ordered by user_id (stable ordering)
  SELECT array_agg(user_id ORDER BY user_id) INTO all_members
  FROM room_members
  WHERE room_id = p_room_id;

  -- Debug: Log the members list
  RAISE NOTICE 'All members for room %: %', p_room_id, all_members;

  IF all_members IS NULL OR array_length(all_members, 1) < 2 THEN
    RETURN NULL;
  END IF;

  -- Find current user's position
  current_idx := array_position(all_members, p_current_user_id);

  IF current_idx IS NULL THEN
    -- Current user not found (maybe left), start from beginning
    RETURN all_members[1];
  END IF;

  -- Calculate next index (wrap around)
  next_idx := current_idx % array_length(all_members, 1) + 1;
  next_user := all_members[next_idx];

  RAISE NOTICE 'Next turn: % (index % of %)', next_user, next_idx, array_length(all_members, 1);

  RETURN next_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Updated submit_turn that uses dynamic member lookup
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

  -- Get room interval
  SELECT COALESCE(prompt_interval_minutes, 0) INTO room_interval FROM rooms WHERE id = p_room_id;

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

  -- Get new prompt
  SELECT text, COALESCE(prompt_type, 'text') INTO new_prompt_text, new_prompt_type
  FROM prompts ORDER BY random() LIMIT 1;

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

-- 5. Updated submit_photo_turn with same fix
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

  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, caller_id, 'image', p_image_url);

  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, NULL, 'system', 'Photo prompt completed!');

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

-- 6. Updated start_session to set initial current_turn_user_id
CREATE OR REPLACE FUNCTION start_session(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  member_ids UUID[];
  first_user_id UUID;
  first_prompt_text TEXT;
  first_prompt_type TEXT;
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

  -- Pick a random prompt
  SELECT text, COALESCE(prompt_type, 'text') INTO first_prompt_text, first_prompt_type
  FROM prompts ORDER BY random() LIMIT 1;

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

-- 7. Now restart your specific room's session with all current members
UPDATE turn_sessions SET is_active = false WHERE room_id = 'd9569223-cc52-44cf-9d58-41cd0029c03c';
DELETE FROM turn_sessions WHERE room_id = 'd9569223-cc52-44cf-9d58-41cd0029c03c';

DO $$
DECLARE
  member_ids UUID[];
  first_user UUID;
  prompt_text TEXT;
  prompt_type TEXT;
BEGIN
  -- Get ALL current members
  SELECT array_agg(user_id ORDER BY user_id) INTO member_ids
  FROM room_members WHERE room_id = 'd9569223-cc52-44cf-9d58-41cd0029c03c';

  RAISE NOTICE 'Starting session with members: %', member_ids;

  first_user := member_ids[1];

  SELECT text, COALESCE(p.prompt_type, 'text') INTO prompt_text, prompt_type
  FROM prompts p ORDER BY random() LIMIT 1;

  INSERT INTO turn_sessions (room_id, prompt_text, current_prompt_type, turn_order, current_turn_index, current_turn_user_id, is_active, waiting_until)
  VALUES ('d9569223-cc52-44cf-9d58-41cd0029c03c', prompt_text, prompt_type, member_ids, 0, first_user, true, NULL);
END $$;
