-- ============================================
-- STORY REPLIES - Reply to stories via DM
-- ============================================

-- 1. Add story reply columns to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS story_id UUID REFERENCES stories(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS story_snapshot JSONB;

-- 2. Add 'story_reply' to message type enum (if using constraint)
-- First drop existing constraint if it exists
DO $$
BEGIN
  -- Try to drop the constraint if it exists
  ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
EXCEPTION WHEN undefined_object THEN
  -- Constraint doesn't exist, that's fine
END $$;

-- 3. Index for efficient story reply lookups
CREATE INDEX IF NOT EXISTS idx_messages_story_id ON messages(story_id) WHERE story_id IS NOT NULL;

-- ============================================
-- RPC: Send story reply (secure, validates access)
-- ============================================
CREATE OR REPLACE FUNCTION send_story_reply(p_story_id UUID, p_text TEXT)
RETURNS TABLE(room_id UUID, message_id UUID) AS $$
DECLARE
  caller_id UUID := auth.uid();
  v_story RECORD;
  v_room_id UUID;
  v_message_id UUID;
  v_snapshot JSONB;
  v_overlay_summary TEXT;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_text IS NULL OR trim(p_text) = '' THEN
    RAISE EXCEPTION 'Reply text cannot be empty';
  END IF;

  -- Fetch story with validation
  SELECT
    s.id,
    s.user_id,
    s.image_url,
    s.created_at,
    s.expires_at,
    s.overlays,
    p.display_name,
    p.email
  INTO v_story
  FROM stories s
  JOIN profiles p ON p.id = s.user_id
  WHERE s.id = p_story_id;

  IF v_story IS NULL THEN
    RAISE EXCEPTION 'Story not found';
  END IF;

  -- Check story hasn't expired
  IF v_story.expires_at < now() THEN
    RAISE EXCEPTION 'Story has expired';
  END IF;

  -- Cannot reply to own story
  IF v_story.user_id = caller_id THEN
    RAISE EXCEPTION 'Cannot reply to your own story';
  END IF;

  -- Check caller follows the story owner (can view their stories)
  IF NOT EXISTS (
    SELECT 1 FROM follows
    WHERE follower_id = caller_id AND following_id = v_story.user_id
  ) THEN
    RAISE EXCEPTION 'You cannot reply to this story';
  END IF;

  -- Extract overlay text summary (first text layer if any)
  v_overlay_summary := NULL;
  IF v_story.overlays IS NOT NULL AND v_story.overlays->'textLayers' IS NOT NULL THEN
    SELECT jsonb_agg(layer->>'text')::text
    INTO v_overlay_summary
    FROM jsonb_array_elements(v_story.overlays->'textLayers') AS layer
    WHERE layer->>'text' IS NOT NULL AND layer->>'text' != ''
    LIMIT 3;
  END IF;

  -- Build story snapshot for message context
  v_snapshot := jsonb_build_object(
    'image_url', v_story.image_url,
    'created_at', v_story.created_at,
    'expires_at', v_story.expires_at,
    'author_id', v_story.user_id,
    'author_name', COALESCE(v_story.display_name, split_part(v_story.email, '@', 1)),
    'overlay_text', v_overlay_summary
  );

  -- Get or create DM room
  v_room_id := get_or_create_dm(v_story.user_id);

  -- Insert story reply message
  INSERT INTO messages (room_id, user_id, type, content, story_id, story_snapshot)
  VALUES (v_room_id, caller_id, 'story_reply', trim(p_text), p_story_id, v_snapshot)
  RETURNING id INTO v_message_id;

  RETURN QUERY SELECT v_room_id, v_message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Check if story is still viewable
-- ============================================
CREATE OR REPLACE FUNCTION can_view_story(p_story_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  v_story RECORD;
BEGIN
  IF caller_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT s.user_id, s.expires_at
  INTO v_story
  FROM stories s
  WHERE s.id = p_story_id;

  IF v_story IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Expired
  IF v_story.expires_at < now() THEN
    RETURN FALSE;
  END IF;

  -- Own story
  IF v_story.user_id = caller_id THEN
    RETURN TRUE;
  END IF;

  -- Check if following
  RETURN EXISTS (
    SELECT 1 FROM follows
    WHERE follower_id = caller_id AND following_id = v_story.user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
