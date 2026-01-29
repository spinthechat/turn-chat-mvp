-- ============================================
-- UPVOTE NOTIFICATIONS
-- ============================================
-- Milestone notifications: 1, 3, 5, 10, 25, 100+
-- Whole-group notification: when 100% of eligible members upvote
--
-- Priority rules:
-- - "whole_group_upvoted" supersedes milestone notifications
-- - Only one notification per milestone per message
-- - Whole-group only fires for groups with 3+ members

-- ============================================
-- Upvote notification state table (idempotency)
-- ============================================
-- Tracks which notifications have been sent to prevent duplicates
CREATE TABLE IF NOT EXISTS upvote_notification_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  milestone INT,  -- NULL for whole_group, else 1,3,5,10,25,100
  whole_group BOOLEAN NOT NULL DEFAULT FALSE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upvote_notif_message ON upvote_notification_state(message_id);

-- Unique index: one notification per type per message (using expression for NULL handling)
CREATE UNIQUE INDEX IF NOT EXISTS idx_upvote_notif_unique
  ON upvote_notification_state(message_id, COALESCE(milestone, 0), whole_group);

-- ============================================
-- Add new notification types to constraint
-- (Run this only if types not already in constraint)
-- ============================================
-- First, we need to update the notifications table constraint
-- This is idempotent - we recreate the function to include new types

-- Drop and recreate the constraint with new types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS valid_notification_type;
ALTER TABLE notifications ADD CONSTRAINT valid_notification_type CHECK (type IN (
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
  'story_view_milestone',
  'upvote_milestone',
  'upvote_whole_group'
));

-- ============================================
-- Helper: Check if whole-group upvote achieved
-- Returns TRUE if all eligible members have upvoted
-- ============================================
CREATE OR REPLACE FUNCTION check_whole_group_upvoted(
  p_message_id UUID,
  p_room_id UUID,
  p_author_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_member_count INT;
  v_upvoter_count INT;
  v_room_type TEXT;
BEGIN
  -- Get room type
  SELECT type INTO v_room_type FROM rooms WHERE id = p_room_id;

  -- Only for groups
  IF v_room_type != 'group' THEN
    RETURN FALSE;
  END IF;

  -- Count eligible members (excluding author who can't vote on own message)
  SELECT COUNT(*) INTO v_member_count
  FROM room_members
  WHERE room_id = p_room_id
    AND user_id != p_author_id;

  -- Need at least 2 eligible voters (group of 3+ total)
  IF v_member_count < 2 THEN
    RETURN FALSE;
  END IF;

  -- Count unique upvoters on this message
  SELECT COUNT(*) INTO v_upvoter_count
  FROM message_votes
  WHERE message_id = p_message_id
    AND vote_type = 'up';

  -- Check if all eligible members have upvoted
  RETURN v_upvoter_count >= v_member_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Helper: Get current upvote count for a message
-- ============================================
CREATE OR REPLACE FUNCTION get_upvote_count(p_message_id UUID)
RETURNS INT AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM message_votes
    WHERE message_id = p_message_id
      AND vote_type = 'up'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Helper: Check if milestone notification already sent
-- ============================================
CREATE OR REPLACE FUNCTION milestone_notification_sent(
  p_message_id UUID,
  p_milestone INT
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM upvote_notification_state
    WHERE message_id = p_message_id
      AND milestone = p_milestone
      AND whole_group = FALSE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Helper: Check if whole-group notification already sent
-- ============================================
CREATE OR REPLACE FUNCTION whole_group_notification_sent(p_message_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM upvote_notification_state
    WHERE message_id = p_message_id
      AND whole_group = TRUE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Process upvote notifications
-- Called after a vote is cast (only for upvotes)
-- Returns: { notified: boolean, type: string | null }
-- ============================================
CREATE OR REPLACE FUNCTION process_upvote_notification(
  p_message_id UUID,
  p_voter_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_message RECORD;
  v_room RECORD;
  v_upvote_count INT;
  v_member_count INT;
  v_milestone INT;
  v_milestones INT[] := ARRAY[1, 3, 5, 10, 25, 100];
  v_notified BOOLEAN := FALSE;
  v_notif_type TEXT := NULL;
BEGIN
  -- Get message info
  SELECT m.id, m.user_id, m.room_id, m.content
  INTO v_message
  FROM messages m
  WHERE m.id = p_message_id;

  IF v_message IS NULL THEN
    RETURN jsonb_build_object('notified', FALSE, 'type', NULL);
  END IF;

  -- Get room info
  SELECT r.id, r.name, r.type
  INTO v_room
  FROM rooms r
  WHERE r.id = v_message.room_id;

  IF v_room IS NULL THEN
    RETURN jsonb_build_object('notified', FALSE, 'type', NULL);
  END IF;

  -- Get current upvote count
  v_upvote_count := get_upvote_count(p_message_id);

  -- Get eligible member count for whole-group check
  SELECT COUNT(*) INTO v_member_count
  FROM room_members
  WHERE room_id = v_room.id
    AND user_id != v_message.user_id;

  -- PRIORITY 1: Check for whole-group upvote (only for groups with 3+ members)
  IF v_room.type = 'group' AND v_member_count >= 2 THEN
    IF check_whole_group_upvoted(p_message_id, v_room.id, v_message.user_id) THEN
      -- Check if already notified
      IF NOT whole_group_notification_sent(p_message_id) THEN
        -- Record notification state (prevents duplicates even under concurrency)
        INSERT INTO upvote_notification_state (message_id, room_id, milestone, whole_group)
        VALUES (p_message_id, v_room.id, NULL, TRUE)
        ON CONFLICT DO NOTHING;

        -- Only create notification if insert succeeded (first caller wins)
        IF FOUND THEN
          -- Create the whole-group notification
          INSERT INTO notifications (user_id, type, room_id, message_id, actor_user_id, metadata)
          VALUES (
            v_message.user_id,
            'upvote_whole_group',
            v_room.id,
            p_message_id,
            p_voter_id,
            jsonb_build_object(
              'room_name', v_room.name,
              'score', v_upvote_count,
              'upvoters_count', v_upvote_count,
              'members_count', v_member_count + 1,  -- +1 for author
              'answer_preview', left(v_message.content, 100)
            )
          );

          v_notified := TRUE;
          v_notif_type := 'upvote_whole_group';
        END IF;
      END IF;

      -- Skip milestone check if whole-group condition was met
      -- (whether we just notified or already had notified)
      RETURN jsonb_build_object('notified', v_notified, 'type', v_notif_type);
    END IF;
  END IF;

  -- PRIORITY 2: Check milestones (only if whole-group didn't fire)
  -- Find the highest milestone that's been crossed
  v_milestone := NULL;
  FOR i IN REVERSE array_length(v_milestones, 1)..1 LOOP
    IF v_upvote_count >= v_milestones[i] THEN
      -- For 100+, check if exactly 100 or any 100+ that wasn't notified
      IF v_milestones[i] = 100 THEN
        IF NOT milestone_notification_sent(p_message_id, 100) THEN
          v_milestone := 100;
          EXIT;
        END IF;
      ELSE
        IF v_upvote_count = v_milestones[i] AND NOT milestone_notification_sent(p_message_id, v_milestones[i]) THEN
          v_milestone := v_milestones[i];
          EXIT;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Create milestone notification if applicable
  IF v_milestone IS NOT NULL THEN
    -- Record notification state
    INSERT INTO upvote_notification_state (message_id, room_id, milestone, whole_group)
    VALUES (p_message_id, v_room.id, v_milestone, FALSE)
    ON CONFLICT DO NOTHING;

    -- Only create notification if insert succeeded
    IF FOUND THEN
      INSERT INTO notifications (user_id, type, room_id, message_id, actor_user_id, metadata)
      VALUES (
        v_message.user_id,
        'upvote_milestone',
        v_room.id,
        p_message_id,
        p_voter_id,
        jsonb_build_object(
          'milestone', v_milestone,
          'room_name', v_room.name,
          'score', v_upvote_count,
          'answer_preview', left(v_message.content, 100)
        )
      );

      v_notified := TRUE;
      v_notif_type := 'upvote_milestone';
    END IF;
  END IF;

  RETURN jsonb_build_object('notified', v_notified, 'type', v_notif_type);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Updated vote_on_message with notifications
-- ============================================
CREATE OR REPLACE FUNCTION vote_on_message(
  p_message_id UUID,
  p_vote_type TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_message RECORD;
  v_existing_vote TEXT;
  v_new_user_vote TEXT := NULL;
  v_score BIGINT;
  v_was_new_upvote BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_vote_type NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'Invalid vote type';
  END IF;

  -- Verify message exists and is a turn_response
  SELECT id, user_id, type, room_id INTO v_message
  FROM messages
  WHERE id = p_message_id;

  IF v_message IS NULL THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  IF v_message.type != 'turn_response' THEN
    RAISE EXCEPTION 'Can only vote on turn responses';
  END IF;

  -- Cannot vote on own messages
  IF v_message.user_id = v_user_id THEN
    RAISE EXCEPTION 'Cannot vote on your own message';
  END IF;

  -- Check existing vote
  SELECT vote_type INTO v_existing_vote
  FROM message_votes
  WHERE message_id = p_message_id AND user_id = v_user_id;

  IF v_existing_vote IS NULL THEN
    -- No existing vote, create new
    INSERT INTO message_votes (message_id, user_id, vote_type)
    VALUES (p_message_id, v_user_id, p_vote_type);
    v_new_user_vote := p_vote_type;
    -- Track if this is a new upvote
    v_was_new_upvote := (p_vote_type = 'up');
  ELSIF v_existing_vote = p_vote_type THEN
    -- Same vote, remove it (toggle off)
    DELETE FROM message_votes
    WHERE message_id = p_message_id AND user_id = v_user_id;
    v_new_user_vote := NULL;
  ELSE
    -- Different vote, switch it
    UPDATE message_votes
    SET vote_type = p_vote_type, created_at = now()
    WHERE message_id = p_message_id AND user_id = v_user_id;
    v_new_user_vote := p_vote_type;
    -- Track if this is a switch to upvote
    v_was_new_upvote := (p_vote_type = 'up');
  END IF;

  -- Calculate new score
  SELECT COALESCE(SUM(CASE WHEN vote_type = 'up' THEN 1 ELSE -1 END), 0)
  INTO v_score
  FROM message_votes
  WHERE message_id = p_message_id;

  -- Cap score at -99
  IF v_score < -99 THEN
    v_score := -99;
  END IF;

  -- Process notifications (only for upvotes, not removals or downvotes)
  IF v_was_new_upvote THEN
    PERFORM process_upvote_notification(p_message_id, v_user_id);
  END IF;

  RETURN jsonb_build_object(
    'score', v_score,
    'user_vote', v_new_user_vote
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Update get_notifications to include upvote types in social filter
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
      OR (p_filter = 'social' AND n.type IN ('followed_you', 'unfollowed_you', 'story_reply', 'story_view_milestone', 'upvote_milestone', 'upvote_whole_group'))
      OR (p_filter = 'turns' AND n.type IN ('your_turn', 'nudged_you', 'turn_skipped', 'turn_completed'))
      OR (p_filter = 'groups' AND n.type IN ('group_invite', 'added_to_group', 'removed_from_group'))
    )
  ORDER BY n.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
