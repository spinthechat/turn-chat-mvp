-- ============================================
-- Allow members to update room name
-- ============================================

CREATE OR REPLACE FUNCTION update_room_name(p_room_id UUID, p_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify caller is a member
  IF NOT is_room_member(p_room_id, caller_id) THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  -- Validate name
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Room name cannot be empty';
  END IF;

  IF length(trim(p_name)) > 50 THEN
    RAISE EXCEPTION 'Room name must be 50 characters or less';
  END IF;

  -- Update the room name
  UPDATE rooms
  SET name = trim(p_name)
  WHERE id = p_room_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
