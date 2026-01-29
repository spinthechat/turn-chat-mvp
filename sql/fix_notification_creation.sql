-- ============================================
-- Fix: Ensure nudge and turn notifications are created
-- Run this AFTER all other SQL migrations
-- ============================================

-- Drop existing functions first to allow signature changes
DROP FUNCTION IF EXISTS send_nudge(UUID);
DROP FUNCTION IF EXISTS advance_turn(UUID, TEXT, UUID);

-- ============================================
-- PART 1: Updated send_nudge with notification creation
-- ============================================

CREATE OR REPLACE FUNCTION send_nudge(p_room_id UUID)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
  v_current_turn_user_id UUID;
  v_current_turn_index INTEGER;
  v_room_name TEXT;
  v_is_member BOOLEAN;
  v_prompt_text TEXT;
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

  -- Get current turn user, index, and prompt from active session
  SELECT current_turn_user_id, current_turn_index, prompt_text
  INTO v_current_turn_user_id, v_current_turn_index, v_prompt_text
  FROM turn_sessions
  WHERE room_id = p_room_id AND is_active = true;

  IF v_current_turn_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No active turn session');
  END IF;

  -- Block self-nudge
  IF v_current_turn_user_id = caller_id THEN
    RETURN json_build_object('success', false, 'error', 'Cannot nudge yourself');
  END IF;

  -- Get room name
  SELECT name INTO v_room_name FROM rooms WHERE id = p_room_id;

  -- Try to insert the nudge (will fail if already nudged this turn due to unique constraint)
  BEGIN
    INSERT INTO nudges (room_id, nudger_user_id, nudged_user_id, turn_index)
    VALUES (p_room_id, caller_id, v_current_turn_user_id, v_current_turn_index);
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('success', false, 'error', 'Already nudged this turn');
  END;

  -- Create notification for the nudged user
  INSERT INTO notifications (user_id, actor_user_id, type, room_id, metadata)
  VALUES (
    v_current_turn_user_id,
    caller_id,
    'nudged_you',
    p_room_id,
    jsonb_build_object('prompt_text', v_prompt_text, 'room_name', v_room_name)
  );

  RETURN json_build_object(
    'success', true,
    'nudged_user_id', v_current_turn_user_id,
    'room_name', v_room_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 2: Updated advance_turn with notification creation
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
  v_room_name TEXT;
BEGIN
  -- Get active session
  SELECT * INTO sess FROM turn_sessions WHERE room_id = p_room_id AND is_active = true;
  IF sess IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No active session');
  END IF;

  -- Get room settings
  SELECT COALESCE(prompt_interval_minutes, 0), COALESCE(prompt_mode, 'fun'), name
  INTO room_interval, v_prompt_mode, v_room_name
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

  -- Get new prompt using shuffle bag
  SELECT prompt_text, prompt_type INTO new_prompt_text, new_prompt_type
  FROM get_shuffle_bag_prompt(p_room_id, v_prompt_mode);

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

    -- Create notification for skipped user
    INSERT INTO notifications (user_id, type, room_id, metadata)
    VALUES (
      p_skipped_user_id,
      'turn_skipped',
      p_room_id,
      jsonb_build_object('reason', p_reason, 'room_name', v_room_name)
    );

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

  -- Create notification for the next user (their turn now)
  -- Only if it's a different user (not notifying yourself)
  IF next_user_id IS DISTINCT FROM sess.current_turn_user_id THEN
    INSERT INTO notifications (user_id, type, room_id, metadata)
    VALUES (
      next_user_id,
      'your_turn',
      p_room_id,
      jsonb_build_object(
        'prompt_text', new_prompt_text,
        'prompt_type', new_prompt_type,
        'room_name', v_room_name
      )
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'next_user_id', next_user_id,
    'reason', p_reason
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 3: Grant permissions
-- ============================================

GRANT EXECUTE ON FUNCTION send_nudge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION advance_turn(UUID, TEXT, UUID) TO authenticated;
