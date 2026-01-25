-- ============================================
-- Fix Realtime + RLS for Messages
-- ============================================
-- Supabase Realtime respects RLS policies.
-- New members must have SELECT access to messages immediately.

-- 1. Ensure messages table has proper RLS for room members
DROP POLICY IF EXISTS "Room members can view messages" ON messages;
DROP POLICY IF EXISTS "Members can view room messages" ON messages;
DROP POLICY IF EXISTS "messages_select_policy" ON messages;

-- Enable RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Create policy: Any room member can read messages in their rooms
-- Uses the is_room_member function to avoid recursion
CREATE POLICY "Room members can view messages"
ON messages FOR SELECT TO authenticated
USING (
  is_room_member(room_id, auth.uid())
);

-- Ensure members can insert messages
DROP POLICY IF EXISTS "Room members can insert messages" ON messages;
CREATE POLICY "Room members can insert messages"
ON messages FOR INSERT TO authenticated
WITH CHECK (
  is_room_member(room_id, auth.uid())
  AND (user_id = auth.uid() OR user_id IS NULL)
);

-- 2. Add messages to realtime publication (if not already)
-- This enables Supabase Realtime to broadcast changes
DO $$
BEGIN
  -- Try to add to publication, ignore if already exists
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'messages already in publication';
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE turn_sessions;
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'turn_sessions already in publication';
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE room_members;
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'room_members already in publication';
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'message_reactions already in publication';
  END;
END $$;

-- 3. Verify the is_room_member function exists and is correct
CREATE OR REPLACE FUNCTION is_room_member(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM room_members
    WHERE room_id = p_room_id AND user_id = p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Grant execute on the function
GRANT EXECUTE ON FUNCTION is_room_member(UUID, UUID) TO authenticated;
