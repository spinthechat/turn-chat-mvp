-- ============================================
-- Replace Prompts with New Fun Mode Pool (100)
-- ============================================

-- Clear existing FUN mode prompts only (preserve other modes)
DELETE FROM prompts WHERE mode = 'fun';

-- Insert new TEXT prompts (100 total) for Fun mode
INSERT INTO prompts (text, prompt_type, mode) VALUES
  -- Embarrassing / Confidence Stories (1-10)
  ('Tell us about a time you were way more confident than you should''ve been.', 'text', 'fun'),
  ('Tell us about a time you misunderstood something for an embarrassingly long time.', 'text', 'fun'),
  ('What''s something you believed as a kid that now feels ridiculous?', 'text', 'fun'),
  ('Tell us about a time you got lost but didn''t want to admit it.', 'text', 'fun'),
  ('What''s a small decision that unexpectedly changed your day (or week)?', 'text', 'fun'),
  ('Tell us about a time you laughed at the worst possible moment.', 'text', 'fun'),
  ('What''s a moment you thought would be a disaster but turned out fine?', 'text', 'fun'),
  ('Tell us about a time you were convinced you were right… and weren''t.', 'text', 'fun'),
  ('What''s the weirdest compliment you''ve ever received?', 'text', 'fun'),
  ('Tell us about a time you tried to impress someone and failed.', 'text', 'fun'),

  -- Self-Awareness / Quirks (11-20)
  ('What''s something you''re oddly proud of?', 'text', 'fun'),
  ('What''s a habit you know is weird but fully accept?', 'text', 'fun'),
  ('What''s something you used to love that you totally outgrew?', 'text', 'fun'),
  ('What''s a personality trait you didn''t realize you had until recently?', 'text', 'fun'),
  ('What''s something you pretend not to care about but secretly do?', 'text', 'fun'),
  ('What''s a skill you don''t get to use very often?', 'text', 'fun'),
  ('What''s something you''re surprisingly bad at?', 'text', 'fun'),
  ('What''s a random thing that instantly improves your mood?', 'text', 'fun'),
  ('What''s a food opinion you''ll defend forever?', 'text', 'fun'),
  ('What''s a trend you''re glad is over?', 'text', 'fun'),

  -- Guilty Pleasures / Random Facts (21-30)
  ('What''s the dumbest way you''ve hurt yourself?', 'text', 'fun'),
  ('What''s a word you always misspell or mispronounce?', 'text', 'fun'),
  ('What''s something you Googled that you were embarrassed about?', 'text', 'fun'),
  ('What''s a rule you always break (minor ones only)?', 'text', 'fun'),
  ('What''s a conspiracy theory you almost believe?', 'text', 'fun'),
  ('What''s something you''re irrationally competitive about?', 'text', 'fun'),
  ('What''s a smell you secretly love that others might hate?', 'text', 'fun'),
  ('What''s a movie you''ve seen way too many times?', 'text', 'fun'),
  ('What''s the most random thing you have strong opinions about?', 'text', 'fun'),
  ('What''s something you thought would be easy but wasn''t?', 'text', 'fun'),

  -- Celebrity Questions (31-40)
  ('Who was your first celebrity crush?', 'text', 'fun'),
  ('Which celebrity did you like at one point but don''t anymore?', 'text', 'fun'),
  ('If a celebrity played you in a movie about your life, who would it be?', 'text', 'fun'),
  ('Which celebrity do you think would be surprisingly fun to hang out with?', 'text', 'fun'),
  ('Which celebrity do you think is overrated?', 'text', 'fun'),
  ('What celebrity moment lives rent-free in your head?', 'text', 'fun'),
  ('If you could trade lives with a celebrity for a week, who would you pick?', 'text', 'fun'),
  ('Which fictional character do you relate to the most?', 'text', 'fun'),
  ('Which celebrity do you irrationally trust?', 'text', 'fun'),
  ('If you had to be best friends with a famous villain, who would it be?', 'text', 'fun'),

  -- Hypotheticals (41-50)
  ('If you could instantly master one skill, what would it be?', 'text', 'fun'),
  ('If your life had a theme song, what would it be?', 'text', 'fun'),
  ('If you could relive one age forever, which would you pick?', 'text', 'fun'),
  ('If you opened a business tomorrow, what would it be?', 'text', 'fun'),
  ('If your friends described you with one word, what do you hope it is?', 'text', 'fun'),
  ('If you could ban one thing from existing, what would it be?', 'text', 'fun'),
  ('If you had to switch careers for a year, what would you choose?', 'text', 'fun'),
  ('If you were famous, what would you be famous for?', 'text', 'fun'),
  ('If you could time-travel but only once, would you go to the past or future?', 'text', 'fun'),
  ('If your personality were a movie genre, what would it be?', 'text', 'fun'),

  -- Would You Rather (51-60)
  ('Would you rather always be 10 minutes late or 20 minutes early?', 'text', 'fun'),
  ('Would you rather give up coffee or dessert?', 'text', 'fun'),
  ('Would you rather have amazing vacations or an amazing daily routine?', 'text', 'fun'),
  ('Would you rather be famous or extremely wealthy (but anonymous)?', 'text', 'fun'),
  ('Would you rather never have to sleep or never have to eat?', 'text', 'fun'),
  ('Would you rather relive your worst embarrassment or your biggest heartbreak?', 'text', 'fun'),
  ('Would you rather always know the truth or always be happy?', 'text', 'fun'),
  ('Would you rather lose your phone or your wallet?', 'text', 'fun'),
  ('Would you rather only watch movies or only watch TV shows forever?', 'text', 'fun'),
  ('Would you rather be great at starting things or finishing things?', 'text', 'fun'),

  -- Hot Takes / Opinions (61-70)
  ('What''s something everyone seems to love but you don''t?', 'text', 'fun'),
  ('What''s a hill you''re willing to die on (low-stakes only)?', 'text', 'fun'),
  ('What''s something you think should be illegal (for fun reasons)?', 'text', 'fun'),
  ('What''s a life lesson you learned the hard way?', 'text', 'fun'),
  ('What''s something that instantly makes someone more likable?', 'text', 'fun'),
  ('What''s something that instantly makes someone less likable?', 'text', 'fun'),
  ('What''s a social rule that confuses you?', 'text', 'fun'),
  ('What''s something you wish you learned earlier?', 'text', 'fun'),
  ('What''s a moment that made you feel very "adult"?', 'text', 'fun'),
  ('What''s something that feels like a scam but probably isn''t?', 'text', 'fun'),

  -- Positive / Grateful (71-80)
  ('What''s a memory that always makes you smile?', 'text', 'fun'),
  ('What''s something you''re looking forward to right now?', 'text', 'fun'),
  ('What''s a small luxury you really appreciate?', 'text', 'fun'),
  ('What''s something that makes you feel nostalgic?', 'text', 'fun'),
  ('What''s a random thing you''re grateful for?', 'text', 'fun'),
  ('What''s something you''d recommend everyone try once?', 'text', 'fun'),
  ('What''s something you used to hate but now enjoy?', 'text', 'fun'),
  ('What''s something you love doing alone?', 'text', 'fun'),
  ('What''s something that makes a day feel successful?', 'text', 'fun'),
  ('What''s something you''ll probably always enjoy, no matter your age?', 'text', 'fun'),

  -- Self-Reflection (81-90)
  ('What''s a personality trait you pretend you don''t have?', 'text', 'fun'),
  ('What''s the most "you" thing you''ve ever done?', 'text', 'fun'),
  ('What''s a fictional world you''d want to live in?', 'text', 'fun'),
  ('What''s something you take way too seriously?', 'text', 'fun'),
  ('What''s something you wish came with an instruction manual?', 'text', 'fun'),
  ('What''s a lie you told as a kid that went too far?', 'text', 'fun'),
  ('What''s something you irrationally avoid?', 'text', 'fun'),
  ('What''s a decision you''d make differently if you had a do-over?', 'text', 'fun'),
  ('What''s a moment you wish you could watch again?', 'text', 'fun'),
  ('What''s something you''d absolutely splurge on?', 'text', 'fun'),

  -- Final Mix (91-100)
  ('What''s your most controversial food opinion?', 'text', 'fun'),
  ('What''s a compliment you still remember?', 'text', 'fun'),
  ('What''s something you''re secretly good at?', 'text', 'fun'),
  ('What''s something you wish people asked you more often?', 'text', 'fun'),
  ('What''s something you''re still figuring out?', 'text', 'fun'),
  ('What''s a rule you think should exist but doesn''t?', 'text', 'fun'),
  ('What''s a belief you changed your mind about?', 'text', 'fun'),
  ('What''s something that makes you feel instantly relaxed?', 'text', 'fun'),
  ('What''s something that always sparks nostalgia for you?', 'text', 'fun'),
  ('What''s a question you love being asked?', 'text', 'fun');

-- Insert PHOTO prompts (5 total) for Fun mode
INSERT INTO prompts (text, prompt_type, mode) VALUES
  ('Take a photo of your surroundings.', 'photo', 'fun'),
  ('Take a selfie.', 'photo', 'fun'),
  ('Take a selfie with someone else (can be a pet).', 'photo', 'fun'),
  ('Take a photo of something random nearby.', 'photo', 'fun'),
  ('Take a photo that represents your current mood.', 'photo', 'fun');
