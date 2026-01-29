-- ============================================
-- MESSAGE VOTES - Reddit-style upvote/downvote
-- ============================================
-- Voting applies ONLY to turn_response messages
-- One vote per user per message
-- Switching votes replaces the old vote

-- ============================================
-- Message Votes Table
-- ============================================
CREATE TABLE IF NOT EXISTS message_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One vote per user per message
  UNIQUE (message_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_message_votes_message ON message_votes(message_id);
CREATE INDEX IF NOT EXISTS idx_message_votes_user ON message_votes(user_id);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE message_votes ENABLE ROW LEVEL SECURITY;

-- Users can read all votes (for score calculation)
CREATE POLICY "Users can read votes"
  ON message_votes FOR SELECT
  USING (true);

-- Users can only manage their own votes
CREATE POLICY "Users can insert own votes"
  ON message_votes FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own votes"
  ON message_votes FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own votes"
  ON message_votes FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- Vote on a message (handles toggle/switch logic)
-- Returns: { score: number, user_vote: 'up' | 'down' | null }
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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_vote_type NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'Invalid vote type';
  END IF;

  -- Verify message exists and is a turn_response
  SELECT id, user_id, type INTO v_message
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

  RETURN jsonb_build_object(
    'score', v_score,
    'user_vote', v_new_user_vote
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Get vote info for a single message
-- Returns: { score: number, user_vote: 'up' | 'down' | null }
-- ============================================
CREATE OR REPLACE FUNCTION get_message_vote_info(p_message_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_score BIGINT;
  v_user_vote TEXT;
BEGIN
  -- Calculate score
  SELECT COALESCE(SUM(CASE WHEN vote_type = 'up' THEN 1 ELSE -1 END), 0)
  INTO v_score
  FROM message_votes
  WHERE message_id = p_message_id;

  -- Cap score at -99
  IF v_score < -99 THEN
    v_score := -99;
  END IF;

  -- Get user's vote if authenticated
  IF v_user_id IS NOT NULL THEN
    SELECT vote_type INTO v_user_vote
    FROM message_votes
    WHERE message_id = p_message_id AND user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'score', v_score,
    'user_vote', v_user_vote
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Get vote info for multiple messages (batch)
-- More efficient for loading a chat
-- ============================================
CREATE OR REPLACE FUNCTION get_messages_vote_info(p_message_ids UUID[])
RETURNS TABLE(
  message_id UUID,
  score BIGINT,
  user_vote TEXT
) AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    m.id as message_id,
    GREATEST(-99, COALESCE(SUM(CASE WHEN mv.vote_type = 'up' THEN 1 WHEN mv.vote_type = 'down' THEN -1 ELSE 0 END), 0))::BIGINT as score,
    (SELECT mv2.vote_type FROM message_votes mv2 WHERE mv2.message_id = m.id AND mv2.user_id = v_user_id) as user_vote
  FROM unnest(p_message_ids) AS m(id)
  LEFT JOIN message_votes mv ON mv.message_id = m.id
  GROUP BY m.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Get top answers in a room
-- For Group Settings "Top Answers" section
-- ============================================
CREATE OR REPLACE FUNCTION get_top_answers(
  p_room_id UUID,
  p_min_score INT DEFAULT 3,
  p_limit INT DEFAULT 20
)
RETURNS TABLE(
  message_id UUID,
  user_id UUID,
  content TEXT,
  created_at TIMESTAMPTZ,
  score BIGINT,
  user_email TEXT,
  user_display_name TEXT,
  user_avatar_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id as message_id,
    m.user_id,
    m.content,
    m.created_at,
    COALESCE(SUM(CASE WHEN mv.vote_type = 'up' THEN 1 WHEN mv.vote_type = 'down' THEN -1 ELSE 0 END), 0)::BIGINT as score,
    p.email as user_email,
    p.display_name as user_display_name,
    p.avatar_url as user_avatar_url
  FROM messages m
  LEFT JOIN message_votes mv ON mv.message_id = m.id
  LEFT JOIN profiles p ON p.id = m.user_id
  WHERE m.room_id = p_room_id
    AND m.type = 'turn_response'
  GROUP BY m.id, m.user_id, m.content, m.created_at, p.email, p.display_name, p.avatar_url
  HAVING COALESCE(SUM(CASE WHEN mv.vote_type = 'up' THEN 1 WHEN mv.vote_type = 'down' THEN -1 ELSE 0 END), 0) >= p_min_score
  ORDER BY score DESC, m.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Enable realtime for vote updates (optional)
-- ============================================
-- ALTER PUBLICATION supabase_realtime ADD TABLE message_votes;

