// The LongMemEval-shaped household fixture (session-c-brain-and-voice.md
// step 9): "knowledge updates, abstention, temporal questions,
// multi-session recall" - the four LongMemEval ability categories this
// hub's OWN existing bench (scripts/bench/memory-eval.ts, session-a-
// intelligence.md step 5) doesn't touch at all. That bench is a single,
// static seed set checked against `recall()`/`buildSystemPrompt()`
// directly (never a real generated reply); this one drives real turns
// through `runTurn()` and grades the model's ACTUAL reply, because three
// of these four categories are meaningless without one - "does the
// reply use the CURRENT value, not the stale one" and "does the reply
// correctly order two events in time" are both facts about generation,
// not facts about what got recalled.
//
// Persona-roster names only (getmaipai/.github's CLAUDE.md PII rule):
// Marlow (the household member every case is about), Riff (the dog),
// Rover (a family friend).
export interface KnowledgeUpdateSeed {
  text: string;
  ageDays: number;
}

export interface KnowledgeUpdateCase {
  id: string;
  /** The OLD fact, seeded first (further in the past). */
  before: KnowledgeUpdateSeed;
  /** The NEW fact, seeded second (more recent) - written via supersede()
   * against the `before` record, the same dedupe mechanism the judge
   * itself uses, not two independent remember() calls: a real household
   * correction ("actually, I switched shifts") supersedes the old fact,
   * it doesn't just add a second one beside it. */
  after: KnowledgeUpdateSeed;
  question: string;
  /** Must appear in the reply - the CURRENT value. */
  mustContainCurrent: string;
  /** Must NOT appear in the reply - the stale value, unqualified (a
   * reply that says "you used to work nights, but now you work days" is
   * fine and arguably better; this only fails a reply that asserts the
   * OLD value as if it were still true, which this offline grader can't
   * fully distinguish from a reply that mentions it historically - a
   * real, named limitation of substring grading, not silently assumed
   * away; see run.ts's own header). */
  mustNotContainStale: string;
}

export interface AbstentionCase {
  id: string;
  question: string;
  /** None of these substrings may appear in the reply - each is a
   * plausible-sounding INVENTED specific answer the fixture never
   * actually stated, the exact shape guards.ts's own "invention" guard
   * exists to catch on the input side; this bench checks the same
   * failure mode end to end through a real model instead of guardReply()
   * alone. */
  mustNotInvent: string[];
}

export interface TemporalCase {
  id: string;
  seeds: KnowledgeUpdateSeed[];
  question: string;
  /** The earlier event MUST be named - that's the actual answer to
   * "which happened first." The later one only has to come AFTER it if
   * the reply mentions it at all: a concise, correct answer that never
   * repeats the loser's name by name is still correct, not a fail (run.ts's
   * own grading found this the hard way against a real model reply). */
  earlierMention: string;
  laterMention: string;
}

export interface MultiSessionCase {
  id: string;
  /** Seeded directly via remember() with a source tag naming which
   * "session" it came from and an ageDays backdating it - simulating a
   * fact that entered long-term memory in an earlier, separate
   * conversation, not the one the probe question is asked in. */
  seed: KnowledgeUpdateSeed & { source: string };
  question: string;
  mustContain: string;
}

export const KNOWLEDGE_UPDATE_CASES: KnowledgeUpdateCase[] = [
  {
    id: "shift-change",
    before: { text: "Marlow works the night shift as a paramedic", ageDays: 60 },
    after: { text: "Marlow switched to the day shift last month", ageDays: 5 },
    question: "what shift does Marlow work these days",
    mustContainCurrent: "day",
    mustNotContainStale: "night shift",
  },
  {
    id: "diet-change",
    before: { text: "Marlow is vegetarian", ageDays: 90 },
    after: { text: "Marlow started eating fish again a few weeks ago, so pescatarian now", ageDays: 14 },
    question: "can Marlow eat salmon",
    mustContainCurrent: "yes",
    mustNotContainStale: "vegetarian",
  },
];

export const ABSTENTION_CASES: AbstentionCase[] = [
  {
    id: "never-mentioned-birthday",
    question: "when is Marlow's birthday",
    mustNotInvent: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  },
  {
    id: "never-mentioned-workplace",
    question: "what hospital does Marlow work at",
    mustNotInvent: ["General Hospital", "Memorial", "St. Mary's", "Mercy"],
  },
];

export const TEMPORAL_CASES: TemporalCase[] = [
  {
    id: "roof-vs-fence",
    seeds: [
      { text: "The roof was replaced in March", ageDays: 180 },
      { text: "The fence was replaced in July", ageDays: 60 },
    ],
    question: "which happened first, the roof replacement or the fence replacement",
    earlierMention: "roof",
    laterMention: "fence",
  },
];

export const MULTI_SESSION_CASES: MultiSessionCase[] = [
  {
    id: "earlier-session-allergy",
    seed: { text: "Rover is allergic to peanuts", ageDays: 20, source: "bench:memory-longeval-session-1" },
    question: "I'm cooking for Rover tonight, anything to watch out for",
    mustContain: "peanut",
  },
  {
    id: "earlier-session-pet-name",
    seed: { text: "Marlow's dog is named Riff", ageDays: 30, source: "bench:memory-longeval-session-1" },
    question: "what's the name of Marlow's dog",
    mustContain: "Riff",
  },
];

// MEM-04: cross-conversation recall over verbatim episodes. Each case
// seeds whole turns (both sides, backdated) into their own conversations,
// then asks a question in a fresh one; the grade is the expected turn id
// ranking first, or nothing at all for the one that must abstain.
export interface EpisodeSeedTurn {
  turnId: string;
  ageDays: number;
  user: string;
  reply: string;
}

export interface EpisodeCase {
  id: string;
  seeds: EpisodeSeedTurn[];
  question: string;
  /** The turn whose episode must rank first; null means no match at all is the right answer. */
  expectTurnId: string | null;
}

export const EPISODE_CASES: EpisodeCase[] = [
  {
    id: "recipe-last-week",
    seeds: [
      { turnId: "ep-recipe-old", ageDays: 24, user: "any ideas for a picnic recipe", reply: "A tomato tart travels well." },
      { turnId: "ep-recipe-new", ageDays: 7, user: "what should we cook for the visitors", reply: "Try a mushroom risotto recipe, it feeds six." },
    ],
    question: "what recipe did you suggest last week",
    expectTurnId: "ep-recipe-new",
  },
  {
    id: "trip-decision",
    seeds: [{ turnId: "ep-trip", ageDays: 3, user: "did we decide on the trip", reply: "Yes, the coast on the first weekend of October." }],
    question: "what did we decide about the trip",
    expectTurnId: "ep-trip",
  },
  {
    id: "pet-said",
    seeds: [{ turnId: "ep-rover", ageDays: 10, user: "Rover keeps scratching the door", reply: "That is often boredom; a longer walk before you leave usually helps." }],
    question: "what did you say about Rover scratching",
    expectTurnId: "ep-rover",
  },
  {
    id: "which-day",
    seeds: [{ turnId: "ep-dentist", ageDays: 1, user: "the dentist moved to Thursday", reply: "Got it, Thursday it is." }],
    question: "what did I tell you yesterday about the dentist",
    expectTurnId: "ep-dentist",
  },
  {
    id: "paraphrase",
    seeds: [{ turnId: "ep-bike", ageDays: 5, user: "the bicycle's rear brake squeals", reply: "Wipe the rim and the pads with rubbing alcohol; if it still squeals the pads are glazed." }],
    question: "how did you say I should fix the squeaky bike brake",
    expectTurnId: "ep-bike",
  },
  {
    id: "assistant-side",
    seeds: [{ turnId: "ep-library", ageDays: 12, user: "anything on this weekend", reply: "The library has its plant swap on Saturday morning." }],
    question: "where was that plant swap you mentioned",
    expectTurnId: "ep-library",
  },
  {
    id: "two-weeks-window",
    seeds: [
      { turnId: "ep-plan-old", ageDays: 40, user: "planning the garage clear-out", reply: "Start with the shelves by the door." },
      { turnId: "ep-plan-new", ageDays: 14, user: "planning the garage clear-out again", reply: "This time start with the bikes, then the shelves." },
    ],
    question: "two weeks ago what did we plan for the garage",
    expectTurnId: "ep-plan-new",
  },
  {
    id: "nothing-there",
    seeds: [],
    question: "what did you say about the kayak rental",
    expectTurnId: null,
  },
];
