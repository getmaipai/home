// The new-chat screen's starter chips (owner ruling 2026-10-06: do it like
// ChatGPT and Claude). GENERIC only, one fixed list for everyone: never drawn
// from memory, history, a profile or the current conversation, so it is the
// same in Incognito and for a child (docs/plans/privacy-mode-2026-09-24.md,
// BACKLOG INCOGNITO-10). A personalised chip would be a safety-path change.
export const STARTER_SUGGESTIONS = [
  { title: "Plan", label: "a week of simple dinners", prompt: "Help me plan a week of simple family dinners." },
  { title: "Explain", label: "how rainbows form", prompt: "Explain how rainbows form, in plain words." },
  { title: "Write", label: "a short thank-you note", prompt: "Help me write a short thank-you note." },
  { title: "Brainstorm", label: "a fun weekend idea", prompt: "Give me a few ideas for a fun weekend at home." },
] as const;
