-- ============================================
-- Group Creation: Required Prompt Mode
-- ============================================

-- 1. Update create_group_with_members to require prompt_mode
CREATE OR REPLACE FUNCTION create_group_with_members(
  p_name TEXT,
  p_member_emails TEXT[],
  p_prompt_mode TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  caller_id UUID := auth.uid();
  new_room_id UUID;
  member_email TEXT;
  member_id UUID;
  v_prompt_mode TEXT;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate prompt_mode is provided and valid
  IF p_prompt_mode IS NULL OR p_prompt_mode = '' THEN
    RAISE EXCEPTION 'Prompt mode is required';
  END IF;

  IF p_prompt_mode NOT IN ('fun', 'family', 'deep', 'flirty', 'couple') THEN
    RAISE EXCEPTION 'Invalid prompt mode';
  END IF;

  v_prompt_mode := p_prompt_mode;

  -- Create the group room with prompt_mode
  INSERT INTO rooms (name, type, created_by, prompt_mode)
  VALUES (p_name, 'group', caller_id, v_prompt_mode)
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
