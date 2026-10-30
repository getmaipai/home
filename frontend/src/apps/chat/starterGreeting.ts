// The new-chat screen's one line for the person, in place of "How can I help you today?": warm, a little playful, and never the same
// every time. A fixed pool picked in the browser (nothing is asked of a model, nothing leaves the home), so it is instant, the same in
// Incognito, and safe for a child. Every line is about the person, not about the assistant.
const ANYTIME = [
  "Ready when you are, {name}.",
  "What are we making today, {name}?",
  "Got a big idea or a small question, {name}?",
  "{name}, your next great idea is probably one question away.",
  "Bring me a puzzle, a plan, or a silly thought, {name}.",
  "Let's turn a maybe into a plan, {name}.",
  "Today's mission, {name}: be curious.",
  "I saved you a seat, {name}. Pull up a question.",
  "Tell me something fun, {name}.",
  "{name} plus a good question makes a very good day.",
  "Anything on your mind, {name}? Big, small, or weird: all welcome.",
  "Let's make today a little more interesting, {name}.",
  "{name}, what are you curious about right now?",
  "You bring the questions, {name}. I'll bring the answers.",
  "Something to figure out, {name}? I'm all ears. Well, no ears. All attention.",
  "Hello again, {name}. What shall we explore?",
  "Every good day starts with a question, {name}.",
  "Whatever it is, {name}, we can work it out together.",
  "{name}, the world is full of things to wonder about. Pick one.",
  "Psst, {name}. Ask me anything. I like a challenge.",
  "A fresh page and you, {name}. What happens next?",
  "Let's make something good today, {name}.",
  "You're here, {name}, so something good is about to happen.",
  "Think big, {name}. Start small. I'll keep up.",
] as const;

const BY_TIME = {
  morning: [
    "Good morning, {name}. What shall we start with?",
    "Morning, {name}. Fresh day, fresh questions.",
    "Rise and wonder, {name}.",
  ],
  afternoon: [
    "Good afternoon, {name}. What's next on the list?",
    "Hey {name}, how's the day treating you? Let's make it better.",
    "Afternoon, {name}. Time for a good question.",
  ],
  evening: [
    "Good evening, {name}. What's on your mind?",
    "Evening, {name}. Let's wind down with something interesting.",
    "Hey {name}, what's the best thing that happened today? Tell me, or ask me anything.",
  ],
  night: [
    "Still up, {name}? Let's use the quiet well.",
    "Night owl mode, {name}. What shall we dream up?",
  ],
} as const;

// For a person whose name is not known: the same warmth, written without it.
const NAMELESS = [
  "Ready when you are.",
  "What are we making today?",
  "What are you curious about right now?",
  "Got a big idea or a small question?",
  "Let's make something good today.",
  "Anything on your mind? Big, small, or weird: all welcome.",
] as const;

export type DayPart = keyof typeof BY_TIME;
export function dayPartOf(hour: number): DayPart {
  if (hour >= 22 || hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** The person's first name, from the name the household gave them ("Sage Rivera" reads as "Sage"). */
export function firstNameOf(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? "";
}

/** One line for this person. `pick` is a number in [0, 1) chosen once per new chat, so the line holds still while the screen is up and
 * changes the next time. A person with no name gets the same lines without it, never a blank or a stray comma. */
export function starterGreeting(displayName: string, hour: number, pick: number): string {
  const name = firstNameOf(displayName);
  const pool: readonly string[] = name ? [...ANYTIME, ...BY_TIME[dayPartOf(hour)]] : NAMELESS;
  const line = pool[Math.min(pool.length - 1, Math.floor(pick * pool.length))]!;
  return line.replaceAll("{name}", name);
}

export const GREETING_POOL_FOR_TESTS = { ANYTIME, BY_TIME, NAMELESS };
