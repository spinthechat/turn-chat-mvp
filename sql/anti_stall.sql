-- ============================================
-- Anti-Stall Logic: Auto-skip after 24h of all nudged
-- ============================================

-- ============================================
-- PART 1: Add tracking columns
-- ============================================

-- 1. Add all_nudged_at to turn_sessions (when all members nudged)
ALTER TABLE turn_sessions ADD COLUMN IF NOT EXISTS all_nudged_at TIMESTAMPTZ;

-- 2. Add missed_streak to room_members (consecutive missed turns)
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS missed_streak INTEGER DEFAULT 0;

-- ============================================
-- PART 2: Function to check if all members have nudged
-- ============================================

CREATE OR REPLACE FUNCTION check_all_nudged(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_turn_instance_id UUID;
  v_current_turn_user_id UUID;
  v_eligible_count INTEGER;
  v_nudge_count INTEGER;
BEGIN
  -- Get current turn info
  SELECT turn_instance_id, current_turn_user_id
  INTO v_turn_instance_id, v_current_turn_user_id
  FROM turn_sessions
  WHERE room_id = p_room_id AND is_active = true;

  IF v_turn_instance_id IS NULL OR v_current_turn_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Count eligible members (everyone except current turn user)
  SELECT COUNT(*) INTO v_eligible_count
  FROM room_members
  WHERE room_id = p_room_id AND user_id != v_current_turn_user_id;

  -- Count nudges for this turn instance
  SELECT COUNT(DISTINCT nudger_user_id) INTO v_nudge_count
  FROM nudges
  WHERE room_id = p_room_id
    AND turn_instance_id = v_turn_instance_id
    AND nudger_user_id != v_current_turn_user_id;

  -- All nudged if counts match and there's at least 1 eligible
  RETURN v_eligible_count > 0 AND v_nudge_count >= v_eligible_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 3: Update send_nudge to check all_nudged
-- ============================================

CREATE OR REPLACE FUNCTION send_nudge(p_room_id UUID)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
  v_current_turn_user_id UUID;
  v_turn_instance_id UUID;
  v_room_name TEXT;
  v_is_member BOOLEAN;
  v_all_nudged BOOLEAN;
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

  -- Try to insert the nudge
  BEGIN
    INSERT INTO nudges (room_id, nudger_user_id, nudged_user_id, turn_instance_id, created_at)
    VALUES (p_room_id, caller_id, v_current_turn_user_id, v_turn_instance_id, NOW());
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('success', false, 'error', 'Already nudged this turn');
  END;

  -- Check if all members have now nudged
  v_all_nudged := check_all_nudged(p_room_id);

  -- If all nudged and not already set, set all_nudged_at
  IF v_all_nudged THEN
    UPDATE turn_sessions
    SET all_nudged_at = COALESCE(all_nudged_at, NOW())
    WHERE room_id = p_room_id AND is_active = true AND all_nudged_at IS NULL;
  END IF;

  RETURN json_build_object(
    'success', true,
    'nudged_user_id', v_current_turn_user_id,
    'room_name', v_room_name,
    'all_nudged', v_all_nudged
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 4: Canonical advance_turn function
-- ============================================

CREATE OR REPLACE FUNCTION advance_turn(
  p_room_id UUID,
  p_reason TEXT DEFAULT 'completed',  -- 'completed', 'auto_skip', 'host_skip'
  p_skipped_user_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  sess RECORD;
  next_user_id UUID;
  new_prompt_text TEXT;
  new_prompt_type TEXT;
  v_prompt_mode TEXT;
  room_interval INT;
  next_waiting_until TIMESTAMPTZ;
BEGIN
  -- Get active session
  SELECT * INTO sess FROM turn_sessions WHERE room_id = p_room_id AND is_active = true;
  IF sess IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No active session');
  END IF;

  -- Get room settings
  SELECT COALESCE(prompt_interval_minutes, 0), COALESCE(prompt_mode, 'fun')
  INTO room_interval, v_prompt_mode
  FROM rooms WHERE id = p_room_id;

  -- Get next user
  next_user_id := get_next_turn_user(p_room_id, COALESCE(p_skipped_user_id, sess.current_turn_user_id));

  IF next_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Could not determine next user');
  END IF;

  -- Calculate cooldown
  IF room_interval > 0 THEN
    next_waiting_until := NOW() + (room_interval || ' minutes')::INTERVAL;
  ELSE
    next_waiting_until := NULL;
  END IF;

  -- Get new prompt
  SELECT text, COALESCE(prompt_type, 'text') INTO new_prompt_text, new_prompt_type
  FROM prompts
  WHERE mode = v_prompt_mode OR mode IS NULL
  ORDER BY random() LIMIT 1;

  -- Handle missed streak based on reason
  IF p_reason = 'completed' THEN
    -- Reset missed_streak for the user who completed
    UPDATE room_members
    SET missed_streak = 0
    WHERE room_id = p_room_id AND user_id = sess.current_turn_user_id;
  ELSIF p_reason IN ('auto_skip', 'host_skip') AND p_skipped_user_id IS NOT NULL THEN
    -- Increment missed_streak for skipped user
    UPDATE room_members
    SET missed_streak = missed_streak + 1
    WHERE room_id = p_room_id AND user_id = p_skipped_user_id;

    -- Check if user should be removed (3+ consecutive misses)
    IF (SELECT missed_streak FROM room_members WHERE room_id = p_room_id AND user_id = p_skipped_user_id) >= 3 THEN
      -- Remove the member
      DELETE FROM room_members WHERE room_id = p_room_id AND user_id = p_skipped_user_id;

      -- Post system message
      INSERT INTO messages (room_id, user_id, type, content)
      VALUES (p_room_id, NULL, 'system', 'A member was removed due to inactivity');

      -- Recalculate next user after removal
      next_user_id := get_next_turn_user(p_room_id, sess.current_turn_user_id);
    END IF;
  END IF;

  -- Update session with new turn
  UPDATE turn_sessions
  SET current_turn_user_id = next_user_id,
      current_turn_index = current_turn_index + 1,
      turn_instance_id = gen_random_uuid(),
      prompt_text = new_prompt_text,
      current_prompt_type = new_prompt_type,
      waiting_until = next_waiting_until,
      last_turn_completed_at = NOW(),
      all_nudged_at = NULL  -- Reset for new turn
  WHERE room_id = p_room_id AND is_active = true;

  RETURN json_build_object(
    'success', true,
    'next_user_id', next_user_id,
    'reason', p_reason
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 5: Function for auto-skip cron job
-- ============================================

CREATE OR REPLACE FUNCTION process_stalled_turns()
RETURNS TABLE(room_id UUID, skipped_user_id UUID, removed BOOLEAN) AS $$
DECLARE
  sess RECORD;
  v_result JSON;
  v_removed BOOLEAN;
BEGIN
  -- Find all sessions where:
  -- - all_nudged_at is set
  -- - 24 hours have passed since all_nudged_at
  -- - turn is still active (not completed)
  FOR sess IN
    SELECT ts.room_id, ts.current_turn_user_id, ts.all_nudged_at
    FROM turn_sessions ts
    WHERE ts.is_active = true
      AND ts.all_nudged_at IS NOT NULL
      AND ts.all_nudged_at <= NOW() - INTERVAL '24 hours'
  LOOP
    -- Check if user is about to be removed
    v_removed := (
      SELECT missed_streak >= 2  -- Will be 3 after increment
      FROM room_members
      WHERE room_members.room_id = sess.room_id
        AND room_members.user_id = sess.current_turn_user_id
    );

    -- Auto-skip this turn
    v_result := advance_turn(sess.room_id, 'auto_skip', sess.current_turn_user_id);

    IF (v_result->>'success')::boolean THEN
      room_id := sess.room_id;
      skipped_user_id := sess.current_turn_user_id;
      removed := COALESCE(v_removed, false);
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 6: Function to get nudge status for UI
-- ============================================

CREATE OR REPLACE FUNCTION get_nudge_status(p_room_id UUID)
RETURNS JSON AS $$
DECLARE
  v_turn_instance_id UUID;
  v_current_turn_user_id UUID;
  v_all_nudged_at TIMESTAMPTZ;
  v_eligible_count INTEGER;
  v_nudge_count INTEGER;
  v_user_has_nudged BOOLEAN;
BEGIN
  -- Get current turn info
  SELECT turn_instance_id, current_turn_user_id, all_nudged_at
  INTO v_turn_instance_id, v_current_turn_user_id, v_all_nudged_at
  FROM turn_sessions
  WHERE room_id = p_room_id AND is_active = true;

  IF v_turn_instance_id IS NULL THEN
    RETURN json_build_object(
      'active', false
    );
  END IF;

  -- Count eligible members
  SELECT COUNT(*) INTO v_eligible_count
  FROM room_members
  WHERE room_id = p_room_id AND user_id != v_current_turn_user_id;

  -- Count nudges for this turn
  SELECT COUNT(DISTINCT nudger_user_id) INTO v_nudge_count
  FROM nudges
  WHERE room_id = p_room_id AND turn_instance_id = v_turn_instance_id;

  -- Check if current user has nudged
  v_user_has_nudged := EXISTS (
    SELECT 1 FROM nudges
    WHERE room_id = p_room_id
      AND turn_instance_id = v_turn_instance_id
      AND nudger_user_id = auth.uid()
  );

  RETURN json_build_object(
    'active', true,
    'eligible_count', v_eligible_count,
    'nudge_count', v_nudge_count,
    'all_nudged', v_nudge_count >= v_eligible_count AND v_eligible_count > 0,
    'all_nudged_at', v_all_nudged_at,
    'user_has_nudged', v_user_has_nudged,
    'current_turn_user_id', v_current_turn_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 7: Update submit_turn to use advance_turn
-- ============================================

CREATE OR REPLACE FUNCTION submit_turn(p_room_id UUID, p_content TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  sess RECORD;
  curr_turn_user UUID;
  v_result JSON;
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

  -- Insert turn response
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, caller_id, 'turn_response', p_content);

  -- Advance turn using canonical function
  v_result := advance_turn(p_room_id, 'completed', NULL);

  IF NOT (v_result->>'success')::boolean THEN
    RAISE EXCEPTION '%', v_result->>'error';
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 8: Update submit_photo_turn to use advance_turn
-- ============================================

CREATE OR REPLACE FUNCTION submit_photo_turn(p_room_id UUID, p_image_url TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  sess RECORD;
  curr_turn_user UUID;
  v_result JSON;
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

  -- Build JSON content for photo turn response (stores prompt snapshot)
  photo_turn_content := json_build_object(
    'kind', 'photo_turn',
    'prompt', sess.prompt_text,
    'image_url', p_image_url
  )::TEXT;

  -- Insert as turn_response with JSON content (NOT 'image' type)
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, caller_id, 'turn_response', photo_turn_content);

  -- Advance turn using canonical function
  v_result := advance_turn(p_room_id, 'completed', NULL);

  IF NOT (v_result->>'success')::boolean THEN
    RAISE EXCEPTION '%', v_result->>'error';
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 9: Grant execute permissions
-- ============================================

GRANT EXECUTE ON FUNCTION check_all_nudged(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_nudge_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION advance_turn(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION process_stalled_turns() TO authenticated;
