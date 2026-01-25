-- ============================================
-- Fix RLS Recursion on room_members
-- ============================================

-- Drop the problematic policy
DROP POLICY IF EXISTS "Members can view all room members" ON room_members;

-- Create a security definer function to check membership without triggering RLS
CREATE OR REPLACE FUNCTION is_room_member(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM room_members
    WHERE room_id = p_room_id AND user_id = p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create policy using the function
CREATE POLICY "Members can view all room members"
ON room_members FOR SELECT TO authenticated
USING (is_room_member(room_id, auth.uid()));
