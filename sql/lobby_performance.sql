-- ============================================
-- Optimized Lobby Query (Performance Fix)
-- ============================================
-- Returns rooms with member info in ONE query
-- Eliminates N+1 problem where each room required
-- a separate member lookup
--
-- NOTE: This is an OPTIONAL optimization. The client-side
-- code already batches queries efficiently. This SQL function
-- could be used in the future to reduce round-trips further.
--
-- The current client approach:
-- 1. Parallel fetch: rooms RPC + all room_members
-- 2. Client-side join to build member lists
-- 3. Fetch only needed profiles
--
-- This SQL approach would do it all server-side in one query.

-- Drop existing function if exists
DROP FUNCTION IF EXISTS get_rooms_with_members();

-- Create optimized function
CREATE OR REPLACE FUNCTION get_rooms_with_members()
RETURNS TABLE (
  room_id UUID,
  room_name TEXT,
  room_type TEXT,
  member_count BIGINT,
  last_message_at TIMESTAMPTZ,
  last_message_content TEXT,
  last_message_type TEXT,
  last_message_user_id UUID,
  unread_count BIGINT,
  member_ids UUID[],
  member_emails TEXT[],
  member_names TEXT[],
  member_avatars TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  WITH user_rooms AS (
    SELECT rm.room_id
    FROM room_members rm
    WHERE rm.user_id = auth.uid()
  ),
  room_member_details AS (
    -- Get member details aggregated per room
    SELECT
      rm.room_id,
      COUNT(*)::BIGINT as member_count,
      -- Get first 5 other members (for avatar mosaic)
      (SELECT ARRAY_AGG(sub.user_id)
       FROM (
         SELECT rm2.user_id
         FROM room_members rm2
         WHERE rm2.room_id = rm.room_id AND rm2.user_id != auth.uid()
         ORDER BY rm2.joined_at
         LIMIT 5
       ) sub
      ) as other_member_ids
    FROM room_members rm
    WHERE rm.room_id IN (SELECT ur.room_id FROM user_rooms ur)
    GROUP BY rm.room_id
  ),
  member_profiles AS (
    -- Get profile info for display members
    SELECT
      rmd.room_id,
      ARRAY_AGG(p.id) as member_ids,
      ARRAY_AGG(p.email) as member_emails,
      ARRAY_AGG(COALESCE(p.display_name, '')) as member_names,
      ARRAY_AGG(COALESCE(p.avatar_url, '')) as member_avatars
    FROM room_member_details rmd
    LEFT JOIN LATERAL unnest(rmd.other_member_ids) AS u(uid) ON true
    LEFT JOIN profiles p ON p.id = u.uid
    WHERE rmd.other_member_ids IS NOT NULL
    GROUP BY rmd.room_id
  ),
  last_messages AS (
    SELECT DISTINCT ON (m.room_id)
      m.room_id,
      m.created_at,
      m.content,
      m.type,
      m.user_id
    FROM messages m
    WHERE m.room_id IN (SELECT ur.room_id FROM user_rooms ur)
    ORDER BY m.room_id, m.created_at DESC
  ),
  unread_counts AS (
    SELECT
      ur.room_id,
      COUNT(m.id)::BIGINT as unread_count
    FROM user_rooms ur
    LEFT JOIN room_reads rr ON rr.room_id = ur.room_id AND rr.user_id = auth.uid()
    LEFT JOIN messages m ON m.room_id = ur.room_id
      AND m.type != 'system'
      AND m.user_id IS DISTINCT FROM auth.uid()
      AND (rr.last_read_at IS NULL OR m.created_at > rr.last_read_at)
    GROUP BY ur.room_id
  )
  SELECT
    r.id as room_id,
    r.name as room_name,
    COALESCE(r.type, 'group')::TEXT as room_type,
    COALESCE(rmd.member_count, 0) as member_count,
    COALESCE(lm.created_at, r.created_at) as last_message_at,
    lm.content as last_message_content,
    lm.type as last_message_type,
    lm.user_id as last_message_user_id,
    COALESCE(uc.unread_count, 0) as unread_count,
    COALESCE(mp.member_ids, ARRAY[]::UUID[]) as member_ids,
    COALESCE(mp.member_emails, ARRAY[]::TEXT[]) as member_emails,
    COALESCE(mp.member_names, ARRAY[]::TEXT[]) as member_names,
    COALESCE(mp.member_avatars, ARRAY[]::TEXT[]) as member_avatars
  FROM user_rooms ur
  JOIN rooms r ON r.id = ur.room_id
  LEFT JOIN room_member_details rmd ON rmd.room_id = ur.room_id
  LEFT JOIN member_profiles mp ON mp.room_id = ur.room_id
  LEFT JOIN last_messages lm ON lm.room_id = ur.room_id
  LEFT JOIN unread_counts uc ON uc.room_id = ur.room_id
  ORDER BY COALESCE(lm.created_at, r.created_at) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_rooms_with_members() TO authenticated;
