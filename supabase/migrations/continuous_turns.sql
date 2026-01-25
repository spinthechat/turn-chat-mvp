-- Migration: Convert from round-based to continuous turn-based gameplay
-- The game cycles through players indefinitely: A → B → C → A → ...
-- Each player gets their own random prompt when it's their turn

-- ============================================
-- 1. Create prompts table with fun prompts
-- ============================================

CREATE TABLE IF NOT EXISTS prompts (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default prompts
INSERT INTO prompts (text) VALUES
  ('What''s a hill you''re willing to die on?'),
  ('Describe your perfect lazy Sunday.'),
  ('What''s the weirdest food combination you enjoy?'),
  ('If you could have dinner with anyone, dead or alive, who would it be?'),
  ('What''s an unpopular opinion you hold?'),
  ('Describe your most embarrassing moment.'),
  ('What superpower would you choose and why?'),
  ('What''s the best advice you''ve ever received?'),
  ('If you won the lottery tomorrow, what''s the first thing you''d do?'),
  ('What''s a skill you wish you had?'),
  ('Describe your dream vacation destination.'),
  ('What''s something you believed as a child that turned out to be false?'),
  ('If you could live in any fictional world, which would it be?'),
  ('What''s your go-to karaoke song?'),
  ('Describe the best meal you''ve ever had.'),
  ('What''s something on your bucket list?'),
  ('If you could master any instrument overnight, which would it be?'),
  ('What''s a movie that changed your perspective on something?'),
  ('Describe your ideal weekend getaway.'),
  ('What''s the most spontaneous thing you''ve ever done?'),
  ('If you could swap lives with someone for a day, who would it be?'),
  ('What''s a small thing that makes you unreasonably happy?'),
  ('Describe your morning routine in detail.'),
  ('What''s an underrated thing you think more people should try?'),
  ('If you had to eat one cuisine for the rest of your life, what would it be?'),
  ('What''s something you''re irrationally afraid of?'),
  ('Describe your happy place.'),
  ('What''s a compliment you''ll never forget?'),
  ('If you could witness any historical event, what would it be?'),
  ('What''s your guilty pleasure TV show or movie?')
ON CONFLICT DO NOTHING;

-- Allow everyone to read prompts
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Prompts are readable by authenticated users"
  ON prompts FOR SELECT TO authenticated USING (true);


-- ============================================
-- 2. Helper function to get a random prompt
-- ============================================

CREATE OR REPLACE FUNCTION get_random_prompt()
RETURNS TEXT AS $$
DECLARE
  prompt_text TEXT;
BEGIN
  SELECT text INTO prompt_text
  FROM prompts
  ORDER BY RANDOM()
  LIMIT 1;

  RETURN COALESCE(prompt_text, 'Share something interesting about yourself.');
END;
$$ LANGUAGE plpgsql;


-- ============================================
-- 3. Updated start_session RPC
-- Initializes continuous gameplay mode
-- ============================================

CREATE OR REPLACE FUNCTION start_session(p_room_id UUID)
RETURNS VOID AS $$
DECLARE
  caller_id UUID := auth.uid();
  caller_role TEXT;
  member_ids UUID[];
  first_prompt TEXT;
BEGIN
  -- Check caller is host
  SELECT role INTO caller_role
  FROM room_members
  WHERE room_id = p_room_id AND user_id = caller_id;

  IF caller_role IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this room';
  END IF;

  IF caller_role <> 'host' THEN
    RAISE EXCEPTION 'Only the host can start the game';
  END IF;

  -- Get all member IDs in consistent order
  SELECT ARRAY_AGG(user_id ORDER BY joined_at, user_id)
  INTO member_ids
  FROM room_members
  WHERE room_id = p_room_id;

  IF ARRAY_LENGTH(member_ids, 1) < 2 THEN
    RAISE EXCEPTION 'Need at least 2 players to start the game';
  END IF;

  -- Get a random prompt for the first player
  first_prompt := get_random_prompt();

  -- Create or update the session (continuous mode)
  INSERT INTO turn_sessions (room_id, turn_order, current_turn_index, prompt_text, is_active)
  VALUES (p_room_id, member_ids, 0, first_prompt, TRUE)
  ON CONFLICT (room_id) DO UPDATE SET
    turn_order = member_ids,
    current_turn_index = 0,
    prompt_text = first_prompt,
    is_active = TRUE;

  -- Insert system message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, NULL, 'system', 'Game started! Players will take turns answering prompts.');

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================
-- 4. Updated submit_turn RPC
-- Advances to next player with a NEW prompt
-- Never ends the game automatically
-- ============================================

CREATE OR REPLACE FUNCTION submit_turn(p_room_id UUID, p_content TEXT)
RETURNS VOID AS $$
DECLARE
  caller_id UUID := auth.uid();
  sess RECORD;
  current_player_id UUID;
  next_index INT;
  next_prompt TEXT;
  next_player_id UUID;
BEGIN
  -- Get the current session
  SELECT * INTO sess
  FROM turn_sessions
  WHERE room_id = p_room_id AND is_active = TRUE;

  IF sess IS NULL THEN
    RAISE EXCEPTION 'No active game in this room';
  END IF;

  -- Check it's the caller's turn
  current_player_id := sess.turn_order[sess.current_turn_index + 1]; -- PostgreSQL arrays are 1-indexed

  IF current_player_id <> caller_id THEN
    RAISE EXCEPTION 'It is not your turn';
  END IF;

  -- Insert the turn response message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, caller_id, 'turn_response', p_content);

  -- Calculate next index (wrap around for continuous cycling)
  next_index := (sess.current_turn_index + 1) % ARRAY_LENGTH(sess.turn_order, 1);

  -- Get a new random prompt for the next player
  next_prompt := get_random_prompt();

  -- Get next player for system message
  next_player_id := sess.turn_order[next_index + 1]; -- 1-indexed

  -- Update session with next player and new prompt
  UPDATE turn_sessions
  SET current_turn_index = next_index,
      prompt_text = next_prompt
  WHERE room_id = p_room_id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================
-- 5. Updated end_session RPC
-- Host can stop the continuous game
-- ============================================

CREATE OR REPLACE FUNCTION end_session(p_room_id UUID)
RETURNS VOID AS $$
DECLARE
  caller_id UUID := auth.uid();
  caller_role TEXT;
BEGIN
  -- Check caller is host
  SELECT role INTO caller_role
  FROM room_members
  WHERE room_id = p_room_id AND user_id = caller_id;

  IF caller_role <> 'host' THEN
    RAISE EXCEPTION 'Only the host can stop the game';
  END IF;

  -- Deactivate the session
  UPDATE turn_sessions
  SET is_active = FALSE
  WHERE room_id = p_room_id;

  -- Insert system message
  INSERT INTO messages (room_id, user_id, type, content)
  VALUES (p_room_id, NULL, 'system', 'Game stopped by host.');

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
