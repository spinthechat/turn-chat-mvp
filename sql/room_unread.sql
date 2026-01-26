-- ============================================
-- Room Unread Counts for Lobby (WhatsApp-style)
-- ============================================
-- Tracks per-user, per-room "last read" timestamp
-- for efficient unread count calculation in lobby.

-- 1. Create room_reads table
CREATE TABLE IF NOT EXISTS room_reads (
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

-- 2. Indexes for efficient queries
CREATE INDEX IF NOT EXISTS room_reads_user_idx ON room_reads (user_id);
CREATE INDEX IF NOT EXISTS messages_room_created_idx ON messages (room_id, created_at DESC);

-- 3. Enable RLS
ALTER TABLE room_reads ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies - users can only read/write their own rows
DROP POLICY IF EXISTS "Users can view own room reads" ON room_reads;
CREATE POLICY "Users can view own room reads" ON room_reads
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own room reads" ON room_reads;
CREATE POLICY "Users can insert own room reads" ON room_reads
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own room reads" ON room_reads;
CREATE POLICY "Users can update own room reads" ON room_reads
  FOR UPDATE USING (user_id = auth.uid());

-- 5. Function to mark a room as read (upsert)
CREATE OR REPLACE FUNCTION mark_room_read(p_room_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO room_reads (room_id, user_id, last_read_at)
  VALUES (p_room_id, auth.uid(), NOW())
  ON CONFLICT (room_id, user_id) DO UPDATE SET last_read_at = NOW();
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Function to get unread count for a single room
CREATE OR REPLACE FUNCTION get_room_unread_count(p_room_id UUID)
RETURNS INT AS $$
DECLARE
  v_last_read TIMESTAMPTZ;
  v_count INT;
BEGIN
  -- Get user's last read time for this room
  SELECT last_read_at INTO v_last_read
  FROM room_reads
  WHERE room_id = p_room_id AND user_id = auth.uid();

  -- Count messages after last_read_at, excluding user's own messages
  -- If never read, count all messages not by user
  SELECT COUNT(*)::INT INTO v_count
  FROM messages m
  WHERE m.room_id = p_room_id
    AND m.type != 'system'  -- Don't count system messages
    AND m.user_id IS DISTINCT FROM auth.uid()  -- Exclude own messages (handles NULL)
    AND (v_last_read IS NULL OR m.created_at > v_last_read);

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Function to get all rooms with unread counts (efficient lobby query)
CREATE OR REPLACE FUNCTION get_rooms_with_unread()
RETURNS TABLE (
  room_id UUID,
  room_name TEXT,
  room_type TEXT,
  member_count BIGINT,
  last_message_at TIMESTAMPTZ,
  last_message_content TEXT,
  last_message_type TEXT,
  last_message_user_id UUID,
  unread_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH user_rooms AS (
    -- Get all rooms the user is a member of
    SELECT rm.room_id
    FROM room_members rm
    WHERE rm.user_id = auth.uid()
  ),
  room_member_counts AS (
    -- Get member counts for each room
    SELECT rm.room_id, COUNT(*)::BIGINT as member_count
    FROM room_members rm
    WHERE rm.room_id IN (SELECT ur.room_id FROM user_rooms ur)
    GROUP BY rm.room_id
  ),
  last_messages AS (
    -- Get last message for each room (using DISTINCT ON for efficiency)
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
    -- Calculate unread counts
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
    COALESCE(rmc.member_count, 0) as member_count,
    COALESCE(lm.created_at, r.created_at) as last_message_at,
    lm.content as last_message_content,
    lm.type as last_message_type,
    lm.user_id as last_message_user_id,
    COALESCE(uc.unread_count, 0) as unread_count
  FROM user_rooms ur
  JOIN rooms r ON r.id = ur.room_id
  LEFT JOIN room_member_counts rmc ON rmc.room_id = ur.room_id
  LEFT JOIN last_messages lm ON lm.room_id = ur.room_id
  LEFT JOIN unread_counts uc ON uc.room_id = ur.room_id
  ORDER BY COALESCE(lm.created_at, r.created_at) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Grant execute permissions
GRANT EXECUTE ON FUNCTION mark_room_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_room_unread_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_rooms_with_unread() TO authenticated;

-- 9. Enable realtime for room_reads (for lobby updates)
ALTER PUBLICATION supabase_realtime ADD TABLE room_reads;
