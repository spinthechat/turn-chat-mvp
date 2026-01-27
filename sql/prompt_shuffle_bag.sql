-- ============================================
-- Shuffle-Bag Prompt Selection
-- ============================================
-- Ensures no prompt repeats until all prompts in a mode
-- have been used, then reshuffles. Per-room, per-mode tracking.

-- 1. Create table to track used prompts per room per mode
CREATE TABLE IF NOT EXISTS room_used_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(room_id, mode, prompt_id)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS room_used_prompts_room_mode_idx
  ON room_used_prompts (room_id, mode);

-- 2. Function to get next prompt using shuffle-bag algorithm
-- Drop existing function first (return type changed from 3 to 2 columns)
DROP FUNCTION IF EXISTS get_shuffle_bag_prompt(UUID, TEXT);

CREATE OR REPLACE FUNCTION get_shuffle_bag_prompt(
  p_room_id UUID,
  p_mode TEXT
) RETURNS TABLE (prompt_text TEXT, prompt_type TEXT) AS $$
DECLARE
  v_available_count INT;
  v_total_count INT;
  v_selected_id UUID;
  v_selected_text TEXT;
  v_selected_type TEXT;
BEGIN
  -- Count total prompts for this mode
  SELECT COUNT(*) INTO v_total_count
  FROM prompts WHERE mode = p_mode;

  -- Count available (unused) prompts for this room+mode
  SELECT COUNT(*) INTO v_available_count
  FROM prompts p
  WHERE p.mode = p_mode
    AND NOT EXISTS (
      SELECT 1 FROM room_used_prompts rup
      WHERE rup.room_id = p_room_id
        AND rup.mode = p_mode
        AND rup.prompt_id = p.id
    );

  -- If all prompts used, clear the bag and reshuffle
  IF v_available_count = 0 THEN
    DELETE FROM room_used_prompts
    WHERE room_id = p_room_id AND mode = p_mode;
    v_available_count := v_total_count;
  END IF;

  -- Select a random unused prompt
  SELECT p.id, p.text, COALESCE(p.prompt_type, 'text')
  INTO v_selected_id, v_selected_text, v_selected_type
  FROM prompts p
  WHERE p.mode = p_mode
    AND NOT EXISTS (
      SELECT 1 FROM room_used_prompts rup
      WHERE rup.room_id = p_room_id
        AND rup.mode = p_mode
        AND rup.prompt_id = p.id
    )
  ORDER BY random()
  LIMIT 1;

  -- Mark this prompt as used
  IF v_selected_id IS NOT NULL THEN
    INSERT INTO room_used_prompts (room_id, mode, prompt_id)
    VALUES (p_room_id, p_mode, v_selected_id)
    ON CONFLICT (room_id, mode, prompt_id) DO NOTHING;
  END IF;

  -- Return the result (only text and type, not id)
  prompt_text := v_selected_text;
  prompt_type := v_selected_type;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Grant execute permission
GRANT EXECUTE ON FUNCTION get_shuffle_bag_prompt(UUID, TEXT) TO authenticated;

-- 4. Update start_session to use shuffle-bag
CREATE OR REPLACE FUNCTION start_session(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  member_ids UUID[];
  first_user_id UUID;
  first_prompt_text TEXT;
  first_prompt_type TEXT;
  v_prompt_mode TEXT;
  v_prompt_id UUID;
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

  -- Pick a random prompt using shuffle-bag algorithm
  SELECT sbp.prompt_text, sbp.prompt_type
  INTO first_prompt_text, first_prompt_type
  FROM get_shuffle_bag_prompt(p_room_id, v_prompt_mode) sbp;

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

-- 5. Update submit_turn to use shuffle-bag for next prompt
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

  -- Get new prompt using shuffle-bag algorithm
  SELECT sbp.prompt_text, sbp.prompt_type
  INTO new_prompt_text, new_prompt_type
  FROM get_shuffle_bag_prompt(p_room_id, v_prompt_mode) sbp;

  -- Update session with next user
  UPDATE turn_sessions
  SET current_turn_user_id = next_user_id,
      prompt_text = new_prompt_text,
      current_prompt_type = new_prompt_type,
      waiting_until = next_waiting_until,
      last_turn_completed_at = NOW(),
      turn_instance_id = gen_random_uuid()
  WHERE room_id = p_room_id AND is_active = true;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Update submit_photo_turn to use shuffle-bag for next prompt
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

  -- Get new prompt using shuffle-bag algorithm
  SELECT sbp.prompt_text, sbp.prompt_type
  INTO new_prompt_text, new_prompt_type
  FROM get_shuffle_bag_prompt(p_room_id, v_prompt_mode) sbp;

  UPDATE turn_sessions
  SET current_turn_user_id = next_user_id,
      prompt_text = new_prompt_text,
      current_prompt_type = new_prompt_type,
      waiting_until = next_waiting_until,
      last_turn_completed_at = NOW(),
      turn_instance_id = gen_random_uuid()
  WHERE room_id = p_room_id AND is_active = true;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Function to reset a room's prompt bag (useful for testing or mode changes)
CREATE OR REPLACE FUNCTION reset_room_prompt_bag(p_room_id UUID, p_mode TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
  IF p_mode IS NULL THEN
    -- Reset all modes for this room
    DELETE FROM room_used_prompts WHERE room_id = p_room_id;
  ELSE
    -- Reset specific mode
    DELETE FROM room_used_prompts WHERE room_id = p_room_id AND mode = p_mode;
  END IF;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION reset_room_prompt_bag(UUID, TEXT) TO authenticated;

-- 8. When room changes prompt_mode, reset the bag for the new mode
CREATE OR REPLACE FUNCTION update_room_prompt_mode(p_room_id UUID, p_mode TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  -- Validate mode
  IF p_mode NOT IN ('fun', 'family', 'deep', 'flirty', 'couple') THEN
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

  -- Reset the prompt bag for the new mode (fresh start)
  DELETE FROM room_used_prompts WHERE room_id = p_room_id AND mode = p_mode;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
