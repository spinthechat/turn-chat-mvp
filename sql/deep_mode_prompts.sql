-- ============================================
-- Deep Mode: Reflective & Meaningful Prompts
-- ============================================

-- 1. Update the validation function to allow 'deep' mode
CREATE OR REPLACE FUNCTION update_room_prompt_mode(p_room_id UUID, p_mode TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  -- Validate mode (extended to include 'deep')
  IF p_mode NOT IN ('fun', 'family', 'deep') THEN
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

-- 2. Insert Deep mode prompts (100 total)
INSERT INTO prompts (text, prompt_type, mode) VALUES
  -- SELF & IDENTITY (1-10)
  ('What''s something about you that''s changed in the last few years?', 'text', 'deep'),
  ('What''s a part of yourself you''re still getting to know?', 'text', 'deep'),
  ('What''s something people often misunderstand about you?', 'text', 'deep'),
  ('What''s a label you''ve outgrown?', 'text', 'deep'),
  ('What''s something you value more now than you used to?', 'text', 'deep'),
  ('What''s a side of you only a few people see?', 'text', 'deep'),
  ('What''s something you''re quietly proud of?', 'text', 'deep'),
  ('What''s a belief you''ve questioned recently?', 'text', 'deep'),
  ('What''s something that feels very "you"?', 'text', 'deep'),
  ('What''s something you''re still figuring out about yourself?', 'text', 'deep'),

  -- GROWTH & CHANGE (11-20)
  ('What''s a lesson you learned later than you wish you had?', 'text', 'deep'),
  ('What''s a mistake that taught you something important?', 'text', 'deep'),
  ('What''s a habit you''re trying to unlearn?', 'text', 'deep'),
  ('What''s something you''ve become better at handling over time?', 'text', 'deep'),
  ('What''s a moment that shifted how you see the world?', 'text', 'deep'),
  ('What''s something you once avoided that you now face differently?', 'text', 'deep'),
  ('What''s a challenge that shaped who you are today?', 'text', 'deep'),
  ('What''s something you''re more patient about now?', 'text', 'deep'),
  ('What''s a change you''re grateful you made?', 'text', 'deep'),
  ('What''s a version of you that you''ve left behind?', 'text', 'deep'),

  -- EMOTIONS & INNER WORLD (21-30)
  ('What emotion do you feel most often lately?', 'text', 'deep'),
  ('What''s something that easily drains your energy?', 'text', 'deep'),
  ('What''s something that helps you feel grounded?', 'text', 'deep'),
  ('What''s an emotion you didn''t learn how to express growing up?', 'text', 'deep'),
  ('What''s something that makes you feel safe?', 'text', 'deep'),
  ('What''s something that overwhelms you more than you''d like?', 'text', 'deep'),
  ('What''s a feeling you''ve learned to sit with?', 'text', 'deep'),
  ('What''s something that brings you quiet comfort?', 'text', 'deep'),
  ('What''s an emotion you''re still learning how to name?', 'text', 'deep'),
  ('What''s something that calms you when things feel heavy?', 'text', 'deep'),

  -- FEARS & WORRIES (31-40)
  ('What''s something you worry about more than you admit?', 'text', 'deep'),
  ('What''s a fear you''ve learned how to manage better?', 'text', 'deep'),
  ('What''s something that makes you feel uncertain about the future?', 'text', 'deep'),
  ('What''s a fear that used to be bigger than it is now?', 'text', 'deep'),
  ('What''s something you avoid because it feels uncomfortable?', 'text', 'deep'),
  ('What''s something that makes you feel vulnerable?', 'text', 'deep'),
  ('What''s a fear you''ve surprised yourself by facing?', 'text', 'deep'),
  ('What''s something that still feels a little scary to talk about?', 'text', 'deep'),
  ('What''s a situation where you tend to overthink?', 'text', 'deep'),
  ('What''s something you''re learning not to fear as much?', 'text', 'deep'),

  -- RELATIONSHIPS & CONNECTION (41-50)
  ('What makes you feel truly understood?', 'text', 'deep'),
  ('What''s something you need more of in close relationships?', 'text', 'deep'),
  ('What''s a way you show care that isn''t always noticed?', 'text', 'deep'),
  ('What''s something that helps you trust someone?', 'text', 'deep'),
  ('What''s a pattern you''ve noticed in your relationships?', 'text', 'deep'),
  ('What''s something you''ve learned about setting boundaries?', 'text', 'deep'),
  ('What''s something that makes you feel emotionally close to others?', 'text', 'deep'),
  ('What''s a relationship lesson you learned the hard way?', 'text', 'deep'),
  ('What''s something you appreciate more in people now?', 'text', 'deep'),
  ('What''s something you wish people asked you more often?', 'text', 'deep'),

  -- PAST & REFLECTION (51-60)
  ('What''s a memory that still sticks with you?', 'text', 'deep'),
  ('What''s something from your past you see differently now?', 'text', 'deep'),
  ('What''s a moment you didn''t realize was important at the time?', 'text', 'deep'),
  ('What''s something younger you needed to hear?', 'text', 'deep'),
  ('What''s a past experience that shaped how you act today?', 'text', 'deep'),
  ('What''s something you''ve made peace with?', 'text', 'deep'),
  ('What''s a time you surprised yourself?', 'text', 'deep'),
  ('What''s a chapter of your life that taught you a lot?', 'text', 'deep'),
  ('What''s something you no longer blame yourself for?', 'text', 'deep'),
  ('What''s a memory that feels bittersweet?', 'text', 'deep'),

  -- HOPES, DESIRES & MEANING (61-70)
  ('What''s something you''re quietly hoping for?', 'text', 'deep'),
  ('What''s a goal that feels personal to you?', 'text', 'deep'),
  ('What''s something you want more of in your life?', 'text', 'deep'),
  ('What''s something that gives your life meaning?', 'text', 'deep'),
  ('What''s a dream that''s changed over time?', 'text', 'deep'),
  ('What''s something you want to protect in your life?', 'text', 'deep'),
  ('What''s something you''re working toward, even slowly?', 'text', 'deep'),
  ('What''s a future version of you you''re curious about?', 'text', 'deep'),
  ('What''s something you want to experience more deeply?', 'text', 'deep'),
  ('What''s something you want to feel less rushed about?', 'text', 'deep'),

  -- VALUES & PERSPECTIVE (71-80)
  ('What''s something you stand firm on?', 'text', 'deep'),
  ('What''s a value that guides your decisions?', 'text', 'deep'),
  ('What''s something you''ve had to compromise on?', 'text', 'deep'),
  ('What''s something you care about more than you show?', 'text', 'deep'),
  ('What''s a principle you try to live by?', 'text', 'deep'),
  ('What''s something you''ve learned to let go of?', 'text', 'deep'),
  ('What''s a perspective that changed your mind?', 'text', 'deep'),
  ('What''s something you wish more people understood?', 'text', 'deep'),
  ('What''s something that feels important but not urgent?', 'text', 'deep'),
  ('What''s something you''re learning to accept?', 'text', 'deep'),

  -- PRESENCE & BALANCE (81-90)
  ('What helps you feel present?', 'text', 'deep'),
  ('What''s something that pulls you out of the moment?', 'text', 'deep'),
  ('What''s a small thing that improves your day?', 'text', 'deep'),
  ('What''s something you want to slow down with?', 'text', 'deep'),
  ('What''s something that makes time feel fuller?', 'text', 'deep'),
  ('What''s something you want to be more intentional about?', 'text', 'deep'),
  ('What''s something you do just for yourself?', 'text', 'deep'),
  ('What''s a boundary you''re glad you set?', 'text', 'deep'),
  ('What''s something you want to make more room for?', 'text', 'deep'),
  ('What''s something you want to simplify?', 'text', 'deep'),

  -- GENTLE CLOSING PROMPTS (91-100)
  ('What''s something you''re still learning to forgive?', 'text', 'deep'),
  ('What''s something you''re grateful for right now?', 'text', 'deep'),
  ('What''s a truth you''re slowly accepting?', 'text', 'deep'),
  ('What''s something you want to be kinder to yourself about?', 'text', 'deep'),
  ('What''s something that feels unresolved but okay?', 'text', 'deep'),
  ('What''s something you don''t have an answer to yet?', 'text', 'deep'),
  ('What''s something you''re learning to trust?', 'text', 'deep'),
  ('What''s something you want to hold onto?', 'text', 'deep'),
  ('What''s something you''re ready to release?', 'text', 'deep'),
  ('What''s something you hope people remember about you?', 'text', 'deep');
