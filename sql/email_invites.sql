-- ============================================
-- Email-Based Invite System
-- ============================================
-- Allows inviting users by email, even if they haven't signed up yet.
-- The invite is locked to a specific email address.

-- 1. Add new columns to room_invites
ALTER TABLE room_invites ADD COLUMN IF NOT EXISTS invited_email TEXT;
ALTER TABLE room_invites ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- 2. Add index for email lookups
CREATE INDEX IF NOT EXISTS idx_room_invites_email ON room_invites(invited_email) WHERE invited_email IS NOT NULL;

-- 3. Unique constraint: one pending invite per email per room
-- Only enforces uniqueness for non-accepted invites (expiration checked in app logic)
DROP INDEX IF EXISTS idx_room_invites_room_email_unique;
CREATE UNIQUE INDEX idx_room_invites_room_email_unique
ON room_invites(room_id, LOWER(invited_email))
WHERE invited_email IS NOT NULL
  AND accepted_at IS NULL;

-- ============================================
-- RPC: Create an email-specific invite
-- ============================================
CREATE OR REPLACE FUNCTION create_email_invite(p_room_id UUID, p_email TEXT)
RETURNS TABLE(code TEXT, already_member BOOLEAN, already_invited BOOLEAN) AS $$
DECLARE
  caller_id UUID := auth.uid();
  target_user_id UUID;
  existing_invite RECORD;
  new_code TEXT;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_email IS NULL OR TRIM(p_email) = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  -- Normalize email
  p_email := LOWER(TRIM(p_email));

  -- Verify caller is a member of the room
  IF NOT EXISTS (
    SELECT 1 FROM room_members
    WHERE room_id = p_room_id AND user_id = caller_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  -- Check if user with this email already exists and is a member
  SELECT p.id INTO target_user_id
  FROM profiles p
  WHERE LOWER(p.email) = p_email;

  IF target_user_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM room_members
      WHERE room_id = p_room_id AND user_id = target_user_id
    ) THEN
      -- User is already a member
      RETURN QUERY SELECT ''::TEXT, TRUE, FALSE;
      RETURN;
    END IF;
  END IF;

  -- Check for existing valid invite for this email
  SELECT * INTO existing_invite
  FROM room_invites ri
  WHERE ri.room_id = p_room_id
    AND LOWER(ri.invited_email) = p_email
    AND (ri.expires_at IS NULL OR ri.expires_at > NOW())
    AND ri.accepted_at IS NULL;

  IF existing_invite IS NOT NULL THEN
    -- Return existing invite code
    RETURN QUERY SELECT existing_invite.code, FALSE, TRUE;
    RETURN;
  END IF;

  -- Create new email-specific invite (expires in 30 days)
  INSERT INTO room_invites (room_id, created_by, invited_email, expires_at, max_uses)
  VALUES (p_room_id, caller_id, p_email, NOW() + INTERVAL '30 days', 1)
  RETURNING room_invites.code INTO new_code;

  RETURN QUERY SELECT new_code, FALSE, FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Accept an email invite (validates email match)
-- ============================================
CREATE OR REPLACE FUNCTION accept_email_invite(p_code TEXT)
RETURNS UUID AS $$
DECLARE
  caller_id UUID := auth.uid();
  caller_email TEXT;
  invite RECORD;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get caller's email
  SELECT email INTO caller_email
  FROM auth.users
  WHERE id = caller_id;

  IF caller_email IS NULL THEN
    RAISE EXCEPTION 'Could not verify your email';
  END IF;

  caller_email := LOWER(caller_email);

  -- Find the invite
  SELECT * INTO invite
  FROM room_invites
  WHERE code = p_code
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (max_uses IS NULL OR use_count < max_uses)
    AND accepted_at IS NULL;

  IF invite IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  -- If invite is email-specific, verify email matches
  IF invite.invited_email IS NOT NULL THEN
    IF LOWER(invite.invited_email) != caller_email THEN
      RAISE EXCEPTION 'This invite was sent to a different email address';
    END IF;
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

  -- Mark invite as accepted and increment use count
  UPDATE room_invites
  SET use_count = use_count + 1,
      accepted_at = NOW()
  WHERE id = invite.id;

  -- Add to turn order if session is active
  PERFORM add_member_to_turn_order(invite.room_id, caller_id);

  -- Add system message
  INSERT INTO messages (room_id, user_id, type, content)
  SELECT invite.room_id, NULL, 'system',
         COALESCE(p.display_name, split_part(p.email, '@', 1)) || ' joined the group'
  FROM profiles p WHERE p.id = caller_id;

  RETURN invite.room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Update join_room_via_invite to handle both types
-- ============================================
-- This function now handles both general invites and email-specific invites
CREATE OR REPLACE FUNCTION join_room_via_invite(p_code TEXT)
RETURNS UUID AS $$
DECLARE
  caller_id UUID := auth.uid();
  caller_email TEXT;
  invite RECORD;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get caller's email
  SELECT email INTO caller_email
  FROM auth.users
  WHERE id = caller_id;

  caller_email := LOWER(COALESCE(caller_email, ''));

  -- Find valid invite
  SELECT * INTO invite
  FROM room_invites
  WHERE code = p_code
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (max_uses IS NULL OR use_count < max_uses);

  IF invite IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  -- If invite is email-specific and not yet accepted, verify email matches
  IF invite.invited_email IS NOT NULL AND invite.accepted_at IS NULL THEN
    IF LOWER(invite.invited_email) != caller_email THEN
      RAISE EXCEPTION 'This invite was sent to a different email address (%)', invite.invited_email;
    END IF;
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

  -- Update invite
  UPDATE room_invites
  SET use_count = use_count + 1,
      accepted_at = CASE WHEN invited_email IS NOT NULL THEN NOW() ELSE accepted_at END
  WHERE id = invite.id;

  -- Add to turn order if session is active
  PERFORM add_member_to_turn_order(invite.room_id, caller_id);

  -- Add system message
  INSERT INTO messages (room_id, user_id, type, content)
  SELECT invite.room_id, NULL, 'system',
         COALESCE(p.display_name, split_part(p.email, '@', 1)) || ' joined the group'
  FROM profiles p WHERE p.id = caller_id;

  RETURN invite.room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Get pending invites for a room (for display)
-- ============================================
CREATE OR REPLACE FUNCTION get_pending_invites(p_room_id UUID)
RETURNS TABLE(
  id UUID,
  invited_email TEXT,
  code TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
) AS $$
DECLARE
  caller_id UUID := auth.uid();
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

  RETURN QUERY
  SELECT ri.id, ri.invited_email, ri.code, ri.created_at, ri.expires_at
  FROM room_invites ri
  WHERE ri.room_id = p_room_id
    AND ri.invited_email IS NOT NULL
    AND ri.accepted_at IS NULL
    AND (ri.expires_at IS NULL OR ri.expires_at > NOW())
  ORDER BY ri.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: Cancel/delete an invite
-- ============================================
CREATE OR REPLACE FUNCTION cancel_invite(p_invite_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
  invite_room_id UUID;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get the room_id of the invite
  SELECT room_id INTO invite_room_id
  FROM room_invites
  WHERE id = p_invite_id;

  IF invite_room_id IS NULL THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  -- Verify caller is a member of the room
  IF NOT EXISTS (
    SELECT 1 FROM room_members
    WHERE room_id = invite_room_id AND user_id = caller_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  -- Delete the invite
  DELETE FROM room_invites WHERE id = p_invite_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
