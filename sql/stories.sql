-- ============================================
-- STORIES FEATURE - Database Schema
-- ============================================

-- Stories table
CREATE TABLE IF NOT EXISTS stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

-- Story views table
CREATE TABLE IF NOT EXISTS story_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(story_id, viewer_user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_stories_user_id ON stories(user_id);
CREATE INDEX IF NOT EXISTS idx_stories_expires_at ON stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_created_at ON stories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_views_story_id ON story_views(story_id);
CREATE INDEX IF NOT EXISTS idx_story_views_viewer_user_id ON story_views(viewer_user_id);

-- ============================================
-- Helper function: Check if two users are mutual followers
-- (both have sent at least one message in a shared group)
-- ============================================
CREATE OR REPLACE FUNCTION are_mutual_followers(user_a UUID, user_b UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Users are mutual followers if they share at least one group
  -- where BOTH have sent at least one message
  RETURN EXISTS (
    SELECT 1
    FROM room_members rm1
    JOIN room_members rm2 ON rm1.room_id = rm2.room_id
    JOIN rooms r ON r.id = rm1.room_id
    WHERE rm1.user_id = user_a
      AND rm2.user_id = user_b
      AND r.type = 'group'
      -- Both users have sent at least one message in this group
      AND EXISTS (
        SELECT 1 FROM messages m1
        WHERE m1.room_id = rm1.room_id AND m1.user_id = user_a
      )
      AND EXISTS (
        SELECT 1 FROM messages m2
        WHERE m2.room_id = rm2.room_id AND m2.user_id = user_b
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Function to get all mutual followers for a user
-- ============================================
CREATE OR REPLACE FUNCTION get_mutual_followers(for_user_id UUID)
RETURNS TABLE(follower_id UUID) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT rm2.user_id
  FROM room_members rm1
  JOIN room_members rm2 ON rm1.room_id = rm2.room_id
  JOIN rooms r ON r.id = rm1.room_id
  WHERE rm1.user_id = for_user_id
    AND rm2.user_id != for_user_id
    AND r.type = 'group'
    -- Both users have sent at least one message in this group
    AND EXISTS (
      SELECT 1 FROM messages m1
      WHERE m1.room_id = rm1.room_id AND m1.user_id = for_user_id
    )
    AND EXISTS (
      SELECT 1 FROM messages m2
      WHERE m2.room_id = rm2.room_id AND m2.user_id = rm2.user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Function to get stories feed for a user
-- Returns active stories from mutual followers + own stories
-- ============================================
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
  view_count BIGINT
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
    (SELECT COUNT(*) FROM story_views sv WHERE sv.story_id = s.id) as view_count
  FROM stories s
  JOIN profiles p ON p.id = s.user_id
  WHERE s.expires_at > now()
    AND (
      s.user_id = for_user_id  -- Own stories
      OR s.user_id IN (SELECT get_mutual_followers(for_user_id))  -- Mutual followers' stories
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
-- Function to get viewers for a story (owner only)
-- ============================================
CREATE OR REPLACE FUNCTION get_story_viewers(p_story_id UUID, p_requesting_user_id UUID)
RETURNS TABLE(
  viewer_id UUID,
  viewer_email TEXT,
  viewer_display_name TEXT,
  viewer_avatar_url TEXT,
  viewed_at TIMESTAMPTZ
) AS $$
BEGIN
  -- Only story owner can see viewers
  IF NOT EXISTS (
    SELECT 1 FROM stories WHERE id = p_story_id AND user_id = p_requesting_user_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sv.viewer_user_id as viewer_id,
    p.email as viewer_email,
    p.display_name as viewer_display_name,
    p.avatar_url as viewer_avatar_url,
    sv.created_at as viewed_at
  FROM story_views sv
  JOIN profiles p ON p.id = sv.viewer_user_id
  WHERE sv.story_id = p_story_id
  ORDER BY sv.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_views ENABLE ROW LEVEL SECURITY;

-- Stories: Users can read their own stories
CREATE POLICY "Users can read own stories"
  ON stories FOR SELECT
  USING (auth.uid() = user_id);

-- Stories: Users can read mutual followers' stories (via the function, but also direct access)
CREATE POLICY "Users can read mutual followers stories"
  ON stories FOR SELECT
  USING (
    expires_at > now()
    AND (
      user_id = auth.uid()
      OR are_mutual_followers(auth.uid(), user_id)
    )
  );

-- Stories: Users can insert their own stories
CREATE POLICY "Users can insert own stories"
  ON stories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Stories: Users can delete their own stories
CREATE POLICY "Users can delete own stories"
  ON stories FOR DELETE
  USING (auth.uid() = user_id);

-- Story views: Users can insert views for stories they can see
CREATE POLICY "Users can insert story views"
  ON story_views FOR INSERT
  WITH CHECK (
    auth.uid() = viewer_user_id
    AND EXISTS (
      SELECT 1 FROM stories s
      WHERE s.id = story_id
        AND s.expires_at > now()
        AND (s.user_id = auth.uid() OR are_mutual_followers(auth.uid(), s.user_id))
    )
  );

-- Story views: Story owners can read views of their stories
CREATE POLICY "Story owners can read views"
  ON story_views FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM stories s
      WHERE s.id = story_id AND s.user_id = auth.uid()
    )
  );

-- Story views: Users can read their own view records
CREATE POLICY "Users can read own views"
  ON story_views FOR SELECT
  USING (viewer_user_id = auth.uid());

-- ============================================
-- Storage bucket for stories (run in Supabase dashboard)
-- ============================================
-- INSERT INTO storage.buckets (id, name, public) VALUES ('stories', 'stories', true);

-- Storage RLS policies (run in Supabase dashboard):
-- CREATE POLICY "Anyone can read story images"
--   ON storage.objects FOR SELECT
--   USING (bucket_id = 'stories');
--
-- CREATE POLICY "Authenticated users can upload story images"
--   ON storage.objects FOR INSERT
--   WITH CHECK (bucket_id = 'stories' AND auth.role() = 'authenticated');
--
-- CREATE POLICY "Users can delete own story images"
--   ON storage.objects FOR DELETE
--   USING (bucket_id = 'stories' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================
-- Cleanup job: Delete expired stories
-- Run this periodically via cron or Supabase Edge Function
-- ============================================
-- DELETE FROM stories WHERE expires_at < now();
