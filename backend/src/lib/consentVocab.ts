// The consent and negative vocabularies, one definition: the pending
// ask's yes and no (turnEngine.ts's continuation), and the short-answer
// list the reply boundary (wellFormed.ts) accepts as a whole reply
// ("Yes.", "Done.", "Okay."). Kept out of turnEngine.ts so a reader with
// no store behind it can use them.
//
// CHAT-15: consent is the whole message, never a prefix ("no thanks"
// still opens with "no" and is a no). "Yes, but don't do it" opens with
// "yes" and is not consent; only consent words, as many as the person
// likes ("yeah, sure", "yes yes", "ok go ahead"), with at most a
// courtesy and terminal punctuation, run a consequential action.
// Anything else asks "yes or no?" once and runs nothing.
export const CONSENT_WORD = String.raw`(?:yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please do|confirm(?:ed)?|sure thing|go for it|do that|absolutely|of course|correct|right|affirmative|i'?m sure|i am sure|fine|alright)`;
export const AFFIRMATIVE_RE = new RegExp(String.raw`^\s*${CONSENT_WORD}(?:[,\s!.]+(?:${CONSENT_WORD}|please|thanks|thank you|and do it))*\s*[.!,]*\s*$`, "i");
export const NEGATIVE_RE = /^(no|nope|nah|cancel|never ?mind|don'?t|stop)\b/i;

/** The one-word replies the engine treats as complete on their own:
 * the consent and negative words above, and the closers a reply to a
 * command or a thank-you is made of. */
export const SHORT_ANSWERS: ReadonlySet<string> = new Set([
  "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "absolutely", "correct", "right", "fine", "alright",
  "no", "nope", "nah",
  "done", "noted", "thanks", "sorry", "hello", "hi", "hey", "bye", "goodbye", "goodnight", "welcome", "perfect", "great", "understood", "gotcha",
]);
