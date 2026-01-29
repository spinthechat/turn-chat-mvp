-- ============================================
-- Profile Gallery (max 16 photos) + Flashbox (YouTube)
-- ============================================

-- ============================================
-- PART 1: Profile Photos Table
-- ============================================

CREATE TABLE IF NOT EXISTS profile_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS profile_photos_user_idx ON profile_photos (user_id, position);

-- ============================================
-- PART 2: RLS for profile_photos
-- ============================================

ALTER TABLE profile_photos ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read
DROP POLICY IF EXISTS "profile_photos_read" ON profile_photos;
CREATE POLICY "profile_photos_read" ON profile_photos
  FOR SELECT TO authenticated
  USING (true);

-- Users can only insert their own photos
DROP POLICY IF EXISTS "profile_photos_insert" ON profile_photos;
CREATE POLICY "profile_photos_insert" ON profile_photos
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can only delete their own photos
DROP POLICY IF EXISTS "profile_photos_delete" ON profile_photos;
CREATE POLICY "profile_photos_delete" ON profile_photos
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Users can only update their own photos (for reordering)
DROP POLICY IF EXISTS "profile_photos_update" ON profile_photos;
CREATE POLICY "profile_photos_update" ON profile_photos
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- ============================================
-- PART 3: Flashbox YouTube URL column
-- ============================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS flashbox_youtube_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS flashbox_youtube_id TEXT;

-- ============================================
-- PART 4: RPC Functions for Profile Photos
-- ============================================

-- Get profile photos for a user
CREATE OR REPLACE FUNCTION get_profile_photos(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  url TEXT,
  storage_path TEXT,
  position INTEGER,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT pp.id, pp.url, pp.storage_path, pp.position, pp.created_at
  FROM profile_photos pp
  WHERE pp.user_id = p_user_id
  ORDER BY pp.position ASC, pp.created_at ASC
  LIMIT 16;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add a profile photo (enforces max 16)
CREATE OR REPLACE FUNCTION add_profile_photo(
  p_url TEXT,
  p_storage_path TEXT
)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count INTEGER;
  v_next_position INTEGER;
  v_new_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Check current count
  SELECT COUNT(*) INTO v_count
  FROM profile_photos
  WHERE user_id = v_user_id;

  IF v_count >= 16 THEN
    RETURN json_build_object('success', false, 'error', 'Maximum 16 photos allowed');
  END IF;

  -- Get next position
  SELECT COALESCE(MAX(position), -1) + 1 INTO v_next_position
  FROM profile_photos
  WHERE user_id = v_user_id;

  -- Insert the photo
  INSERT INTO profile_photos (user_id, url, storage_path, position)
  VALUES (v_user_id, p_url, p_storage_path, v_next_position)
  RETURNING id INTO v_new_id;

  RETURN json_build_object(
    'success', true,
    'photo_id', v_new_id,
    'position', v_next_position
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Delete a profile photo
CREATE OR REPLACE FUNCTION delete_profile_photo(p_photo_id UUID)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_storage_path TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Get storage path before deletion (for cleanup)
  SELECT storage_path INTO v_storage_path
  FROM profile_photos
  WHERE id = p_photo_id AND user_id = v_user_id;

  IF v_storage_path IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Photo not found');
  END IF;

  -- Delete the photo
  DELETE FROM profile_photos
  WHERE id = p_photo_id AND user_id = v_user_id;

  RETURN json_build_object(
    'success', true,
    'storage_path', v_storage_path
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get profile photo count
CREATE OR REPLACE FUNCTION get_profile_photo_count(p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM profile_photos
    WHERE user_id = p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 5: Update Flashbox YouTube URL
-- ============================================

CREATE OR REPLACE FUNCTION update_flashbox_youtube(p_youtube_url TEXT)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_video_id TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- If clearing the URL
  IF p_youtube_url IS NULL OR p_youtube_url = '' THEN
    UPDATE profiles
    SET flashbox_youtube_url = NULL,
        flashbox_youtube_id = NULL,
        updated_at = NOW()
    WHERE id = v_user_id;

    RETURN json_build_object('success', true, 'video_id', NULL);
  END IF;

  -- Extract video ID from various YouTube URL formats
  -- youtu.be/<id>
  -- youtube.com/watch?v=<id>
  -- youtube.com/shorts/<id>
  -- youtube.com/embed/<id>

  -- Try youtu.be format
  IF p_youtube_url ~ 'youtu\.be/([a-zA-Z0-9_-]{11})' THEN
    v_video_id := substring(p_youtube_url from 'youtu\.be/([a-zA-Z0-9_-]{11})');
  -- Try youtube.com/watch?v= format
  ELSIF p_youtube_url ~ '[?&]v=([a-zA-Z0-9_-]{11})' THEN
    v_video_id := substring(p_youtube_url from '[?&]v=([a-zA-Z0-9_-]{11})');
  -- Try youtube.com/shorts/ format
  ELSIF p_youtube_url ~ 'youtube\.com/shorts/([a-zA-Z0-9_-]{11})' THEN
    v_video_id := substring(p_youtube_url from 'youtube\.com/shorts/([a-zA-Z0-9_-]{11})');
  -- Try youtube.com/embed/ format
  ELSIF p_youtube_url ~ 'youtube\.com/embed/([a-zA-Z0-9_-]{11})' THEN
    v_video_id := substring(p_youtube_url from 'youtube\.com/embed/([a-zA-Z0-9_-]{11})');
  ELSE
    RETURN json_build_object('success', false, 'error', 'Invalid YouTube URL');
  END IF;

  -- Update the profile
  UPDATE profiles
  SET flashbox_youtube_url = p_youtube_url,
      flashbox_youtube_id = v_video_id,
      updated_at = NOW()
  WHERE id = v_user_id;

  RETURN json_build_object('success', true, 'video_id', v_video_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 6: Extended Profile Stats with Gallery Count
-- ============================================

CREATE OR REPLACE FUNCTION get_profile_extended(p_user_id UUID)
RETURNS TABLE (
  followers_count BIGINT,
  following_count BIGINT,
  groups_count BIGINT,
  mutual_groups_count BIGINT,
  photos_count INTEGER,
  flashbox_youtube_id TEXT
) AS $$
DECLARE
  v_caller_id UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    -- Followers count (people effectively following this user)
    (
      SELECT COUNT(*)
      FROM (
        -- Explicit followers not unfollowed
        SELECT DISTINCT f.follower_id
        FROM follows f
        WHERE f.following_id = p_user_id
        AND NOT EXISTS (
          SELECT 1 FROM unfollow_overrides uo
          WHERE uo.unfollower_id = f.follower_id AND uo.unfollowed_id = p_user_id
        )
        UNION
        -- Implicit followers (share group + both active) not unfollowed
        SELECT DISTINCT rm1.user_id
        FROM room_members rm1
        JOIN room_members rm2 ON rm1.room_id = rm2.room_id AND rm2.user_id = p_user_id
        JOIN messages m1 ON m1.room_id = rm1.room_id AND m1.user_id = rm1.user_id
        JOIN messages m2 ON m2.room_id = rm1.room_id AND m2.user_id = p_user_id
        WHERE rm1.user_id != p_user_id
        AND NOT EXISTS (
          SELECT 1 FROM unfollow_overrides uo
          WHERE uo.unfollower_id = rm1.user_id AND uo.unfollowed_id = p_user_id
        )
      ) AS followers
    )::BIGINT,

    -- Following count (people this user effectively follows)
    (
      SELECT COUNT(*)
      FROM (
        SELECT DISTINCT f.following_id
        FROM follows f
        WHERE f.follower_id = p_user_id
        AND NOT EXISTS (
          SELECT 1 FROM unfollow_overrides uo
          WHERE uo.unfollower_id = p_user_id AND uo.unfollowed_id = f.following_id
        )
        UNION
        SELECT DISTINCT rm1.user_id
        FROM room_members rm1
        JOIN room_members rm2 ON rm1.room_id = rm2.room_id AND rm2.user_id = p_user_id
        JOIN messages m1 ON m1.room_id = rm1.room_id AND m1.user_id = rm1.user_id
        JOIN messages m2 ON m2.room_id = rm1.room_id AND m2.user_id = p_user_id
        WHERE rm1.user_id != p_user_id
        AND NOT EXISTS (
          SELECT 1 FROM unfollow_overrides uo
          WHERE uo.unfollower_id = p_user_id AND uo.unfollowed_id = rm1.user_id
        )
      ) AS following
    )::BIGINT,

    -- Groups count
    (
      SELECT COUNT(*)
      FROM room_members rm
      JOIN rooms r ON r.id = rm.room_id
      WHERE rm.user_id = p_user_id
      AND r.type = 'group'
    )::BIGINT,

    -- Mutual groups count (only if viewing another user)
    CASE
      WHEN v_caller_id IS NULL OR v_caller_id = p_user_id THEN 0
      ELSE (
        SELECT COUNT(*)
        FROM room_members rm1
        JOIN room_members rm2 ON rm1.room_id = rm2.room_id
        JOIN rooms r ON r.id = rm1.room_id
        WHERE rm1.user_id = p_user_id
        AND rm2.user_id = v_caller_id
        AND r.type = 'group'
      )
    END::BIGINT,

    -- Photos count
    (SELECT COUNT(*)::INTEGER FROM profile_photos WHERE user_id = p_user_id),

    -- Flashbox YouTube ID
    (SELECT p.flashbox_youtube_id FROM profiles p WHERE p.id = p_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 7: Grant Execute Permissions
-- ============================================

GRANT EXECUTE ON FUNCTION get_profile_photos(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION add_profile_photo(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_profile_photo(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_profile_photo_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_flashbox_youtube(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_profile_extended(UUID) TO authenticated;
