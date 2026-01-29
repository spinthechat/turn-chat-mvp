-- ============================================
-- NOTIFICATIONS SYSTEM
-- ============================================
-- Durable notifications table for app events:
-- - Follow/unfollow
-- - Group events (invite, added, removed)
-- - Turn events (your_turn, nudge, skipped)
-- - Story replies

-- ============================================
-- Notifications Table
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  story_id UUID REFERENCES stories(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  metadata JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ DEFAULT NULL,

  CONSTRAINT valid_notification_type CHECK (type IN (
    'followed_you',
    'unfollowed_you',
    'group_invite',
    'added_to_group',
    'removed_from_group',
    'your_turn',
    'nudged_you',
    'turn_skipped',
    'turn_completed',
    'story_reply',
    'story_view_milestone'
  ))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only read their own notifications
CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

-- Users can only update their own notifications (to mark as read)
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Only allow inserts via RPC (SECURITY DEFINER functions)
-- No direct INSERT policy for clients

-- ============================================
-- Helper: Create notification (internal use)
-- ============================================
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_actor_user_id UUID DEFAULT NULL,
  p_room_id UUID DEFAULT NULL,
  p_story_id UUID DEFAULT NULL,
  p_message_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  -- Don't notify yourself
  IF p_user_id = p_actor_user_id THEN
    RETURN NULL;
  END IF;

  INSERT INTO notifications (user_id, actor_user_id, type, room_id, story_id, message_id, metadata)
  VALUES (p_user_id, p_actor_user_id, p_type, p_room_id, p_story_id, p_message_id, p_metadata)
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Get notifications with actor profiles
-- ============================================
CREATE OR REPLACE FUNCTION get_notifications(
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_filter TEXT DEFAULT 'all'
)
RETURNS TABLE(
  id UUID,
  type TEXT,
  actor_user_id UUID,
  actor_email TEXT,
  actor_display_name TEXT,
  actor_avatar_url TEXT,
  room_id UUID,
  room_name TEXT,
  story_id UUID,
  message_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
) AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    n.id,
    n.type,
    n.actor_user_id,
    p.email as actor_email,
    p.display_name as actor_display_name,
    p.avatar_url as actor_avatar_url,
    n.room_id,
    r.name as room_name,
    n.story_id,
    n.message_id,
    n.metadata,
    n.created_at,
    n.read_at
  FROM notifications n
  LEFT JOIN profiles p ON p.id = n.actor_user_id
  LEFT JOIN rooms r ON r.id = n.room_id
  WHERE n.user_id = v_user_id
    AND (
      p_filter = 'all'
      OR (p_filter = 'social' AND n.type IN ('followed_you', 'unfollowed_you', 'story_reply', 'story_view_milestone'))
      OR (p_filter = 'turns' AND n.type IN ('your_turn', 'nudged_you', 'turn_skipped', 'turn_completed'))
      OR (p_filter = 'groups' AND n.type IN ('group_invite', 'added_to_group', 'removed_from_group'))
    )
  ORDER BY n.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Get unread count
-- ============================================
CREATE OR REPLACE FUNCTION get_unread_notification_count()
RETURNS BIGINT AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  RETURN (
    SELECT COUNT(*)
    FROM notifications
    WHERE user_id = v_user_id AND read_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Mark notification as read
-- ============================================
CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE notifications
  SET read_at = now()
  WHERE id = p_notification_id
    AND user_id = v_user_id
    AND read_at IS NULL;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Mark all notifications as read
-- ============================================
CREATE OR REPLACE FUNCTION mark_all_notifications_read()
RETURNS INT AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE notifications
  SET read_at = now()
  WHERE user_id = v_user_id AND read_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Updated follow_user with notification
-- ============================================
DROP FUNCTION IF EXISTS follow_user(UUID);

CREATE OR REPLACE FUNCTION follow_user(p_following_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_follower_id UUID := auth.uid();
  v_status TEXT;
BEGIN
  IF v_follower_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_follower_id = p_following_id THEN
    RAISE EXCEPTION 'Cannot follow yourself';
  END IF;

  -- Safety: Can only follow users you share a room with
  IF NOT shares_room_with(v_follower_id, p_following_id) THEN
    RAISE EXCEPTION 'Cannot follow user: no shared rooms';
  END IF;

  -- Remove any unfollow override
  DELETE FROM follow_overrides
  WHERE follower_id = v_follower_id AND target_id = p_following_id;

  -- Check if implicit follow applies
  IF is_implicit_follow(v_follower_id, p_following_id) THEN
    -- No need to insert explicit follow, implicit is enough
    v_status := 'implicit';
  ELSE
    -- Insert explicit follow
    INSERT INTO follows (follower_id, following_id)
    VALUES (v_follower_id, p_following_id)
    ON CONFLICT (follower_id, following_id) DO NOTHING;
    v_status := 'explicit';
  END IF;

  -- Create notification for the followed user
  PERFORM create_notification(
    p_following_id,
    'followed_you',
    v_follower_id
  );

  RETURN v_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Updated unfollow_user with notification (optional)
-- ============================================
DROP FUNCTION IF EXISTS unfollow_user(UUID);

CREATE OR REPLACE FUNCTION unfollow_user(p_following_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_follower_id UUID := auth.uid();
BEGIN
  IF v_follower_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Remove explicit follow if exists
  DELETE FROM follows
  WHERE follower_id = v_follower_id AND following_id = p_following_id;

  -- If implicit follow would apply, we need to create an override
  IF is_implicit_follow(v_follower_id, p_following_id) THEN
    INSERT INTO follow_overrides (follower_id, target_id, override_type)
    VALUES (v_follower_id, p_following_id, 'unfollow')
    ON CONFLICT (follower_id, target_id) DO NOTHING;
  END IF;

  -- Optionally notify about unfollow (commented out - can be intrusive)
  -- PERFORM create_notification(p_following_id, 'unfollowed_you', v_follower_id);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Helper: Notify room members of turn event
-- ============================================
CREATE OR REPLACE FUNCTION notify_turn_event(
  p_room_id UUID,
  p_user_id UUID,
  p_type TEXT,
  p_metadata JSONB DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  PERFORM create_notification(
    p_user_id,
    p_type,
    NULL,  -- No specific actor for system turn events
    p_room_id,
    NULL,
    NULL,
    p_metadata
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Updated send_nudge with notification
-- ============================================
DROP FUNCTION IF EXISTS send_nudge(UUID);

CREATE OR REPLACE FUNCTION send_nudge(p_room_id UUID)
RETURNS TABLE (
  success BOOLEAN,
  error_message TEXT,
  nudged_user_id UUID
) AS $$
DECLARE
  v_sender_id UUID := auth.uid();
  v_session RECORD;
  v_last_nudge TIMESTAMPTZ;
  v_cooldown_seconds INT := 300; -- 5 minutes
  v_nudged_user UUID;
BEGIN
  IF v_sender_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Not authenticated'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- Check if user is member of room
  IF NOT EXISTS (SELECT 1 FROM room_members WHERE room_id = p_room_id AND user_id = v_sender_id) THEN
    RETURN QUERY SELECT FALSE, 'Not a member of this room'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- Get active turn session
  SELECT * INTO v_session
  FROM turn_sessions
  WHERE room_id = p_room_id AND status = 'active';

  IF v_session IS NULL THEN
    RETURN QUERY SELECT FALSE, 'No active turn session'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- Cannot nudge yourself
  IF v_session.current_turn_user_id = v_sender_id THEN
    RETURN QUERY SELECT FALSE, 'Cannot nudge yourself'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  v_nudged_user := v_session.current_turn_user_id;

  -- Check cooldown
  SELECT MAX(created_at) INTO v_last_nudge
  FROM nudges
  WHERE room_id = p_room_id
    AND nudged_user_id = v_nudged_user
    AND created_at > now() - (v_cooldown_seconds || ' seconds')::INTERVAL;

  IF v_last_nudge IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'Nudge on cooldown'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- Insert nudge record
  INSERT INTO nudges (room_id, nudger_user_id, nudged_user_id, session_id)
  VALUES (p_room_id, v_sender_id, v_nudged_user, v_session.id);

  -- Create notification for the nudged user
  PERFORM create_notification(
    v_nudged_user,
    'nudged_you',
    v_sender_id,
    p_room_id,
    NULL,
    NULL,
    jsonb_build_object('prompt_text', v_session.current_prompt_text)
  );

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_nudged_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Updated advance_turn with notifications
-- ============================================
DROP FUNCTION IF EXISTS advance_turn(UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION advance_turn(
  p_room_id UUID,
  p_reason TEXT DEFAULT 'completed',
  p_skipped_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  next_user_id UUID,
  next_prompt_text TEXT,
  next_prompt_type TEXT,
  session_ended BOOLEAN
) AS $$
DECLARE
  v_session RECORD;
  v_next_user UUID;
  v_next_prompt_text TEXT;
  v_next_prompt_type TEXT;
  v_turn_order UUID[];
  v_current_index INT;
  v_next_index INT;
  v_attempts INT := 0;
  v_max_attempts INT;
  v_ended BOOLEAN := FALSE;
  v_room_type TEXT;
  v_reason_text TEXT;
BEGIN
  -- Get current session
  SELECT * INTO v_session
  FROM turn_sessions
  WHERE room_id = p_room_id AND status = 'active';

  IF v_session IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::TEXT, FALSE;
    RETURN;
  END IF;

  -- Get room type
  SELECT type INTO v_room_type FROM rooms WHERE id = p_room_id;

  v_turn_order := v_session.turn_order;
  v_max_attempts := array_length(v_turn_order, 1);

  -- Find current user's position
  FOR i IN 1..array_length(v_turn_order, 1) LOOP
    IF v_turn_order[i] = v_session.current_turn_user_id THEN
      v_current_index := i;
      EXIT;
    END IF;
  END LOOP;

  -- Handle skip/removal
  IF p_reason = 'skipped' AND p_skipped_user_id IS NOT NULL THEN
    -- Remove from turn order
    v_turn_order := array_remove(v_turn_order, p_skipped_user_id);

    -- Update session turn order
    UPDATE turn_sessions
    SET turn_order = v_turn_order
    WHERE id = v_session.id;

    -- If in a group, also remove from room
    IF v_room_type = 'group' THEN
      DELETE FROM room_members WHERE room_id = p_room_id AND user_id = p_skipped_user_id;

      -- System message
      INSERT INTO messages (room_id, user_id, type, content)
      VALUES (p_room_id, p_skipped_user_id, 'system', 'was removed for missing their turn');
    END IF;

    -- Notify the skipped user
    PERFORM create_notification(
      p_skipped_user_id,
      'turn_skipped',
      NULL,
      p_room_id,
      NULL,
      NULL,
      jsonb_build_object('reason', 'inactivity')
    );

    -- Check if game should end
    IF array_length(v_turn_order, 1) < 2 THEN
      UPDATE turn_sessions SET status = 'ended', ended_at = now() WHERE id = v_session.id;
      RETURN QUERY SELECT TRUE, NULL::UUID, NULL::TEXT, NULL::TEXT, TRUE;
      RETURN;
    END IF;

    v_max_attempts := array_length(v_turn_order, 1);
  END IF;

  -- Find next active user
  v_next_index := v_current_index;
  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > v_max_attempts THEN
      -- No one left, end session
      UPDATE turn_sessions SET status = 'ended', ended_at = now() WHERE id = v_session.id;
      v_ended := TRUE;
      EXIT;
    END IF;

    v_next_index := v_next_index + 1;
    IF v_next_index > array_length(v_turn_order, 1) THEN
      v_next_index := 1;
    END IF;

    v_next_user := v_turn_order[v_next_index];

    -- Check if user is still in room
    IF EXISTS (SELECT 1 FROM room_members WHERE room_id = p_room_id AND user_id = v_next_user) THEN
      EXIT;
    END IF;
  END LOOP;

  IF v_ended THEN
    RETURN QUERY SELECT TRUE, NULL::UUID, NULL::TEXT, NULL::TEXT, TRUE;
    RETURN;
  END IF;

  -- Get next prompt from shuffle bag
  SELECT prompt_text, prompt_type
  INTO v_next_prompt_text, v_next_prompt_type
  FROM get_shuffle_bag_prompt(p_room_id, v_session.prompt_mode);

  -- Update session
  UPDATE turn_sessions
  SET
    current_turn_user_id = v_next_user,
    current_prompt_text = v_next_prompt_text,
    current_prompt_type = v_next_prompt_type,
    turn_started_at = now(),
    turn_number = turn_number + 1
  WHERE id = v_session.id;

  -- Create notification for the next user
  PERFORM create_notification(
    v_next_user,
    'your_turn',
    NULL,
    p_room_id,
    NULL,
    NULL,
    jsonb_build_object(
      'prompt_text', v_next_prompt_text,
      'prompt_type', v_next_prompt_type
    )
  );

  RETURN QUERY SELECT TRUE, v_next_user, v_next_prompt_text, v_next_prompt_type, FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Updated send_story_reply with notification
-- ============================================
DROP FUNCTION IF EXISTS send_story_reply(UUID, TEXT);

CREATE OR REPLACE FUNCTION send_story_reply(p_story_id UUID, p_text TEXT)
RETURNS TABLE(room_id UUID, message_id UUID) AS $$
DECLARE
  caller_id UUID := auth.uid();
  v_story RECORD;
  v_room_id UUID;
  v_message_id UUID;
  v_snapshot JSONB;
  v_overlay_summary TEXT;
  v_follow_status TEXT;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_text IS NULL OR trim(p_text) = '' THEN
    RAISE EXCEPTION 'Reply text cannot be empty';
  END IF;

  -- Fetch story with validation
  SELECT
    s.id,
    s.user_id,
    s.image_url,
    s.created_at,
    s.expires_at,
    s.overlays,
    p.display_name,
    p.email
  INTO v_story
  FROM stories s
  JOIN profiles p ON p.id = s.user_id
  WHERE s.id = p_story_id;

  IF v_story IS NULL THEN
    RAISE EXCEPTION 'Story not found';
  END IF;

  IF v_story.expires_at < now() THEN
    RAISE EXCEPTION 'Story has expired';
  END IF;

  IF v_story.user_id = caller_id THEN
    RAISE EXCEPTION 'Cannot reply to your own story';
  END IF;

  -- Check effective following (explicit or implicit, not unfollowed)
  v_follow_status := get_follow_status(v_story.user_id);
  IF v_follow_status NOT IN ('explicit', 'implicit') THEN
    RAISE EXCEPTION 'You cannot reply to this story';
  END IF;

  -- Extract overlay text summary
  v_overlay_summary := NULL;
  IF v_story.overlays IS NOT NULL AND v_story.overlays->'textLayers' IS NOT NULL THEN
    SELECT jsonb_agg(layer->>'text')::text
    INTO v_overlay_summary
    FROM jsonb_array_elements(v_story.overlays->'textLayers') AS layer
    WHERE layer->>'text' IS NOT NULL AND layer->>'text' != ''
    LIMIT 3;
  END IF;

  -- Build story snapshot
  v_snapshot := jsonb_build_object(
    'image_url', v_story.image_url,
    'created_at', v_story.created_at,
    'expires_at', v_story.expires_at,
    'author_id', v_story.user_id,
    'author_name', COALESCE(v_story.display_name, split_part(v_story.email, '@', 1)),
    'overlay_text', v_overlay_summary
  );

  -- Get or create DM room
  v_room_id := get_or_create_dm(v_story.user_id);

  -- Insert story reply message
  INSERT INTO messages (room_id, user_id, type, content, story_id, story_snapshot)
  VALUES (v_room_id, caller_id, 'story_reply', trim(p_text), p_story_id, v_snapshot)
  RETURNING id INTO v_message_id;

  -- Create notification for story owner
  PERFORM create_notification(
    v_story.user_id,
    'story_reply',
    caller_id,
    v_room_id,
    p_story_id,
    v_message_id,
    jsonb_build_object('reply_preview', left(trim(p_text), 100))
  );

  RETURN QUERY SELECT v_room_id, v_message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Helper: Notify group members of event
-- ============================================
CREATE OR REPLACE FUNCTION notify_group_event(
  p_room_id UUID,
  p_user_id UUID,
  p_type TEXT,
  p_actor_user_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  PERFORM create_notification(
    p_user_id,
    p_type,
    p_actor_user_id,
    p_room_id,
    NULL,
    NULL,
    p_metadata
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Add member to group with notification
-- ============================================
CREATE OR REPLACE FUNCTION add_member_to_group_with_notification(
  p_room_id UUID,
  p_user_id UUID,
  p_added_by UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_room_name TEXT;
BEGIN
  -- Get room name
  SELECT name INTO v_room_name FROM rooms WHERE id = p_room_id AND type = 'group';

  IF v_room_name IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Add to room_members if not exists
  INSERT INTO room_members (room_id, user_id)
  VALUES (p_room_id, p_user_id)
  ON CONFLICT (room_id, user_id) DO NOTHING;

  -- Create notification
  PERFORM create_notification(
    p_user_id,
    'added_to_group',
    p_added_by,
    p_room_id,
    NULL,
    NULL,
    jsonb_build_object('room_name', v_room_name)
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Remove member from group with notification
-- ============================================
CREATE OR REPLACE FUNCTION remove_member_from_group_with_notification(
  p_room_id UUID,
  p_user_id UUID,
  p_removed_by UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_room_name TEXT;
BEGIN
  -- Get room name before removal
  SELECT name INTO v_room_name FROM rooms WHERE id = p_room_id AND type = 'group';

  -- Remove from room
  DELETE FROM room_members WHERE room_id = p_room_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Create notification
  PERFORM create_notification(
    p_user_id,
    'removed_from_group',
    p_removed_by,
    p_room_id,
    NULL,
    NULL,
    jsonb_build_object('room_name', v_room_name, 'reason', p_reason)
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Updated create_group_with_members with notifications
-- ============================================
DROP FUNCTION IF EXISTS create_group_with_members(TEXT, TEXT[], TEXT);

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

  -- Add each member by email and notify them
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

        -- Notify the added member
        PERFORM create_notification(
          member_id,
          'added_to_group',
          caller_id,
          new_room_id,
          NULL,
          NULL,
          jsonb_build_object('room_name', p_name)
        );
      END IF;
    END LOOP;
  END IF;

  -- Insert system message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (new_room_id, NULL, 'system', 'Group created');

  RETURN new_room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Enable realtime for notifications
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

