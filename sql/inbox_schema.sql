-- ============================================
-- Inbox Schema Migration
-- Adds support for DMs, group chats, and WhatsApp-style inbox
-- ============================================

-- 1. Add type column to rooms (dm or group)
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'group' CHECK (type IN ('dm', 'group'));

-- 2. Add last_message_at for efficient inbox sorting
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Create index for inbox queries
CREATE INDEX IF NOT EXISTS idx_rooms_last_message_at ON rooms(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at DESC);

-- 4. Function to update last_message_at when a message is sent
CREATE OR REPLACE FUNCTION update_room_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE rooms SET last_message_at = NEW.created_at WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (drop first if exists)
DROP TRIGGER IF EXISTS on_message_insert_update_room ON messages;
CREATE TRIGGER on_message_insert_update_room
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION update_room_last_message();

-- 5. Function to find or create a DM room between two users
CREATE OR REPLACE FUNCTION get_or_create_dm(p_other_user_id UUID)
RETURNS UUID AS $$
DECLARE
  caller_id UUID := auth.uid();
  existing_room_id UUID;
  new_room_id UUID;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF caller_id = p_other_user_id THEN
    RAISE EXCEPTION 'Cannot create DM with yourself';
  END IF;

  -- Check if DM already exists between these two users
  SELECT r.id INTO existing_room_id
  FROM rooms r
  WHERE r.type = 'dm'
    AND EXISTS (SELECT 1 FROM room_members rm1 WHERE rm1.room_id = r.id AND rm1.user_id = caller_id)
    AND EXISTS (SELECT 1 FROM room_members rm2 WHERE rm2.room_id = r.id AND rm2.user_id = p_other_user_id)
    AND (SELECT COUNT(*) FROM room_members rm3 WHERE rm3.room_id = r.id) = 2
  LIMIT 1;

  IF existing_room_id IS NOT NULL THEN
    RETURN existing_room_id;
  END IF;

  -- Create new DM room
  INSERT INTO rooms (name, type, created_by)
  VALUES ('DM', 'dm', caller_id)
  RETURNING id INTO new_room_id;

  -- Add both users as members
  INSERT INTO room_members (room_id, user_id, role)
  VALUES
    (new_room_id, caller_id, 'member'),
    (new_room_id, p_other_user_id, 'member');

  RETURN new_room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Function to find user by email and create DM
CREATE OR REPLACE FUNCTION create_dm_by_email(p_email TEXT)
RETURNS UUID AS $$
DECLARE
  other_user_id UUID;
BEGIN
  -- Find user by email
  SELECT id INTO other_user_id
  FROM profiles
  WHERE LOWER(email) = LOWER(p_email);

  IF other_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found with email: %', p_email;
  END IF;

  RETURN get_or_create_dm(other_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Function to create a group with members by email
CREATE OR REPLACE FUNCTION create_group_with_members(p_name TEXT, p_member_emails TEXT[])
RETURNS UUID AS $$
DECLARE
  caller_id UUID := auth.uid();
  new_room_id UUID;
  member_email TEXT;
  member_id UUID;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Create the group room
  INSERT INTO rooms (name, type, created_by)
  VALUES (p_name, 'group', caller_id)
  RETURNING id INTO new_room_id;

  -- Add creator as host
  INSERT INTO room_members (room_id, user_id, role)
  VALUES (new_room_id, caller_id, 'host');

  -- Add each member by email
  IF p_member_emails IS NOT NULL THEN
    FOREACH member_email IN ARRAY p_member_emails
    LOOP
      SELECT id INTO member_id
      FROM profiles
      WHERE LOWER(email) = LOWER(member_email);

      IF member_id IS NOT NULL AND member_id <> caller_id THEN
        INSERT INTO room_members (room_id, user_id, role)
        VALUES (new_room_id, member_id, 'member')
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  -- Insert system message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (new_room_id, NULL, 'system', 'Group created');

  RETURN new_room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Function to add member to group by email
CREATE OR REPLACE FUNCTION add_member_by_email(p_room_id UUID, p_email TEXT)
RETURNS VOID AS $$
DECLARE
  caller_id UUID := auth.uid();
  caller_role TEXT;
  member_id UUID;
  room_type TEXT;
BEGIN
  -- Check room type
  SELECT type INTO room_type FROM rooms WHERE id = p_room_id;

  IF room_type = 'dm' THEN
    RAISE EXCEPTION 'Cannot add members to a DM';
  END IF;

  -- Check caller is host
  SELECT role INTO caller_role
  FROM room_members
  WHERE room_id = p_room_id AND user_id = caller_id;

  IF caller_role <> 'host' THEN
    RAISE EXCEPTION 'Only the host can add members';
  END IF;

  -- Find user by email
  SELECT id INTO member_id
  FROM profiles
  WHERE LOWER(email) = LOWER(p_email);

  IF member_id IS NULL THEN
    RAISE EXCEPTION 'User not found with email: %', p_email;
  END IF;

  -- Add member
  INSERT INTO room_members (room_id, user_id, role)
  VALUES (p_room_id, member_id, 'member')
  ON CONFLICT DO NOTHING;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. View for inbox with last message (optional, can also query directly)
-- This helps get inbox data efficiently
CREATE OR REPLACE FUNCTION get_inbox()
RETURNS TABLE (
  room_id UUID,
  room_name TEXT,
  room_type TEXT,
  last_message_at TIMESTAMPTZ,
  last_message_content TEXT,
  last_message_user_id UUID,
  member_count BIGINT
) AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    r.id as room_id,
    r.name as room_name,
    r.type as room_type,
    r.last_message_at,
    (SELECT m.content FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message_content,
    (SELECT m.user_id FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message_user_id,
    (SELECT COUNT(*) FROM room_members rm2 WHERE rm2.room_id = r.id) as member_count
  FROM rooms r
  INNER JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = caller_id
  ORDER BY r.last_message_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Update existing rooms to have type = 'group'
UPDATE rooms SET type = 'group' WHERE type IS NULL;
