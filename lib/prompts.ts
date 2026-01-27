/**
 * Prompts Configuration & Validation
 *
 * This file contains the Fun mode prompts for reference
 * and a dev sanity check to verify prompt counts.
 */

// Fun mode text prompts - 100 total
export const FUN_PROMPTS = [
  // Embarrassing / Confidence Stories (1-10)
  "Tell us about a time you were way more confident than you should've been.",
  "Tell us about a time you misunderstood something for an embarrassingly long time.",
  "What's something you believed as a kid that now feels ridiculous?",
  "Tell us about a time you got lost but didn't want to admit it.",
  "What's a small decision that unexpectedly changed your day (or week)?",
  "Tell us about a time you laughed at the worst possible moment.",
  "What's a moment you thought would be a disaster but turned out fine?",
  "Tell us about a time you were convinced you were right… and weren't.",
  "What's the weirdest compliment you've ever received?",
  "Tell us about a time you tried to impress someone and failed.",

  // Self-Awareness / Quirks (11-20)
  "What's something you're oddly proud of?",
  "What's a habit you know is weird but fully accept?",
  "What's something you used to love that you totally outgrew?",
  "What's a personality trait you didn't realize you had until recently?",
  "What's something you pretend not to care about but secretly do?",
  "What's a skill you don't get to use very often?",
  "What's something you're surprisingly bad at?",
  "What's a random thing that instantly improves your mood?",
  "What's a food opinion you'll defend forever?",
  "What's a trend you're glad is over?",

  // Guilty Pleasures / Random Facts (21-30)
  "What's the dumbest way you've hurt yourself?",
  "What's a word you always misspell or mispronounce?",
  "What's something you Googled that you were embarrassed about?",
  "What's a rule you always break (minor ones only)?",
  "What's a conspiracy theory you almost believe?",
  "What's something you're irrationally competitive about?",
  "What's a smell you secretly love that others might hate?",
  "What's a movie you've seen way too many times?",
  "What's the most random thing you have strong opinions about?",
  "What's something you thought would be easy but wasn't?",

  // Celebrity Questions (31-40)
  "Who was your first celebrity crush?",
  "Which celebrity did you like at one point but don't anymore?",
  "If a celebrity played you in a movie about your life, who would it be?",
  "Which celebrity do you think would be surprisingly fun to hang out with?",
  "Which celebrity do you think is overrated?",
  "What celebrity moment lives rent-free in your head?",
  "If you could trade lives with a celebrity for a week, who would you pick?",
  "Which fictional character do you relate to the most?",
  "Which celebrity do you irrationally trust?",
  "If you had to be best friends with a famous villain, who would it be?",

  // Hypotheticals (41-50)
  "If you could instantly master one skill, what would it be?",
  "If your life had a theme song, what would it be?",
  "If you could relive one age forever, which would you pick?",
  "If you opened a business tomorrow, what would it be?",
  "If your friends described you with one word, what do you hope it is?",
  "If you could ban one thing from existing, what would it be?",
  "If you had to switch careers for a year, what would you choose?",
  "If you were famous, what would you be famous for?",
  "If you could time-travel but only once, would you go to the past or future?",
  "If your personality were a movie genre, what would it be?",

  // Would You Rather (51-60)
  "Would you rather always be 10 minutes late or 20 minutes early?",
  "Would you rather give up coffee or dessert?",
  "Would you rather have amazing vacations or an amazing daily routine?",
  "Would you rather be famous or extremely wealthy (but anonymous)?",
  "Would you rather never have to sleep or never have to eat?",
  "Would you rather relive your worst embarrassment or your biggest heartbreak?",
  "Would you rather always know the truth or always be happy?",
  "Would you rather lose your phone or your wallet?",
  "Would you rather only watch movies or only watch TV shows forever?",
  "Would you rather be great at starting things or finishing things?",

  // Hot Takes / Opinions (61-70)
  "What's something everyone seems to love but you don't?",
  "What's a hill you're willing to die on (low-stakes only)?",
  "What's something you think should be illegal (for fun reasons)?",
  "What's a life lesson you learned the hard way?",
  "What's something that instantly makes someone more likable?",
  "What's something that instantly makes someone less likable?",
  "What's a social rule that confuses you?",
  "What's something you wish you learned earlier?",
  "What's a moment that made you feel very 'adult'?",
  "What's something that feels like a scam but probably isn't?",

  // Positive / Grateful (71-80)
  "What's a memory that always makes you smile?",
  "What's something you're looking forward to right now?",
  "What's a small luxury you really appreciate?",
  "What's something that makes you feel nostalgic?",
  "What's a random thing you're grateful for?",
  "What's something you'd recommend everyone try once?",
  "What's something you used to hate but now enjoy?",
  "What's something you love doing alone?",
  "What's something that makes a day feel successful?",
  "What's something you'll probably always enjoy, no matter your age?",

  // Self-Reflection (81-90)
  "What's a personality trait you pretend you don't have?",
  "What's the most 'you' thing you've ever done?",
  "What's a fictional world you'd want to live in?",
  "What's something you take way too seriously?",
  "What's something you wish came with an instruction manual?",
  "What's a lie you told as a kid that went too far?",
  "What's something you irrationally avoid?",
  "What's a decision you'd make differently if you had a do-over?",
  "What's a moment you wish you could watch again?",
  "What's something you'd absolutely splurge on?",

  // Final Mix (91-100)
  "What's your most controversial food opinion?",
  "What's a compliment you still remember?",
  "What's something you're secretly good at?",
  "What's something you wish people asked you more often?",
  "What's something you're still figuring out?",
  "What's a rule you think should exist but doesn't?",
  "What's a belief you changed your mind about?",
  "What's something that makes you feel instantly relaxed?",
  "What's something that always sparks nostalgia for you?",
  "What's a question you love being asked?",
] as const

// Fun mode photo prompts - 5 total
export const FUN_PHOTO_PROMPTS = [
  "Take a photo of your surroundings.",
  "Take a selfie.",
  "Take a selfie with someone else (can be a pet).",
  "Take a photo of something random nearby.",
  "Take a photo that represents your current mood.",
] as const

// Dev sanity check - logs prompt counts in development
export function validatePromptCounts() {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Prompts] Fun mode text prompts: ${FUN_PROMPTS.length} (expected: 100)`)
    console.log(`[Prompts] Fun mode photo prompts: ${FUN_PHOTO_PROMPTS.length} (expected: 5)`)

    if (FUN_PROMPTS.length !== 100) {
      console.warn(`[Prompts] WARNING: Fun prompts count mismatch! Expected 100, got ${FUN_PROMPTS.length}`)
    }
    if (FUN_PHOTO_PROMPTS.length !== 5) {
      console.warn(`[Prompts] WARNING: Fun photo prompts count mismatch! Expected 5, got ${FUN_PHOTO_PROMPTS.length}`)
    }
  }
}

// Run validation on module load in dev
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  validatePromptCounts()
}
