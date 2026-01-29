-- ============================================
-- FOLLOWS FEATURE - Explicit Follow/Unfollow
-- ============================================

-- Follows table
CREATE TABLE IF NOT EXISTS follows (
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows(following_id);

-- Prevent self-follows
ALTER TABLE follows ADD CONSTRAINT no_self_follow CHECK (follower_id != following_id);

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- Users can see who they follow
CREATE POLICY "Users can see own follows"
  ON follows FOR SELECT
  USING (follower_id = auth.uid());

-- Users can see who follows them (for future "followers" count)
CREATE POLICY "Users can see own followers"
  ON follows FOR SELECT
  USING (following_id = auth.uid());

-- Users can insert follows (with room-sharing check in RPC)
CREATE POLICY "Users can insert own follows"
  ON follows FOR INSERT
  WITH CHECK (follower_id = auth.uid());

-- Users can delete their own follows
CREATE POLICY "Users can delete own follows"
  ON follows FOR DELETE
  USING (follower_id = auth.uid());

-- ============================================
-- Helper function: Check if users share a room
-- ============================================
CREATE OR REPLACE FUNCTION shares_room_with(user_a UUID, user_b UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM room_members rm1
    JOIN room_members rm2 ON rm1.room_id = rm2.room_id
    WHERE rm1.user_id = user_a
      AND rm2.user_id = user_b
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Follow a user (with safety check)
-- ============================================
CREATE OR REPLACE FUNCTION follow_user(p_following_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_follower_id UUID := auth.uid();
BEGIN
  -- Safety: Can only follow users you share a room with
  IF NOT shares_room_with(v_follower_id, p_following_id) THEN
    RAISE EXCEPTION 'Cannot follow user: no shared rooms';
  END IF;

  -- Prevent self-follow
  IF v_follower_id = p_following_id THEN
    RAISE EXCEPTION 'Cannot follow yourself';
  END IF;

  -- Insert follow (ignore if already exists)
  INSERT INTO follows (follower_id, following_id)
  VALUES (v_follower_id, p_following_id)
  ON CONFLICT (follower_id, following_id) DO NOTHING;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Unfollow a user
-- ============================================
CREATE OR REPLACE FUNCTION unfollow_user(p_following_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM follows
  WHERE follower_id = auth.uid()
    AND following_id = p_following_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Check if following a user
-- ============================================
CREATE OR REPLACE FUNCTION is_following(p_following_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM follows
    WHERE follower_id = auth.uid()
      AND following_id = p_following_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Update stories feed to use follows table
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
      OR s.user_id IN (        -- Stories from users I follow
        SELECT following_id FROM follows WHERE follower_id = for_user_id
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
-- Migration: Auto-follow existing mutual followers
-- Run this ONCE after creating the follows table
-- ============================================
-- INSERT INTO follows (follower_id, following_id)
-- SELECT DISTINCT rm1.user_id, rm2.user_id
-- FROM room_members rm1
-- JOIN room_members rm2 ON rm1.room_id = rm2.room_id
-- JOIN rooms r ON r.id = rm1.room_id
-- WHERE rm1.user_id != rm2.user_id
--   AND r.type = 'group'
--   -- Both users have sent at least one message
--   AND EXISTS (SELECT 1 FROM messages m WHERE m.room_id = rm1.room_id AND m.user_id = rm1.user_id)
--   AND EXISTS (SELECT 1 FROM messages m WHERE m.room_id = rm2.room_id AND m.user_id = rm2.user_id)
-- ON CONFLICT DO NOTHING;
