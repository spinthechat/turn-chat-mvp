-- ============================================
-- NUDGE SYSTEM CONSOLIDATED FIX
-- ============================================
-- This file consolidates all nudge logic and fixes the regression where
-- fix_notification_creation.sql accidentally reverted from turn_instance_id
-- back to turn_index, breaking nudge reset on turn advance.
--
-- ROOT CAUSE: Multiple files defined send_nudge with different tracking:
--   - nudges.sql: used turn_index (old)
--   - nudge_turn_instance_fix.sql: migrated to turn_instance_id (correct)
--   - fix_notification_creation.sql: regressed to turn_index (broken!)
--
-- CORRECT BEHAVIOR:
--   1. Nudges are scoped by turn_instance_id (UUID that changes each turn)
--   2. When turn advances, new turn_instance_id is generated
--   3. Previous nudges don't affect new turn (different turn_instance_id)
--   4. Each user gets ONE nudge per turn_instance_id
--
-- Run this LAST to ensure it overrides all previous definitions.
-- ============================================

-- ============================================
-- PART 1: Ensure schema is correct
-- ============================================

-- Ensure turn_instance_id column exists on nudges
ALTER TABLE nudges ADD COLUMN IF NOT EXISTS turn_instance_id UUID;

-- Make turn_index nullable (we don't use it anymore, but keep for compatibility)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nudges' AND column_name = 'turn_index' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE nudges ALTER COLUMN turn_index DROP NOT NULL;
  END IF;
END $$;

-- Drop old indexes that might conflict
DROP INDEX IF EXISTS nudges_once_per_day_idx;
DROP INDEX IF EXISTS nudges_once_per_turn_idx;

-- Create the correct unique index on turn_instance_id
-- This prevents duplicate nudges for the same user in the same turn
DROP INDEX IF EXISTS nudges_per_turn_instance_idx;
CREATE UNIQUE INDEX nudges_per_turn_instance_idx
  ON nudges (room_id, nudger_user_id, turn_instance_id)
  WHERE turn_instance_id IS NOT NULL;  -- Only enforce for non-null values

-- Lookup index for performance
DROP INDEX IF EXISTS nudges_lookup_idx;
CREATE INDEX nudges_lookup_idx
  ON nudges (room_id, turn_instance_id, nudger_user_id);

-- ============================================
-- PART 2: has_nudged_this_turn - Check if user nudged current turn
-- ============================================

DROP FUNCTION IF EXISTS has_nudged_this_turn(UUID);
CREATE OR REPLACE FUNCTION has_nudged_this_turn(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_turn_instance_id UUID;
BEGIN
  -- Get current turn_instance_id from active session
  SELECT turn_instance_id INTO v_turn_instance_id
  FROM turn_sessions
  WHERE room_id = p_room_id AND is_active = true;

  -- If no active session or no turn_instance_id, user hasn't nudged
  IF v_turn_instance_id IS NULL THEN
    RETURN false;
  END IF;

  -- Check if user has nudged during THIS specific turn instance
  RETURN EXISTS (
    SELECT 1 FROM nudges
    WHERE room_id = p_room_id
      AND nudger_user_id = auth.uid()
      AND turn_instance_id = v_turn_instance_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 3: check_all_nudged - Check if all eligible members nudged
-- ============================================

DROP FUNCTION IF EXISTS check_all_nudged(UUID);
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

  -- Count eligible members (everyone except current turn holder)
  SELECT COUNT(*) INTO v_eligible_count
  FROM room_members
  WHERE room_id = p_room_id AND user_id != v_current_turn_user_id;

  -- Count nudges for this turn instance
  SELECT COUNT(DISTINCT nudger_user_id) INTO v_nudge_count
  FROM nudges
  WHERE room_id = p_room_id
    AND turn_instance_id = v_turn_instance_id
    AND nudger_user_id != v_current_turn_user_id;

  -- All nudged if counts match and there's at least 1 eligible member
  RETURN v_eligible_count > 0 AND v_nudge_count >= v_eligible_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 4: send_nudge - Main nudge function (FIXED)
-- ============================================
-- This is the canonical version that:
-- 1. Uses turn_instance_id (not turn_index)
-- 2. Creates notification for nudged user
-- 3. Checks/sets all_nudged_at
-- 4. Handles legacy sessions without turn_instance_id

DROP FUNCTION IF EXISTS send_nudge(UUID);
CREATE OR REPLACE FUNCTION send_nudge(p_room_id UUID)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
  v_current_turn_user_id UUID;
  v_turn_instance_id UUID;
  v_room_name TEXT;
  v_prompt_text TEXT;
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

  -- Get current turn user, turn_instance_id, and prompt from active session
  SELECT current_turn_user_id, turn_instance_id, prompt_text
  INTO v_current_turn_user_id, v_turn_instance_id, v_prompt_text
  FROM turn_sessions
  WHERE room_id = p_room_id AND is_active = true;

  IF v_current_turn_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No active turn session');
  END IF;

  -- FIX: If turn_instance_id is null (legacy session), generate one now
  -- This ensures we always have a turn_instance_id to track nudges
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

  -- Get room name for notification
  SELECT name INTO v_room_name FROM rooms WHERE id = p_room_id;

  -- Try to insert the nudge
  -- CRITICAL: Use turn_instance_id (not turn_index!) for proper turn scoping
  -- The unique index nudges_per_turn_instance_idx prevents duplicates
  BEGIN
    INSERT INTO nudges (room_id, nudger_user_id, nudged_user_id, turn_instance_id, created_at)
    VALUES (p_room_id, caller_id, v_current_turn_user_id, v_turn_instance_id, NOW());
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

  -- Check if all members have now nudged
  v_all_nudged := check_all_nudged(p_room_id);

  -- If all nudged and not already set, record the timestamp for auto-skip logic
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
-- PART 5: get_nudge_status - UI status function
-- ============================================

DROP FUNCTION IF EXISTS get_nudge_status(UUID);
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
    RETURN json_build_object('active', false);
  END IF;

  -- Count eligible members (everyone except current turn holder)
  SELECT COUNT(*) INTO v_eligible_count
  FROM room_members
  WHERE room_id = p_room_id AND user_id != v_current_turn_user_id;

  -- Count nudges for this turn instance
  SELECT COUNT(DISTINCT nudger_user_id) INTO v_nudge_count
  FROM nudges
  WHERE room_id = p_room_id AND turn_instance_id = v_turn_instance_id;

  -- Check if current user has nudged this turn
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
-- PART 6: advance_turn - Turn advancement with notifications
-- ============================================
-- Generates new turn_instance_id on each turn, resetting nudge eligibility

DROP FUNCTION IF EXISTS advance_turn(UUID, TEXT, UUID);
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
  -- CRITICAL: Generate new turn_instance_id to reset nudge eligibility
  UPDATE turn_sessions
  SET current_turn_user_id = next_user_id,
      current_turn_index = current_turn_index + 1,
      turn_instance_id = gen_random_uuid(),  -- Resets nudge eligibility for ALL users
      prompt_text = new_prompt_text,
      current_prompt_type = new_prompt_type,
      waiting_until = next_waiting_until,
      last_turn_completed_at = NOW(),
      all_nudged_at = NULL  -- Reset for new turn
  WHERE room_id = p_room_id AND is_active = true;

  -- Create notification for the next user (their turn now)
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
-- PART 7: Ensure all active sessions have turn_instance_id
-- ============================================

UPDATE turn_sessions
SET turn_instance_id = gen_random_uuid()
WHERE is_active = true AND turn_instance_id IS NULL;

-- ============================================
-- PART 8: Clean up stale nudges that used old turn_index system
-- ============================================
-- Delete nudges that have turn_instance_id = NULL (old system)
-- These are stale and could block new nudges incorrectly

DELETE FROM nudges WHERE turn_instance_id IS NULL;

-- ============================================
-- PART 9: Grant permissions
-- ============================================

GRANT EXECUTE ON FUNCTION has_nudged_this_turn(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION check_all_nudged(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION send_nudge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_nudge_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION advance_turn(UUID, TEXT, UUID) TO authenticated;
