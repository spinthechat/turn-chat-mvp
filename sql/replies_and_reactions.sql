-- ============================================
-- Replies and Reactions Migration
-- ============================================

-- 1. Add reply_to_message_id for quoted replies
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES messages(id);

-- Index for faster reply lookups
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_message_id);

-- 2. Create reactions table
CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '😮', '😢')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

-- Index for faster reaction lookups
CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);

-- 3. Enable RLS on reactions
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for reactions

-- Users can view reactions on messages in rooms they belong to
CREATE POLICY "Users can view reactions"
ON message_reactions FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN room_members rm ON rm.room_id = m.room_id
    WHERE m.id = message_reactions.message_id
    AND rm.user_id = auth.uid()
  )
);

-- Users can add reactions to messages in rooms they belong to
CREATE POLICY "Users can add reactions"
ON message_reactions FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM messages m
    JOIN room_members rm ON rm.room_id = m.room_id
    WHERE m.id = message_reactions.message_id
    AND rm.user_id = auth.uid()
  )
);

-- Users can remove their own reactions
CREATE POLICY "Users can remove own reactions"
ON message_reactions FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- 5. Function to toggle a reaction (add if not exists, remove if exists)
CREATE OR REPLACE FUNCTION toggle_reaction(p_message_id UUID, p_emoji TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  existing_id UUID;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if reaction exists
  SELECT id INTO existing_id
  FROM message_reactions
  WHERE message_id = p_message_id
    AND user_id = caller_id
    AND emoji = p_emoji;

  IF existing_id IS NOT NULL THEN
    -- Remove reaction
    DELETE FROM message_reactions WHERE id = existing_id;
    RETURN FALSE;
  ELSE
    -- Add reaction
    INSERT INTO message_reactions (message_id, user_id, emoji)
    VALUES (p_message_id, caller_id, p_emoji);
    RETURN TRUE;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Enable realtime for reactions table
-- This is required for realtime subscriptions to work
ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;
