-- ============================================
-- STORIES OVERLAYS - Add text overlay support
-- ============================================

-- Add overlays column to stories table (JSONB for flexibility)
ALTER TABLE stories ADD COLUMN IF NOT EXISTS overlays JSONB;

-- Add comment describing the expected structure
COMMENT ON COLUMN stories.overlays IS 'Story overlays in format: { textLayers: [...], dimOverlay: boolean }. textLayers contains objects with: id, text, x, y, scale, rotation, font, size, color, background, align';

-- Drop existing function first (return type changed)
DROP FUNCTION IF EXISTS get_stories_feed(UUID);

-- Recreate with overlays column in return type
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
