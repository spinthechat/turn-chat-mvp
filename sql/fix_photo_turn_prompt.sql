-- ============================================
-- FIX: Photo turn prompt text not displaying
-- ============================================
-- Root cause: anti_stall.sql overwrote submit_photo_turn with a version
-- that inserts type='image' instead of type='turn_response' with JSON.
-- This fix restores the correct function and backfills broken messages.

-- ============================================
-- PART 1: Fix the submit_photo_turn function
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
-- PART 2: Backfill broken photo turn messages
-- ============================================
-- Identifies image messages that were photo turns by looking for
-- "Photo prompt completed!" system messages that follow them.
-- Converts them to proper turn_response format with a fallback prompt.

-- First, let's see what we'd fix (run this SELECT first to preview):
-- SELECT
--   img.id as image_id,
--   img.room_id,
--   img.user_id,
--   img.content as image_url,
--   img.created_at,
--   sys.content as system_msg
-- FROM messages img
-- JOIN messages sys ON sys.room_id = img.room_id
--   AND sys.type = 'system'
--   AND sys.content = 'Photo prompt completed!'
--   AND sys.created_at > img.created_at
--   AND sys.created_at < img.created_at + INTERVAL '5 seconds'
-- WHERE img.type = 'image'
--   AND img.content LIKE 'http%'  -- URL
-- ORDER BY img.created_at DESC;

-- Now do the actual fix:
WITH photo_turns_to_fix AS (
  SELECT DISTINCT ON (img.id)
    img.id as image_id,
    img.content as image_url,
    sys.id as system_msg_id
  FROM messages img
  JOIN messages sys ON sys.room_id = img.room_id
    AND sys.type = 'system'
    AND sys.content = 'Photo prompt completed!'
    AND sys.created_at > img.created_at
    AND sys.created_at < img.created_at + INTERVAL '5 seconds'
  WHERE img.type = 'image'
    AND img.content LIKE 'http%'
)
UPDATE messages m
SET
  type = 'turn_response',
  content = json_build_object(
    'kind', 'photo_turn',
    'prompt', '(Photo prompt)',  -- Fallback since original prompt not available
    'image_url', ptf.image_url
  )::TEXT
FROM photo_turns_to_fix ptf
WHERE m.id = ptf.image_id;

-- Delete the redundant "Photo prompt completed!" system messages
DELETE FROM messages
WHERE type = 'system'
  AND content = 'Photo prompt completed!';

-- ============================================
-- VERIFICATION
-- ============================================
-- Check that no image messages remain that should be photo turns:
-- SELECT COUNT(*) FROM messages WHERE type = 'image';
--
-- Check photo turn messages are properly formatted:
-- SELECT id, type, content::json->>'kind' as kind, content::json->>'prompt' as prompt
-- FROM messages
-- WHERE type = 'turn_response'
--   AND content LIKE '%photo_turn%'
-- ORDER BY created_at DESC
-- LIMIT 10;
