-- ============================================
-- Flirty Mode: Bold & Playful Prompts
-- ============================================

-- 1. Update the validation function to allow 'flirty' mode
CREATE OR REPLACE FUNCTION update_room_prompt_mode(p_room_id UUID, p_mode TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  -- Validate mode (extended to include 'flirty')
  IF p_mode NOT IN ('fun', 'family', 'deep', 'flirty') THEN
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

-- 2. Insert Flirty mode TEXT prompts (100 total)
INSERT INTO prompts (text, prompt_type, mode) VALUES
  -- GROUP DYNAMICS & CHARM (1-25)
  ('Who in the group gives off the most "main character" energy?', 'text', 'flirty'),
  ('What''s something you do that you know people find attractive?', 'text', 'flirty'),
  ('Who in the group would you flirt with first if you met tonight?', 'text', 'flirty'),
  ('What''s your most underrated attractive trait?', 'text', 'flirty'),
  ('What kind of compliment actually makes you blush?', 'text', 'flirty'),
  ('What''s your go-to move when you want someone''s attention?', 'text', 'flirty'),
  ('Who in the group would survive best on charm alone?', 'text', 'flirty'),
  ('What''s something small someone could do that would instantly win you over?', 'text', 'flirty'),
  ('What''s your favorite thing someone has ever flirted with you about?', 'text', 'flirty'),
  ('Who in the group would be the best at a slow-burn romance?', 'text', 'flirty'),
  ('What''s your favorite way to be flirted with—words, looks, or actions?', 'text', 'flirty'),
  ('What''s a harmless habit you have that''s secretly kind of hot?', 'text', 'flirty'),
  ('Who in the group would dominate a dating app profile?', 'text', 'flirty'),
  ('What''s your idea of a perfect first impression?', 'text', 'flirty'),
  ('What''s a song that instantly puts you in a flirty mood?', 'text', 'flirty'),
  ('What''s something you find attractive that most people don''t expect?', 'text', 'flirty'),
  ('Who in the group would make strangers curious just by walking into a room?', 'text', 'flirty'),
  ('What''s a look or style that always works on you?', 'text', 'flirty'),
  ('What''s the smoothest thing someone could say to you?', 'text', 'flirty'),
  ('Who in the group would accidentally flirt without meaning to?', 'text', 'flirty'),
  ('What''s your favorite kind of playful teasing?', 'text', 'flirty'),
  ('What''s a situation where you felt unexpectedly attractive?', 'text', 'flirty'),
  ('Who in the group would be best at eye contact alone?', 'text', 'flirty'),
  ('What''s a vibe you love giving off when you feel confident?', 'text', 'flirty'),
  ('What''s one thing that instantly makes someone more attractive to you?', 'text', 'flirty'),

  -- CONFIDENT MEMORIES (26-35)
  ('What''s a memory that makes you feel unexpectedly confident?', 'text', 'flirty'),
  ('What''s a memory that makes you feel desired?', 'text', 'flirty'),
  ('What''s a memory that makes you feel warm when you think about it?', 'text', 'flirty'),
  ('What''s a memory that makes you feel like your best self?', 'text', 'flirty'),
  ('What''s a memory that makes you smile every time it pops up?', 'text', 'flirty'),
  ('What''s a memory that makes you feel bold?', 'text', 'flirty'),
  ('What''s a memory that makes you feel quietly attractive?', 'text', 'flirty'),
  ('What''s a memory that makes you feel proud of how you showed up?', 'text', 'flirty'),
  ('What''s a memory that makes you feel playful?', 'text', 'flirty'),
  ('What''s a memory that makes you feel seen?', 'text', 'flirty'),

  -- FLIRTING MOMENTS (36-45)
  ('Tell me about a time you surprised yourself while flirting.', 'text', 'flirty'),
  ('Tell me about a time you felt instantly drawn to someone.', 'text', 'flirty'),
  ('Tell me about a time you realized someone was into you.', 'text', 'flirty'),
  ('Tell me about a time you flirted without saying a word.', 'text', 'flirty'),
  ('Tell me about a time you felt extra confident in your skin.', 'text', 'flirty'),
  ('Tell me about a time you had great chemistry with someone.', 'text', 'flirty'),
  ('Tell me about a time you enjoyed the attention more than expected.', 'text', 'flirty'),
  ('Tell me about a time you felt like the vibe was just right.', 'text', 'flirty'),
  ('Tell me about a time you took a small romantic risk.', 'text', 'flirty'),
  ('Tell me about a time you felt admired.', 'text', 'flirty'),

  -- DATING EXPERIENCES (46-55)
  ('Tell me about a dating experience that started better than you expected.', 'text', 'flirty'),
  ('Tell me about a dating experience that taught you what you like.', 'text', 'flirty'),
  ('Tell me about a dating experience that felt very natural.', 'text', 'flirty'),
  ('Tell me about a dating experience that made you laugh a lot.', 'text', 'flirty'),
  ('Tell me about a dating experience that surprised you.', 'text', 'flirty'),
  ('Tell me about a dating experience that boosted your confidence.', 'text', 'flirty'),
  ('Tell me about a dating experience that had great chemistry.', 'text', 'flirty'),
  ('Tell me about a dating experience that felt like a movie moment.', 'text', 'flirty'),
  ('Tell me about a dating experience that didn''t last but felt meaningful.', 'text', 'flirty'),
  ('Tell me about a dating experience that changed your perspective.', 'text', 'flirty'),

  -- MEMORABLE PEOPLE (56-65)
  ('Tell me about someone who instantly caught your attention.', 'text', 'flirty'),
  ('Tell me about someone who made you feel attractive without trying.', 'text', 'flirty'),
  ('Tell me about someone who had amazing charm.', 'text', 'flirty'),
  ('Tell me about someone who flirted in a way you loved.', 'text', 'flirty'),
  ('Tell me about someone who made you feel comfortable being yourself.', 'text', 'flirty'),
  ('Tell me about someone who had great confidence.', 'text', 'flirty'),
  ('Tell me about someone who surprised you with their energy.', 'text', 'flirty'),
  ('Tell me about someone who made you feel wanted.', 'text', 'flirty'),
  ('Tell me about someone who had an unforgettable vibe.', 'text', 'flirty'),
  ('Tell me about someone who made you rethink your "type."', 'text', 'flirty'),

  -- HAVE YOU EVER (66-75)
  ('Have you ever caught feelings when you weren''t expecting to?', 'text', 'flirty'),
  ('Have you ever flirted just for fun?', 'text', 'flirty'),
  ('Have you ever realized someone was flirting with you way too late?', 'text', 'flirty'),
  ('Have you ever had chemistry with someone immediately?', 'text', 'flirty'),
  ('Have you ever enjoyed a little harmless attention?', 'text', 'flirty'),
  ('Have you ever felt a spark from a simple conversation?', 'text', 'flirty'),
  ('Have you ever liked someone''s confidence more than their looks?', 'text', 'flirty'),
  ('Have you ever been attracted to someone''s voice?', 'text', 'flirty'),
  ('Have you ever felt the tension in a room shift?', 'text', 'flirty'),
  ('Have you ever felt extra confident on a random day?', 'text', 'flirty'),

  -- CONFIDENCE & ATTRACTION (76-85)
  ('What kind of energy do you give off when you''re feeling confident?', 'text', 'flirty'),
  ('What''s a small thing that makes flirting fun for you?', 'text', 'flirty'),
  ('What''s your favorite kind of playful attention?', 'text', 'flirty'),
  ('What makes you feel most attractive—without trying?', 'text', 'flirty'),
  ('What''s a compliment you never forget?', 'text', 'flirty'),
  ('What''s your favorite way to build chemistry?', 'text', 'flirty'),
  ('What''s something subtle that you find really attractive?', 'text', 'flirty'),
  ('What kind of vibe do you like giving off?', 'text', 'flirty'),
  ('What''s a moment when you felt quietly magnetic?', 'text', 'flirty'),
  ('What''s something about you that people tend to notice?', 'text', 'flirty'),

  -- GROUP CHARM QUESTIONS (86-95)
  ('Who in the group gives off effortless charm?', 'text', 'flirty'),
  ('Who in the group would thrive on a first date?', 'text', 'flirty'),
  ('Who in the group has the best flirting energy?', 'text', 'flirty'),
  ('Who in the group would win people over just by talking?', 'text', 'flirty'),
  ('Who in the group has the most intriguing vibe?', 'text', 'flirty'),
  ('Who in the group would be great at playful teasing?', 'text', 'flirty'),
  ('Who in the group would make people feel comfortable fast?', 'text', 'flirty'),
  ('Who in the group would be great at subtle flirting?', 'text', 'flirty'),
  ('Who in the group has the best confidence energy?', 'text', 'flirty'),
  ('Who in the group would make a great first impression?', 'text', 'flirty'),

  -- FUN CLOSING PROMPTS (96-100)
  ('What''s your idea of a fun, flirty moment?', 'text', 'flirty'),
  ('What kind of setting brings out your confident side?', 'text', 'flirty'),
  ('What''s a mood that makes you feel most like yourself?', 'text', 'flirty'),
  ('What kind of conversation makes flirting effortless?', 'text', 'flirty'),
  ('What''s something that instantly boosts your mood?', 'text', 'flirty');

-- 3. Insert Flirty mode PHOTO prompts (10 total - require photo upload)
INSERT INTO prompts (text, prompt_type, mode) VALUES
  ('Take a selfie where you''re feeling cute—no overthinking.', 'photo', 'flirty'),
  ('Take a selfie with food, trying to make it look way more sensual than it needs to be.', 'photo', 'flirty'),
  ('Take a mirror selfie showing your favorite outfit today.', 'photo', 'flirty'),
  ('Take a photo that shows your "confident mood" right now.', 'photo', 'flirty'),
  ('Take a selfie using lighting you think makes you look best.', 'photo', 'flirty'),
  ('Take a photo of something you''re holding that feels very you.', 'photo', 'flirty'),
  ('Take a selfie with a subtle smile—nothing forced.', 'photo', 'flirty'),
  ('Take a photo that gives off "soft flirt" energy.', 'photo', 'flirty'),
  ('Take a selfie from an angle you know works for you.', 'photo', 'flirty'),
  ('Take a photo of your surroundings that feel cozy and inviting.', 'photo', 'flirty');
