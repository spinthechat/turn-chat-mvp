-- ============================================
-- Lightweight Seen Indicators
-- ============================================

-- 1. Message seen tracking table
CREATE TABLE IF NOT EXISTS message_seen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

-- 2. Indexes for efficient queries
CREATE INDEX IF NOT EXISTS message_seen_message_idx ON message_seen (message_id);
CREATE INDEX IF NOT EXISTS message_seen_user_idx ON message_seen (user_id);

-- 3. Enable RLS
ALTER TABLE message_seen ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies - users can only insert their own seen records
DROP POLICY IF EXISTS "Users can view seen records in their rooms" ON message_seen;
CREATE POLICY "Users can view seen records in their rooms" ON message_seen
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM messages m
      JOIN room_members rm ON rm.room_id = m.room_id
      WHERE m.id = message_seen.message_id AND rm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own seen records" ON message_seen;
CREATE POLICY "Users can insert own seen records" ON message_seen
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM messages m
      JOIN room_members rm ON rm.room_id = m.room_id
      WHERE m.id = message_seen.message_id AND rm.user_id = auth.uid()
    )
  );

-- 5. Add last_active_at to rooms table
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NOW();

-- 6. Function to mark a message as seen (upsert - no error if already seen)
CREATE OR REPLACE FUNCTION mark_message_seen(p_message_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO message_seen (message_id, user_id)
  VALUES (p_message_id, auth.uid())
  ON CONFLICT (message_id, user_id) DO NOTHING;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Function to mark multiple messages as seen at once (batch operation)
CREATE OR REPLACE FUNCTION mark_messages_seen(p_message_ids UUID[])
RETURNS INT AS $$
DECLARE
  v_count INT := 0;
  v_msg_id UUID;
BEGIN
  FOREACH v_msg_id IN ARRAY p_message_ids
  LOOP
    INSERT INTO message_seen (message_id, user_id)
    VALUES (v_msg_id, auth.uid())
    ON CONFLICT (message_id, user_id) DO NOTHING;
    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Function to get seen counts for multiple messages
-- Returns array of {message_id, seen_count} objects
CREATE OR REPLACE FUNCTION get_message_seen_counts(p_message_ids UUID[])
RETURNS TABLE(message_id UUID, seen_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT ms.message_id, COUNT(DISTINCT ms.user_id)::BIGINT as seen_count
  FROM message_seen ms
  WHERE ms.message_id = ANY(p_message_ids)
  GROUP BY ms.message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Function to get seen count excluding the message author
CREATE OR REPLACE FUNCTION get_message_seen_count_excluding_author(p_message_id UUID)
RETURNS BIGINT AS $$
DECLARE
  v_author_id UUID;
  v_count BIGINT;
BEGIN
  -- Get the message author
  SELECT user_id INTO v_author_id FROM messages WHERE id = p_message_id;

  -- Count seen records excluding author
  SELECT COUNT(DISTINCT user_id) INTO v_count
  FROM message_seen
  WHERE message_id = p_message_id AND user_id != COALESCE(v_author_id, '00000000-0000-0000-0000-000000000000'::UUID);

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Trigger function to update room's last_active_at on new message
CREATE OR REPLACE FUNCTION update_room_last_active()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE rooms SET last_active_at = NOW() WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Create trigger on messages table
DROP TRIGGER IF EXISTS trigger_update_room_last_active ON messages;
CREATE TRIGGER trigger_update_room_last_active
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_room_last_active();

-- 12. Initialize last_active_at for existing rooms based on latest message
UPDATE rooms r
SET last_active_at = COALESCE(
  (SELECT MAX(created_at) FROM messages m WHERE m.room_id = r.id),
  r.created_at
)
WHERE last_active_at IS NULL OR last_active_at = r.created_at;
