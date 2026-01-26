-- ============================================
-- Couple Mode: Reflective & Connective Prompts
-- ============================================

-- 1. Update the validation function to allow 'couple' mode
CREATE OR REPLACE FUNCTION update_room_prompt_mode(p_room_id UUID, p_mode TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  -- Validate mode (extended to include 'couple')
  IF p_mode NOT IN ('fun', 'family', 'deep', 'flirty', 'couple') THEN
    RAISE EXCEPTION 'Invalid prompt mode';
  END IF;

  -- Verify caller is a member of the room
  IF NOT EXISTS (
    SELECT 1 FROM room_members WHERE room_id = p_room_id AND user_id = caller_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  -- Update the room's prompt mode
  UPDATE rooms SET prompt_mode = p_mode WHERE id = p_room_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Insert Couple mode TEXT prompts (100 total)
INSERT INTO prompts (text, prompt_type, mode) VALUES
  -- CONNECTION & CLOSENESS (1-10)
  ('What''s something you wish we had more time to do together?', 'text', 'couple'),
  ('What''s a small moment with me that you think about often?', 'text', 'couple'),
  ('When do you feel most connected to me?', 'text', 'couple'),
  ('What''s something about us that makes you feel proud?', 'text', 'couple'),
  ('What''s a recent moment where you felt really close to me?', 'text', 'couple'),
  ('What''s one thing I do that makes you feel cared for?', 'text', 'couple'),
  ('What''s something you appreciate about how we communicate?', 'text', 'couple'),
  ('When do you feel most understood by me?', 'text', 'couple'),
  ('What''s a memory of us that always makes you smile?', 'text', 'couple'),
  ('What''s something you love about our everyday routine?', 'text', 'couple'),

  -- TELL ME ABOUT A TIME (11-20)
  ('Tell me about a time you felt especially supported by me.', 'text', 'couple'),
  ('Tell me about a time you felt really seen by me.', 'text', 'couple'),
  ('Tell me about a time you felt grateful we were together.', 'text', 'couple'),
  ('Tell me about a moment when you realized you trusted me.', 'text', 'couple'),
  ('Tell me about a time we handled something difficult well.', 'text', 'couple'),
  ('Tell me about a moment that made you feel safe with me.', 'text', 'couple'),
  ('Tell me about a time you felt proud of how we showed up for each other.', 'text', 'couple'),
  ('Tell me about a time we laughed so hard it stuck with you.', 'text', 'couple'),
  ('Tell me about a time you felt deeply appreciated by me.', 'text', 'couple'),
  ('Tell me about a moment that reminded you why we work.', 'text', 'couple'),

  -- GROWTH & LEARNING (21-30)
  ('What''s something you''ve learned about yourself since being with me?', 'text', 'couple'),
  ('What''s something you''ve learned about love from our relationship?', 'text', 'couple'),
  ('What''s a habit we have that you really value?', 'text', 'couple'),
  ('What''s a challenge we''ve grown through together?', 'text', 'couple'),
  ('What''s something we''re better at now than we used to be?', 'text', 'couple'),
  ('What''s a way we''ve changed each other for the better?', 'text', 'couple'),
  ('What''s something you admire about how I handle things?', 'text', 'couple'),
  ('What''s something you admire about how we handle things together?', 'text', 'couple'),
  ('What''s a shared value that feels important to us?', 'text', 'couple'),
  ('What''s something about our relationship that feels unique?', 'text', 'couple'),

  -- WHEN DO YOU FEEL (31-40)
  ('When do you feel most appreciated by me?', 'text', 'couple'),
  ('When do you feel most relaxed around me?', 'text', 'couple'),
  ('When do you feel most emotionally close to me?', 'text', 'couple'),
  ('When do you feel like we''re really in sync?', 'text', 'couple'),
  ('When do you feel like we''re a team?', 'text', 'couple'),
  ('When do you feel most yourself with me?', 'text', 'couple'),
  ('When do you feel most grateful for our relationship?', 'text', 'couple'),
  ('When do you feel most loved in small ways?', 'text', 'couple'),
  ('When do you feel most proud of us?', 'text', 'couple'),
  ('When do you feel most hopeful about our future?', 'text', 'couple'),

  -- COMMUNICATION & VALUES (41-50)
  ('What''s something you wish we talked about more?', 'text', 'couple'),
  ('What''s something you enjoy talking about with me?', 'text', 'couple'),
  ('What''s something you feel comfortable sharing with me now that you didn''t before?', 'text', 'couple'),
  ('What''s something you appreciate about how we resolve conflict?', 'text', 'couple'),
  ('What''s something you want us to protect in our relationship?', 'text', 'couple'),
  ('What''s something you want us to keep doing no matter what?', 'text', 'couple'),
  ('What''s something you think we''ve gotten better at recently?', 'text', 'couple'),
  ('What''s something that makes our conversations feel special?', 'text', 'couple'),
  ('What''s something you never want us to lose?', 'text', 'couple'),
  ('What''s something you feel lucky to have with me?', 'text', 'couple'),

  -- SMALL THINGS & SUPPORT (51-60)
  ('What''s a small thing I do that means a lot to you?', 'text', 'couple'),
  ('What''s a way I make your life easier?', 'text', 'couple'),
  ('What''s a way I help you feel grounded?', 'text', 'couple'),
  ('What''s a way I help you feel more confident?', 'text', 'couple'),
  ('What''s a way I help you feel calm?', 'text', 'couple'),
  ('What''s a way I help you feel understood?', 'text', 'couple'),
  ('What''s a way I help you feel supported?', 'text', 'couple'),
  ('What''s a way I help you feel valued?', 'text', 'couple'),
  ('What''s a way I help you feel closer to yourself?', 'text', 'couple'),
  ('What''s a way I help you feel more hopeful?', 'text', 'couple'),

  -- FUTURE & HOPES (61-70)
  ('What''s something about our future that excites you?', 'text', 'couple'),
  ('What''s something you''re looking forward to experiencing together?', 'text', 'couple'),
  ('What''s something you hope we keep building?', 'text', 'couple'),
  ('What''s something you hope we get better at together?', 'text', 'couple'),
  ('What''s something you hope we always make time for?', 'text', 'couple'),
  ('What''s something you hope we never stop sharing?', 'text', 'couple'),
  ('What''s something you hope we protect when life gets busy?', 'text', 'couple'),
  ('What''s something you hope we grow into together?', 'text', 'couple'),
  ('What''s something you hope we laugh about years from now?', 'text', 'couple'),
  ('What''s something you hope stays easy between us?', 'text', 'couple'),

  -- MEANINGFUL MOMENTS (71-80)
  ('What''s a moment when you felt emotionally close without words?', 'text', 'couple'),
  ('What''s a quiet moment we shared that felt meaningful?', 'text', 'couple'),
  ('What''s a moment that made you feel reassured about us?', 'text', 'couple'),
  ('What''s a moment where you felt we really understood each other?', 'text', 'couple'),
  ('What''s a moment where you felt deeply appreciated?', 'text', 'couple'),
  ('What''s a moment where you felt chosen?', 'text', 'couple'),
  ('What''s a moment that felt very "us"?', 'text', 'couple'),
  ('What''s a moment you''d relive if you could?', 'text', 'couple'),
  ('What''s a moment that made you feel thankful for our bond?', 'text', 'couple'),
  ('What''s a moment that made you feel calm about the future?', 'text', 'couple'),

  -- VULNERABILITY & TRUST (81-90)
  ('What''s something you want me to know about how you feel lately?', 'text', 'couple'),
  ('What''s something you''ve been meaning to say to me?', 'text', 'couple'),
  ('What''s something you appreciate about how I show up for you?', 'text', 'couple'),
  ('What''s something you value about how we care for each other?', 'text', 'couple'),
  ('What''s something that makes you feel emotionally safe with me?', 'text', 'couple'),
  ('What''s something you feel proud to share with me?', 'text', 'couple'),
  ('What''s something you trust me with?', 'text', 'couple'),
  ('What''s something you feel comfortable being vulnerable about with me?', 'text', 'couple'),
  ('What''s something you feel lucky to experience with me?', 'text', 'couple'),
  ('What''s something you feel grateful we''ve built together?', 'text', 'couple'),

  -- RELATIONSHIP QUALITIES (91-100)
  ('What''s something that makes our relationship feel steady?', 'text', 'couple'),
  ('What''s something that makes our relationship feel warm?', 'text', 'couple'),
  ('What''s something that makes our relationship feel fun?', 'text', 'couple'),
  ('What''s something that makes our relationship feel meaningful?', 'text', 'couple'),
  ('What''s something that makes our relationship feel balanced?', 'text', 'couple'),
  ('What''s something that makes our relationship feel supportive?', 'text', 'couple'),
  ('What''s something that makes our relationship feel honest?', 'text', 'couple'),
  ('What''s something that makes our relationship feel peaceful?', 'text', 'couple'),
  ('What''s something that makes our relationship feel strong?', 'text', 'couple'),
  ('What''s something that makes you feel hopeful about "us"?', 'text', 'couple');
