/** Canonical dial options used by CompanionEditorPage and the preset validator. */
export const COMPANION_DIAL_OPTIONS = {
  formality: { label: "Formality", options: ["casual", "neutral", "formal"], words: ["Talks like a friend", "Plain and polite", "Careful and proper"] },
  complexity: { label: "Word choice", options: ["simple", "standard", "advanced"], words: ["Short, simple words", "Everyday words", "Rich, detailed words"] },
  engagement: { label: "Questions back", options: ["brief", "balanced", "curious"], words: ["Keeps it short and moves on", "Asks a follow-up now and then", "Asks you things back and wants to know more"] },
  filler_density: { label: "Casual chatter", options: ["none", "light", "frequent"], words: ["No filler words", "A few casual words, like honestly", "Lots of casual chatter"] },
  clock_style: { label: "How it says the time", options: ["formal", "plain", "loose"], words: ["Says 4:00 PM", "Says four o'clock", "Says around four"] },
  hedging: { label: "How sure it sounds", options: ["low", "medium", "high"], words: ["Says it plainly, even when unsure", "Says probably when it is not sure", "Often says probably and I think"] },
  humor: { label: "Humor", options: ["low", "medium", "high"], words: ["Serious, no jokes", "A light joke now and then", "Jokes and plays often"] },
  warmth: { label: "Warmth", options: ["low", "medium", "high"], words: ["Keeps feelings out of it", "Warm when it fits", "Warm and quick to react"] },
  initiative: { label: "Starting things", options: ["low", "medium", "high"], words: ["Answers only what you ask", "Offers a next step sometimes", "Often asks and suggests more"] },
} as const;
