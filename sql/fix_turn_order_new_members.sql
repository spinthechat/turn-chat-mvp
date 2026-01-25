-- ============================================
-- Fix Turn Order: Include New Members
-- ============================================
-- When new members join a room with an active session,
-- they are now automatically added to the turn rotation.

-- Helper function to add a member to active turn order
CREATE OR REPLACE FUNCTION add_member_to_turn_order(p_room_id UUID, p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Only update if there's an active session and user isn't already in the order
  UPDATE turn_sessions
  SET turn_order = turn_order || p_user_id
  WHERE room_id = p_room_id
    AND is_active = true
    AND NOT (p_user_id = ANY(turn_order));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated: Join a room via invite code (now adds to turn order)
CREATE OR REPLACE FUNCTION join_room_via_invite(p_code TEXT)
RETURNS UUID AS $$
DECLARE
  caller_id UUID := auth.uid();
  invite RECORD;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Find valid invite
  SELECT * INTO invite
  FROM room_invites
  WHERE code = p_code
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (max_uses IS NULL OR use_count < max_uses);

  IF invite IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  -- Check if already a member
  IF EXISTS (
    SELECT 1 FROM room_members
    WHERE room_id = invite.room_id AND user_id = caller_id
  ) THEN
    -- Already a member, just return the room_id
    RETURN invite.room_id;
  END IF;

  -- Add user to room
  INSERT INTO room_members (room_id, user_id, role)
  VALUES (invite.room_id, caller_id, 'member');

  -- Add to turn order if session is active
  PERFORM add_member_to_turn_order(invite.room_id, caller_id);

  -- Increment use count
  UPDATE room_invites SET use_count = use_count + 1 WHERE id = invite.id;

  -- Add system message
  INSERT INTO messages (room_id, user_id, type, content)
  SELECT invite.room_id, NULL, 'system',
         COALESCE(p.display_name, split_part(p.email, '@', 1)) || ' joined the group'
  FROM profiles p WHERE p.id = caller_id;

  RETURN invite.room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated: Add a user by email (now adds to turn order)
CREATE OR REPLACE FUNCTION add_member_by_email(p_room_id UUID, p_email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  target_user_id UUID;
  target_name TEXT;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify caller is a member
  IF NOT EXISTS (
    SELECT 1 FROM room_members
    WHERE room_id = p_room_id AND user_id = caller_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  -- Find user by email
  SELECT id, COALESCE(display_name, split_part(email, '@', 1))
  INTO target_user_id, target_name
  FROM profiles
  WHERE LOWER(email) = LOWER(p_email);

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found with that email';
  END IF;

  -- Check if already a member
  IF EXISTS (
    SELECT 1 FROM room_members
    WHERE room_id = p_room_id AND user_id = target_user_id
  ) THEN
    RAISE EXCEPTION 'User is already a member';
  END IF;

  -- Add user to room
  INSERT INTO room_members (room_id, user_id, role)
  VALUES (p_room_id, target_user_id, 'member');

  -- Add to turn order if session is active
  PERFORM add_member_to_turn_order(p_room_id, target_user_id);

  -- Add system message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, NULL, 'system', target_name || ' was added to the group');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
