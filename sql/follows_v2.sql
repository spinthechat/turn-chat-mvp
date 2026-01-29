-- ============================================
-- FOLLOWS V2 - Effective Following with Auto-Follow
-- ============================================
-- This update adds:
-- 1. Implicit auto-follow for users who share groups and both engaged
-- 2. Manual unfollow overrides that persist
-- 3. Unified "effective following" logic for UI and stories

-- ============================================
-- Follow Overrides Table (for manual unfollows)
-- ============================================
CREATE TABLE IF NOT EXISTS follow_overrides (
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  override_type TEXT NOT NULL DEFAULT 'unfollow' CHECK (override_type IN ('unfollow')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_follow_overrides_follower ON follow_overrides(follower_id);

ALTER TABLE follow_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own overrides"
  ON follow_overrides FOR ALL
  USING (follower_id = auth.uid())
  WITH CHECK (follower_id = auth.uid());

-- ============================================
-- Helper: Check if implicit auto-follow applies
-- Returns true if both users share a group AND both have sent messages there
-- ============================================
CREATE OR REPLACE FUNCTION is_implicit_follow(p_follower_id UUID, p_target_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Same user = no follow relationship
  IF p_follower_id = p_target_id THEN
    RETURN FALSE;
  END IF;

  -- Check if they share at least one group where BOTH have sent a message
  RETURN EXISTS (
    SELECT 1
    FROM room_members rm1
    JOIN room_members rm2 ON rm1.room_id = rm2.room_id
    JOIN rooms r ON r.id = rm1.room_id
    WHERE rm1.user_id = p_follower_id
      AND rm2.user_id = p_target_id
      AND r.type = 'group'
      -- Both users have sent at least one message in this group
      AND EXISTS (
        SELECT 1 FROM messages m1
        WHERE m1.room_id = rm1.room_id AND m1.user_id = p_follower_id
      )
      AND EXISTS (
        SELECT 1 FROM messages m2
        WHERE m2.room_id = rm2.room_id AND m2.user_id = p_target_id
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Helper: Check if manually unfollowed (override exists)
-- ============================================
CREATE OR REPLACE FUNCTION is_manually_unfollowed(p_follower_id UUID, p_target_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM follow_overrides
    WHERE follower_id = p_follower_id
      AND target_id = p_target_id
      AND override_type = 'unfollow'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Main: Check effective following status
-- Returns: 'explicit' | 'implicit' | 'none' | 'unfollowed'
-- ============================================
CREATE OR REPLACE FUNCTION get_follow_status(p_target_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_follower_id UUID := auth.uid();
BEGIN
  IF v_follower_id IS NULL THEN
    RETURN 'none';
  END IF;

  IF v_follower_id = p_target_id THEN
    RETURN 'none';
  END IF;

  -- Check if manually unfollowed (highest priority)
  IF is_manually_unfollowed(v_follower_id, p_target_id) THEN
    RETURN 'unfollowed';
  END IF;

  -- Check explicit follow
  IF EXISTS (
    SELECT 1 FROM follows
    WHERE follower_id = v_follower_id AND following_id = p_target_id
  ) THEN
    RETURN 'explicit';
  END IF;

  -- Check implicit auto-follow
  IF is_implicit_follow(v_follower_id, p_target_id) THEN
    RETURN 'implicit';
  END IF;

  RETURN 'none';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Simplified: Is effectively following? (boolean)
-- ============================================
DROP FUNCTION IF EXISTS is_following(UUID);

CREATE OR REPLACE FUNCTION is_following(p_target_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_status TEXT;
BEGIN
  v_status := get_follow_status(p_target_id);
  RETURN v_status IN ('explicit', 'implicit');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Follow a user (clears any unfollow override)
-- ============================================
DROP FUNCTION IF EXISTS follow_user(UUID);

CREATE OR REPLACE FUNCTION follow_user(p_following_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_follower_id UUID := auth.uid();
  v_status TEXT;
BEGIN
  IF v_follower_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_follower_id = p_following_id THEN
    RAISE EXCEPTION 'Cannot follow yourself';
  END IF;

  -- Safety: Can only follow users you share a room with
  IF NOT shares_room_with(v_follower_id, p_following_id) THEN
    RAISE EXCEPTION 'Cannot follow user: no shared rooms';
  END IF;

  -- Remove any unfollow override
  DELETE FROM follow_overrides
  WHERE follower_id = v_follower_id AND target_id = p_following_id;

  -- Check if implicit follow applies
  IF is_implicit_follow(v_follower_id, p_following_id) THEN
    -- No need to insert explicit follow, implicit is enough
    RETURN 'implicit';
  END IF;

  -- Insert explicit follow
  INSERT INTO follows (follower_id, following_id)
  VALUES (v_follower_id, p_following_id)
  ON CONFLICT (follower_id, following_id) DO NOTHING;

  RETURN 'explicit';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Unfollow a user (creates override if needed)
-- ============================================
DROP FUNCTION IF EXISTS unfollow_user(UUID);

CREATE OR REPLACE FUNCTION unfollow_user(p_following_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_follower_id UUID := auth.uid();
BEGIN
  IF v_follower_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Remove explicit follow if exists
  DELETE FROM follows
  WHERE follower_id = v_follower_id AND following_id = p_following_id;

  -- If implicit follow would apply, we need to create an override
  IF is_implicit_follow(v_follower_id, p_following_id) THEN
    INSERT INTO follow_overrides (follower_id, target_id, override_type)
    VALUES (v_follower_id, p_following_id, 'unfollow')
    ON CONFLICT (follower_id, target_id) DO NOTHING;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Update stories feed to use effective following
-- ============================================
DROP FUNCTION IF EXISTS get_stories_feed(UUID);

CREATE OR REPLACE FUNCTION get_stories_feed(for_user_id UUID)
RETURNS TABLE(
  story_id UUID,
  story_user_id UUID,
  image_url TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  user_email TEXT,
  user_display_name TEXT,
  user_avatar_url TEXT,
  is_viewed BOOLEAN,
  view_count BIGINT,
  overlays JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id as story_id,
    s.user_id as story_user_id,
    s.image_url,
    s.created_at,
    s.expires_at,
    p.email as user_email,
    p.display_name as user_display_name,
    p.avatar_url as user_avatar_url,
    EXISTS (
      SELECT 1 FROM story_views sv
      WHERE sv.story_id = s.id AND sv.viewer_user_id = for_user_id
    ) as is_viewed,
    (SELECT COUNT(*) FROM story_views sv WHERE sv.story_id = s.id) as view_count,
    s.overlays
  FROM stories s
  JOIN profiles p ON p.id = s.user_id
  WHERE s.expires_at > now()
    AND (
      s.user_id = for_user_id  -- Own stories always visible
      OR (
        -- Not manually unfollowed
        NOT is_manually_unfollowed(for_user_id, s.user_id)
        AND (
          -- Explicit follow
          EXISTS (SELECT 1 FROM follows WHERE follower_id = for_user_id AND following_id = s.user_id)
          -- Or implicit auto-follow
          OR is_implicit_follow(for_user_id, s.user_id)
        )
      )
    )
  ORDER BY
    -- Own stories first
    CASE WHEN s.user_id = for_user_id THEN 0 ELSE 1 END,
    -- Then by unseen first
    CASE WHEN EXISTS (
      SELECT 1 FROM story_views sv
      WHERE sv.story_id = s.id AND sv.viewer_user_id = for_user_id
    ) THEN 1 ELSE 0 END,
    -- Then by newest
    s.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Update story reply validation to use effective following
-- ============================================
DROP FUNCTION IF EXISTS send_story_reply(UUID, TEXT);

CREATE OR REPLACE FUNCTION send_story_reply(p_story_id UUID, p_text TEXT)
RETURNS TABLE(room_id UUID, message_id UUID) AS $$
DECLARE
  caller_id UUID := auth.uid();
  v_story RECORD;
  v_room_id UUID;
  v_message_id UUID;
  v_snapshot JSONB;
  v_overlay_summary TEXT;
  v_follow_status TEXT;
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

  IF v_story.expires_at < now() THEN
    RAISE EXCEPTION 'Story has expired';
  END IF;

  IF v_story.user_id = caller_id THEN
    RAISE EXCEPTION 'Cannot reply to your own story';
  END IF;

  -- Check effective following (explicit or implicit, not unfollowed)
  v_follow_status := get_follow_status(v_story.user_id);
  IF v_follow_status NOT IN ('explicit', 'implicit') THEN
    RAISE EXCEPTION 'You cannot reply to this story';
  END IF;

  -- Extract overlay text summary
  v_overlay_summary := NULL;
  IF v_story.overlays IS NOT NULL AND v_story.overlays->'textLayers' IS NOT NULL THEN
    SELECT jsonb_agg(layer->>'text')::text
    INTO v_overlay_summary
    FROM jsonb_array_elements(v_story.overlays->'textLayers') AS layer
    WHERE layer->>'text' IS NOT NULL AND layer->>'text' != ''
    LIMIT 3;
  END IF;

  -- Build story snapshot
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
-- Batch: Get effectively followed user IDs from a list
-- Used for story ring display on multiple avatars
-- ============================================
CREATE OR REPLACE FUNCTION get_effective_following_ids(p_target_ids UUID[])
RETURNS TABLE(user_id UUID) AS $$
DECLARE
  v_follower_id UUID := auth.uid();
BEGIN
  IF v_follower_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT t.id
  FROM unnest(p_target_ids) AS t(id)
  WHERE t.id != v_follower_id
    -- Not manually unfollowed
    AND NOT EXISTS (
      SELECT 1 FROM follow_overrides fo
      WHERE fo.follower_id = v_follower_id
        AND fo.target_id = t.id
        AND fo.override_type = 'unfollow'
    )
    AND (
      -- Explicit follow
      EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = v_follower_id AND f.following_id = t.id
      )
      -- Or implicit auto-follow
      OR is_implicit_follow(v_follower_id, t.id)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Update can_view_story to use effective following
-- ============================================
DROP FUNCTION IF EXISTS can_view_story(UUID);

CREATE OR REPLACE FUNCTION can_view_story(p_story_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  v_story RECORD;
  v_follow_status TEXT;
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

  IF v_story.expires_at < now() THEN
    RETURN FALSE;
  END IF;

  IF v_story.user_id = caller_id THEN
    RETURN TRUE;
  END IF;

  -- Check effective following
  v_follow_status := get_follow_status(v_story.user_id);
  RETURN v_follow_status IN ('explicit', 'implicit');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
