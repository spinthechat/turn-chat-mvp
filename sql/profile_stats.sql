-- ============================================
-- PROFILE STATS - Social stats and lists
-- ============================================

-- ============================================
-- Get profile stats for a user
-- Returns followers, following, groups, mutual groups counts
-- ============================================
CREATE OR REPLACE FUNCTION get_profile_stats(p_user_id UUID)
RETURNS TABLE(
  followers_count BIGINT,
  following_count BIGINT,
  groups_count BIGINT,
  mutual_groups_count BIGINT
) AS $$
DECLARE
  v_current_user UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    -- Followers: users who effectively follow p_user_id
    (
      SELECT COUNT(DISTINCT u.id)
      FROM auth.users u
      WHERE u.id != p_user_id
        -- Not manually unfollowed
        AND NOT EXISTS (
          SELECT 1 FROM follow_overrides fo
          WHERE fo.follower_id = u.id AND fo.target_id = p_user_id AND fo.override_type = 'unfollow'
        )
        AND (
          -- Explicit follow
          EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.following_id = p_user_id)
          -- Or implicit auto-follow
          OR is_implicit_follow(u.id, p_user_id)
        )
    )::BIGINT as followers_count,

    -- Following: users that p_user_id effectively follows
    (
      SELECT COUNT(DISTINCT u.id)
      FROM auth.users u
      WHERE u.id != p_user_id
        AND NOT EXISTS (
          SELECT 1 FROM follow_overrides fo
          WHERE fo.follower_id = p_user_id AND fo.target_id = u.id AND fo.override_type = 'unfollow'
        )
        AND (
          EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = p_user_id AND f.following_id = u.id)
          OR is_implicit_follow(p_user_id, u.id)
        )
    )::BIGINT as following_count,

    -- Groups: total group chats user is member of
    (
      SELECT COUNT(DISTINCT r.id)
      FROM rooms r
      JOIN room_members rm ON rm.room_id = r.id
      WHERE rm.user_id = p_user_id AND r.type = 'group'
    )::BIGINT as groups_count,

    -- Mutual groups: groups shared between p_user_id and current user
    (
      SELECT COUNT(DISTINCT rm1.room_id)
      FROM room_members rm1
      JOIN room_members rm2 ON rm1.room_id = rm2.room_id
      JOIN rooms r ON r.id = rm1.room_id
      WHERE rm1.user_id = p_user_id
        AND rm2.user_id = v_current_user
        AND r.type = 'group'
        AND v_current_user IS NOT NULL
        AND p_user_id != v_current_user
    )::BIGINT as mutual_groups_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Get followers list for a user
-- ============================================
CREATE OR REPLACE FUNCTION get_followers_list(p_user_id UUID, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)
RETURNS TABLE(
  user_id UUID,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  mutual_groups_count BIGINT,
  follow_status TEXT
) AS $$
DECLARE
  v_current_user UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    p.id as user_id,
    p.email,
    p.display_name,
    p.avatar_url,
    -- Mutual groups between this follower and current user
    (
      SELECT COUNT(DISTINCT rm1.room_id)
      FROM room_members rm1
      JOIN room_members rm2 ON rm1.room_id = rm2.room_id
      JOIN rooms r ON r.id = rm1.room_id
      WHERE rm1.user_id = p.id
        AND rm2.user_id = v_current_user
        AND r.type = 'group'
        AND v_current_user IS NOT NULL
    )::BIGINT as mutual_groups_count,
    -- Current user's follow status toward this follower
    CASE
      WHEN v_current_user IS NULL OR p.id = v_current_user THEN 'none'
      WHEN EXISTS (
        SELECT 1 FROM follow_overrides fo
        WHERE fo.follower_id = v_current_user AND fo.target_id = p.id AND fo.override_type = 'unfollow'
      ) THEN 'unfollowed'
      WHEN EXISTS (
        SELECT 1 FROM follows f WHERE f.follower_id = v_current_user AND f.following_id = p.id
      ) THEN 'explicit'
      WHEN is_implicit_follow(v_current_user, p.id) THEN 'implicit'
      ELSE 'none'
    END as follow_status
  FROM profiles p
  WHERE p.id != p_user_id
    -- User effectively follows p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM follow_overrides fo
      WHERE fo.follower_id = p.id AND fo.target_id = p_user_id AND fo.override_type = 'unfollow'
    )
    AND (
      EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = p.id AND f.following_id = p_user_id)
      OR is_implicit_follow(p.id, p_user_id)
    )
  ORDER BY p.display_name NULLS LAST, p.email
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Get following list for a user
-- ============================================
CREATE OR REPLACE FUNCTION get_following_list(p_user_id UUID, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)
RETURNS TABLE(
  user_id UUID,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  mutual_groups_count BIGINT,
  follow_status TEXT
) AS $$
DECLARE
  v_current_user UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    p.id as user_id,
    p.email,
    p.display_name,
    p.avatar_url,
    -- Mutual groups between this user and current user
    (
      SELECT COUNT(DISTINCT rm1.room_id)
      FROM room_members rm1
      JOIN room_members rm2 ON rm1.room_id = rm2.room_id
      JOIN rooms r ON r.id = rm1.room_id
      WHERE rm1.user_id = p.id
        AND rm2.user_id = v_current_user
        AND r.type = 'group'
        AND v_current_user IS NOT NULL
    )::BIGINT as mutual_groups_count,
    -- Current user's follow status toward this user
    CASE
      WHEN v_current_user IS NULL OR p.id = v_current_user THEN 'none'
      WHEN EXISTS (
        SELECT 1 FROM follow_overrides fo
        WHERE fo.follower_id = v_current_user AND fo.target_id = p.id AND fo.override_type = 'unfollow'
      ) THEN 'unfollowed'
      WHEN EXISTS (
        SELECT 1 FROM follows f WHERE f.follower_id = v_current_user AND f.following_id = p.id
      ) THEN 'explicit'
      WHEN is_implicit_follow(v_current_user, p.id) THEN 'implicit'
      ELSE 'none'
    END as follow_status
  FROM profiles p
  WHERE p.id != p_user_id
    -- p_user_id effectively follows this user
    AND NOT EXISTS (
      SELECT 1 FROM follow_overrides fo
      WHERE fo.follower_id = p_user_id AND fo.target_id = p.id AND fo.override_type = 'unfollow'
    )
    AND (
      EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = p_user_id AND f.following_id = p.id)
      OR is_implicit_follow(p_user_id, p.id)
    )
  ORDER BY p.display_name NULLS LAST, p.email
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Get mutual groups list between two users
-- ============================================
CREATE OR REPLACE FUNCTION get_mutual_groups_list(p_user_id UUID, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)
RETURNS TABLE(
  room_id UUID,
  room_name TEXT,
  member_count BIGINT
) AS $$
DECLARE
  v_current_user UUID := auth.uid();
BEGIN
  IF v_current_user IS NULL OR p_user_id = v_current_user THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    r.id as room_id,
    r.name as room_name,
    (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id)::BIGINT as member_count
  FROM rooms r
  JOIN room_members rm1 ON rm1.room_id = r.id AND rm1.user_id = p_user_id
  JOIN room_members rm2 ON rm2.room_id = r.id AND rm2.user_id = v_current_user
  WHERE r.type = 'group'
  ORDER BY r.last_message_at DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Get user's groups list (for own profile)
-- ============================================
CREATE OR REPLACE FUNCTION get_user_groups_list(p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)
RETURNS TABLE(
  room_id UUID,
  room_name TEXT,
  member_count BIGINT
) AS $$
DECLARE
  v_current_user UUID := auth.uid();
BEGIN
  IF v_current_user IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    r.id as room_id,
    r.name as room_name,
    (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id)::BIGINT as member_count
  FROM rooms r
  JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = v_current_user
  WHERE r.type = 'group'
  ORDER BY r.last_message_at DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
