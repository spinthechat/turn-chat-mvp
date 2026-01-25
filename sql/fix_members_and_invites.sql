-- ============================================
-- Fix Members List, Add Invites, Fix Frequency
-- ============================================

-- ============================================
-- 1) FIX: Room members RLS - allow seeing all members in your rooms
-- ============================================

-- Drop existing policies on room_members if they exist
DROP POLICY IF EXISTS "Users can view room members" ON room_members;
DROP POLICY IF EXISTS "Users can view their memberships" ON room_members;
DROP POLICY IF EXISTS "room_members_select_policy" ON room_members;

-- Enable RLS if not already
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;

-- Allow users to see ALL members of rooms they belong to
CREATE POLICY "Members can view all room members"
ON room_members FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM room_members rm
    WHERE rm.room_id = room_members.room_id
    AND rm.user_id = auth.uid()
  )
);

-- Allow users to insert themselves (for joining via invite)
DROP POLICY IF EXISTS "Users can join rooms" ON room_members;
CREATE POLICY "Users can join rooms via invite"
ON room_members FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- Allow host to add members directly
DROP POLICY IF EXISTS "Host can add members" ON room_members;

-- Allow users to update their own membership (for frequency setting)
DROP POLICY IF EXISTS "Users can update own membership" ON room_members;
CREATE POLICY "Users can update own membership"
ON room_members FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Allow users to delete their own membership (leave room)
DROP POLICY IF EXISTS "Users can leave rooms" ON room_members;
CREATE POLICY "Users can leave rooms"
ON room_members FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- ============================================
-- 2) ADD: Room invites table for invite links
-- ============================================

CREATE TABLE IF NOT EXISTS room_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  max_uses INT DEFAULT NULL,
  use_count INT DEFAULT 0
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_room_invites_code ON room_invites(code);
CREATE INDEX IF NOT EXISTS idx_room_invites_room ON room_invites(room_id);

-- Enable RLS
ALTER TABLE room_invites ENABLE ROW LEVEL SECURITY;

-- Members can view invites for their rooms
CREATE POLICY "Members can view room invites"
ON room_invites FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM room_members rm
    WHERE rm.room_id = room_invites.room_id
    AND rm.user_id = auth.uid()
  )
);

-- Members can create invites for rooms they belong to
CREATE POLICY "Members can create invites"
ON room_invites FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM room_members rm
    WHERE rm.room_id = room_invites.room_id
    AND rm.user_id = auth.uid()
  )
);

-- Creators can delete their own invites
CREATE POLICY "Creators can delete invites"
ON room_invites FOR DELETE TO authenticated
USING (created_by = auth.uid());

-- ============================================
-- 3) FUNCTIONS: Create invite, join via invite, add by email
-- ============================================

-- Create an invite link for a room
CREATE OR REPLACE FUNCTION create_room_invite(p_room_id UUID)
RETURNS TEXT AS $$
DECLARE
  caller_id UUID := auth.uid();
  invite_code TEXT;
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

  -- Create invite and return code
  INSERT INTO room_invites (room_id, created_by)
  VALUES (p_room_id, caller_id)
  RETURNING code INTO invite_code;

  RETURN invite_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Join a room via invite code
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

-- Add a user by email (any member can do this)
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

  -- Add system message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, NULL, 'system', target_name || ' was added to the group');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get or create a default invite for a room (for easy sharing)
CREATE OR REPLACE FUNCTION get_room_invite(p_room_id UUID)
RETURNS TEXT AS $$
DECLARE
  caller_id UUID := auth.uid();
  invite_code TEXT;
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

  -- Try to find an existing valid invite
  SELECT code INTO invite_code
  FROM room_invites
  WHERE room_id = p_room_id
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (max_uses IS NULL OR use_count < max_uses)
  ORDER BY created_at DESC
  LIMIT 1;

  -- If no valid invite exists, create one
  IF invite_code IS NULL THEN
    INSERT INTO room_invites (room_id, created_by)
    VALUES (p_room_id, caller_id)
    RETURNING code INTO invite_code;
  END IF;

  RETURN invite_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4) Ensure prompt_interval_minutes column exists and RLS is correct
-- ============================================

-- Add column if not exists (idempotent)
ALTER TABLE room_members
ADD COLUMN IF NOT EXISTS prompt_interval_minutes INT NOT NULL DEFAULT 0;

-- The update_prompt_frequency function already restricts to current user
-- but let's make sure it's correct:
CREATE OR REPLACE FUNCTION update_prompt_frequency(p_room_id UUID, p_interval_minutes INT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_interval_minutes NOT IN (0, 60, 180, 360, 1440) THEN
    RAISE EXCEPTION 'Invalid interval. Must be 0, 60, 180, 360, or 1440 minutes';
  END IF;

  -- Only update the current user's row
  UPDATE room_members
  SET prompt_interval_minutes = p_interval_minutes
  WHERE room_id = p_room_id
    AND user_id = caller_id;  -- <-- This ensures only YOUR row is updated

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable realtime for room_invites
ALTER PUBLICATION supabase_realtime ADD TABLE room_invites;
