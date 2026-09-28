// STYLE-CORPUS-01 (docs/BACKLOG.md; design in docs/dev.md "EVAL-03 design
// pass: a companion's voice is a per-companion style adapter..."): the
// content-preserving voice corpus, one JSONL per bundled companion
// (default, buddy, pal, tutor). Development-only, EVAL-05's own "never
// runs in a household turn" pattern - a developer runs this by hand,
// once or on demand, to produce STYLE-TRAIN-01's own training data.
// Never imported by any runtime code.
//
// Pipeline, per companion:
//   1. About 400 typed and 200 spoken prompts, generated from templates
//      seeded by written-set.ts's five kinds, spec/llm/naturalness-
//      corpus.json's categories, and owner-replay.json's own already
//      household-free rows (that file's own header: "No household
//      member is named in any row"). written-set.ts's WRITTEN_QUESTIONS
//      (22 rows, imported directly - now exported there for exactly
//      this) and steering-spike.ts's thirty EXCHANGES (reproduced
//      literally below, see STEERING_SPIKE_EXCHANGES's own comment) are
//      held out of every corpus: those rows are STYLE-BENCH-01's own
//      bench, never trained on.
//   2. The neutral reply: the bare local model at 127.0.0.1:8788, the
//      companion's own identityLine() as the only system content,
//      thinking off, CHAT_SAMPLING (llm.ts's complete() applies it
//      automatically whenever no temperature is given).
//   3. The rewrite: a frontier model, given the companion's manifest
//      fields (display_name, tagline, backstory, interests, the four
//      dials in words, examples verbatim as few-shot) and the fixed
//      REWRITE_BRIEF below - kept byte-identical to docs/dev.md's
//      "STYLE-CORPUS-01: the rewrite brief, verbatim" section by hand.
//   4. The deterministic validator: length within 15%, identical
//      digit-run multiset, identical capitalized-token multiset (after
//      each sentence's first word), headings/lists preserved, no
//      forbidden phrase. A failing pair is dropped and counted; a
//      per-companion drop rate at or above 20% is a finding about the
//      brief or the corpus, never a reason to relax the checks.
//   5. Fifty rows built from tool-calling.ts's own positive fixtures
//      (reproduced literally below, see TOOL_SOURCE_ROWS's own comment),
//      run once against the live engine and frozen byte-identical into
//      every companion's corpus, teaching the adapter that a tool call
//      is never a voice.
//
// Usage, from backend/: bun run scripts/voice/corpus.ts
//
// Talks directly to the household's real chat/embed engines at
// 127.0.0.1:8788/127.0.0.1:8794 (liveHubQuiet.ts's own protocol -
// refuseIfGateRunning, one request at a time, a 30s quiet wait after any
// real household turn) because the backlog names that engine explicitly;
// every other bench in this directory uses a side instance instead.
//
// Needs an Anthropic API key already resolvable the way the `claude-api`
// skill resolves one (ANTHROPIC_API_KEY, or an `ant auth login` profile)
// - this script never reads one from a project file, and refuses with a
// clear message (never a 100%-drop-rate lie) when no credential
// resolves. Synthetic content only ever leaves the machine for the
// rewrite call: every prompt here is generated from a topic word bank or
// drawn from owner-replay.json's own already household-free rows, so
// nothing about the real household reaches the frontier API.
//
// Output: data-scratch/voice/<companion>/corpus.jsonl (git-ignored, the
// full run) and a committed 20-row sample per companion under
// backend/scripts/voice/fixtures/<companion>.sample.jsonl (the builder's
// own tests read the samples, and the sha256 in the manifest entry
// STYLE-SPEC-01 declares is the FULL corpus file's, printed at the end
// of each companion's run).
//
// MAIPAI_VOICE_TYPED_COUNT / MAIPAI_VOICE_SPOKEN_COUNT /
// MAIPAI_VOICE_TOOL_COUNT override the default ~400/~200/50 row counts -
// a prefix of the identical deterministic generator, never a different
// one - for a smaller real validation run. Never set as a standing
// default; an operator sets them per invocation.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { HONESTY_LINES, EMPTY_PROMISE_LINES } from "../bench/conversationFixture";
import { WRITTEN_QUESTIONS } from "../bench/written-set";
import { refuseIfGateRunning, waitForHubQuiet } from "../bench/liveHubQuiet";
import { SPEC_DIR } from "@/lib/specDir";
import type { Persona } from "@/lib/persona";
import type { ToolSpec } from "@/lib/llm";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const FIXTURES_DIR = join(import.meta.dir, "fixtures");

const COMPANIONS = ["default", "buddy", "pal", "tutor"] as const;

const TYPED_COUNT = Number(process.env.MAIPAI_VOICE_TYPED_COUNT ?? 400);
const SPOKEN_COUNT = Number(process.env.MAIPAI_VOICE_SPOKEN_COUNT ?? 200);
const TOOL_COUNT = Number(process.env.MAIPAI_VOICE_TOOL_COUNT ?? 50);

// ── Held-out sets (STYLE-BENCH-01's own rows, never trained on) ───────

// steering-spike.ts has no `import.meta.main` guard and refuses to even
// load (process.exit(1)) without MAIPAI_LLAMA_SERVER_URL plus a
// --label argument this script never passes, so importing it directly
// is unsafe. Its thirty EXCHANGES, reproduced verbatim; kept in sync by
// hand (a code review catches drift the same way it would for any other
// literal duplication of a held-out set).
const STEERING_SPIKE_EXCHANGES: readonly string[] = [
  "hi there!",
  "what's the weather like today?",
  "can you help me with something?",
  "I'm not sure what to do about this",
  "thanks for the help",
  "what do you think about that?",
  "tell me something interesting",
  "I had a rough day today",
  "what's 2 plus 2?",
  "goodnight",
  "hey, you around?",
  "is it gonna rain later?",
  "can you give me a hand with this?",
  "I don't really know what to do here",
  "appreciate it",
  "what's your take on that?",
  "say something interesting",
  "today was kind of a rough one",
  "what's 5 plus 5?",
  "alright, goodnight",
  "yo",
  "how's the weather looking?",
  "could you help me out?",
  "still not sure what to do about it",
  "thanks a lot",
  "what do you make of that?",
  "got anything interesting to share?",
  "man, today was rough",
  "what's 10 plus 10?",
  "okay, night",
];

export const EXCLUDED_TEXTS = new Set<string>([...WRITTEN_QUESTIONS.map((q) => q.say.toLowerCase()), ...STEERING_SPIKE_EXCHANGES.map((s) => s.toLowerCase())]);

// ── The fixed rewrite brief (verbatim, dev.md keeps the same text) ────

const REWRITE_BRIEF = [
  "Rewrite the reply below into this speaker's own voice.",
  "Keep every fact, number, name, date and list item exactly as given, in the same order.",
  "Keep the same structure: if the original has headings or a list, the rewrite keeps them; if it does not, the rewrite does not add them.",
  "Keep the length within 15 percent of the original.",
  "Change only the voice: word choice, sentence rhythm, contractions, and the personality below.",
  "Never add a fact the original did not state, never drop one, and never soften or hedge a fact the original stated flatly.",
  "Reply with the rewritten text only: no preamble, no quotation marks around it, no explanation.",
].join(" ");

const FORMALITY_WORDS: Record<Persona["formality"], string> = {
  casual: "casual: contractions, relaxed phrasing, talks like a friend",
  neutral: "neutral: plain, straightforward phrasing, no particular formality",
  formal: "formal: no contractions, precise and complete phrasing",
};
const COMPLEXITY_WORDS: Record<Persona["complexity"], string> = {
  simple: "simple: short sentences, everyday words, nothing technical",
  standard: "standard: ordinary adult vocabulary, no unnecessary jargon",
  advanced: "advanced: precise vocabulary, willing to use the right technical term",
};
const ENGAGEMENT_WORDS: Record<Persona["engagement"], string> = {
  brief: "brief: gets to the point, no follow-up question",
  balanced: "balanced: a full answer, sometimes a follow-up question",
  curious: "curious: engaged, often asks a follow-up question or invites more",
};
const FILLER_WORDS: Record<Persona["filler_density"], string> = {
  none: 'none: no casual discourse markers ("honestly", "I mean", "like")',
  light: "light: an occasional casual discourse marker",
  frequent: "frequent: casual discourse markers often, the way this speaker actually talks",
};

interface CompanionFields {
  display_name: string;
  tagline?: string;
  backstory?: string;
  interests?: readonly string[];
  examples?: readonly string[];
  formality: Persona["formality"];
  complexity: Persona["complexity"];
  engagement: Persona["engagement"];
  filler_density: Persona["filler_density"];
}

function buildRewriteSystem(c: CompanionFields): string {
  const parts = [
    `You are rewriting a reply into ${c.display_name}'s own voice.`,
    c.tagline ? `${c.display_name}: ${c.tagline}` : "",
    c.backstory ?? "",
    c.interests && c.interests.length > 0 ? `${c.display_name} cares about: ${c.interests.join(", ")}.` : "",
    [
      `Formality is ${FORMALITY_WORDS[c.formality]}.`,
      `Complexity is ${COMPLEXITY_WORDS[c.complexity]}.`,
      `Engagement is ${ENGAGEMENT_WORDS[c.engagement]}.`,
      `Filler density is ${FILLER_WORDS[c.filler_density]}.`,
    ].join(" "),
    c.examples && c.examples.length > 0 ? `How ${c.display_name} talks, verbatim:\n${c.examples.map((e) => `- ${e}`).join("\n")}` : "",
    REWRITE_BRIEF,
  ];
  return parts.filter((p) => p.length > 0).join("\n\n");
}

// ── The deterministic validator ────────────────────────────────────────

const WORD_RE = /[A-Za-z0-9']+/g;
export function wordCount(s: string): number {
  return (s.match(WORD_RE) ?? []).length;
}

export function lengthWithinBand(neutral: string, rewrite: string, band = 0.15): boolean {
  const n = wordCount(neutral);
  const r = wordCount(rewrite);
  if (n === 0) return r === 0;
  return Math.abs(r - n) / n <= band;
}

export function digitRuns(s: string): string[] {
  return (s.match(/\d+/g) ?? []).slice().sort();
}
export function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Capitalized tokens after the first word of each sentence - sentence-
// initial capitalization is just English orthography, not a fact the
// rewrite could drop or invent, so it is excluded on both sides.
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;
export function capitalizedTokensAfterSentenceStart(s: string): string[] {
  const out: string[] = [];
  for (const sentence of s.split(SENTENCE_SPLIT_RE)) {
    const words = sentence.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
    for (let i = 1; i < words.length; i++) {
      const w = words[i]!;
      if (/^[A-Z]/.test(w)) out.push(w);
    }
  }
  return out.sort();
}

const HEADING_RE = /^#{1,6}\s/m;
const LIST_RE = /^\s*([-*]|\d+\.)\s/m;

// The persona bench's own "never say this" list: STUCK_LINES mirrors
// replay.ts's literal string (that file has no export for it), and
// HONESTY_LINES/EMPTY_PROMISE_LINES are imported from
// conversationFixture.ts, the one place this codebase already declares
// them. A voice rewrite that introduces any of these is a real quality
// regression, not a style choice, so the check is unconditional (never
// contingent on whether the neutral reply already had it).
const STUCK_LINES = "keep landing on the same answer|going in circles|stuck on that one";
const FORBIDDEN_RE = new RegExp(`${STUCK_LINES}|${HONESTY_LINES}|${EMPTY_PROMISE_LINES}`, "i");

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

// A code review (2026-09-28) caught this checking only one direction
// (a heading/list present on the neutral reply must survive) - the
// REWRITE_BRIEF above also promises the frontier model never ADDS
// structure the neutral reply didn't have ("if it does not, the
// rewrite does not add them"), so both directions are checked now.
export function validatePair(neutral: string, rewrite: string): ValidationResult {
  if (!lengthWithinBand(neutral, rewrite)) return { ok: false, reason: "length band" };
  if (!sameMultiset(digitRuns(neutral), digitRuns(rewrite))) return { ok: false, reason: "digit-run set" };
  if (!sameMultiset(capitalizedTokensAfterSentenceStart(neutral), capitalizedTokensAfterSentenceStart(rewrite))) return { ok: false, reason: "capitalized-token set" };
  if (HEADING_RE.test(neutral) !== HEADING_RE.test(rewrite)) return { ok: false, reason: "heading presence changed" };
  if (LIST_RE.test(neutral) !== LIST_RE.test(rewrite)) return { ok: false, reason: "list marker presence changed" };
  if (FORBIDDEN_RE.test(rewrite)) return { ok: false, reason: "forbidden phrase" };
  return { ok: true };
}

// ── The prompt list: templated, deterministic, roster/documentation-
// range safe only (no real names or facts are ever needed - substance
// fidelity is checked against the LOCAL MODEL'S OWN bare reply, never
// against a real-world answer key) ────────────────────────────────────

interface PromptSpec {
  id: string;
  cls: "typed" | "spoken";
  kind: string;
  text: string;
}

const FACT_TOPICS: readonly string[] = [
  "the human heart", "the Pacific Ocean", "volcanoes", "the speed of light", "Mount Everest",
  "the Great Wall of China", "the human eye", "spiders", "the Sahara desert", "glaciers",
  "the periodic table", "black holes", "coral reefs", "the Amazon rainforest", "tornadoes",
  "the stock market", "the internet", "electric cars", "the immune system", "the moon",
];
const FACT_TEMPLATES: readonly ((t: string) => string)[] = [
  (t) => `what's ${t} known for`,
  (t) => `how does ${t} actually work`,
  (t) => `why does ${t} matter`,
  (t) => `what's one surprising thing about ${t}`,
];

const HOWTO_TOPICS: readonly string[] = [
  "fold a fitted sheet", "jump-start a car battery", "tie a bow tie", "get a stain out of a carpet", "make a paper airplane",
  "boil an egg perfectly", "change a bike tire", "pack for a weekend trip", "write a cover letter", "back up a phone",
  "clean a cast iron pan", "tie a necktie", "parallel park", "start a compost bin", "fix a leaky faucet",
  "set up a tent", "brew pour-over coffee", "organize a closet", "plan a road trip", "learn a new language",
];
const HOWTO_TEMPLATES: readonly ((t: string) => string)[] = [
  (t) => `how do I ${t}`,
  (t) => `what's the easiest way to ${t}`,
  (t) => `what do I need to ${t}`,
  (t) => `what's a common mistake people make when they try to ${t}`,
];

const COMPARISON_PAIRS: readonly (readonly [string, string])[] = [
  ["a crocodile", "an alligator"], ["baking soda", "baking powder"], ["a hurricane", "a typhoon"], ["a virus", "a bacteria"], ["rent", "a lease"],
  ["a violin", "a viola"], ["tea", "coffee"], ["a novel", "a novella"], ["a lake", "a pond"], ["a sedan", "a hatchback"],
  ["yoga", "pilates"], ["a resume", "a CV"], ["a smoothie", "a milkshake"], ["a hurricane", "a tropical storm"], ["a crocodile", "a caiman"],
  ["whiskey", "bourbon"], ["a comet", "an asteroid"], ["a podcast", "a radio show"], ["a marathon", "an ultramarathon"], ["a duvet", "a comforter"],
];
const COMPARISON_TEMPLATES: readonly ((a: string, b: string) => string)[] = [
  (a, b) => `what's the difference between ${a} and ${b}`,
  (a, b) => `is ${a} basically the same thing as ${b}`,
  (a, b) => `why do people mix up ${a} and ${b}`,
  (a, b) => `which is better, ${a} or ${b}`,
];

const LIST_TOPICS: readonly string[] = [
  "a weekend camping trip", "a beginner's toolbox", "a home first aid kit", "a college dorm room", "a road trip",
  "a small vegetable garden", "a work-from-home setup", "a kid's birthday party", "a rainy day at home", "a job interview",
  "a new apartment", "a hiking day trip", "a picnic", "a study session", "a long flight",
  "a first camping trip with kids", "a home office", "a ski trip", "a beach day", "moving into a new place",
];
const LIST_TEMPLATES: readonly ((t: string) => string)[] = [
  (t) => `what should I pack for ${t}`,
  (t) => `what are some good things to have on hand for ${t}`,
  (t) => `what do most people forget when planning ${t}`,
  (t) => `what are the basics I'd need for ${t}`,
];

const SMALL_TALK_BASE: readonly string[] = [
  "hey", "hi there", "hello", "yo", "good morning", "good afternoon", "good evening", "how's it going", "what's up", "how are you doing",
  "long time no talk", "hiya", "morning", "evening", "hey there", "what's new", "how's your day going", "how have you been", "hey, you there", "good to see you",
];
const SMALL_TALK_TAGS: readonly string[] = ["", " how's your week been", " anything new going on with you", " hope you're doing okay today"];

/** Round-robins across several lists instead of concatenating them, so
 * a caller that only takes a prefix (buildPromptList's own `.slice(0,
 * TYPED_COUNT/SPOKEN_COUNT)`, exactly what a reduced real validation
 * run does) still draws from every source instead of exhausting the
 * first one before ever reaching the rest. A code review (2026-09-28)
 * caught a reduced MAIPAI_VOICE_TYPED_COUNT run silently drawing
 * entirely from owner-replay.json and never reaching the five
 * templated kinds, because they were simple concatenated then sliced. */
export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const max = lists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let i = 0; i < max; i++) {
    for (const list of lists) if (i < list.length) out.push(list[i]!);
  }
  return out;
}

function buildFact(): PromptSpec[] {
  const out: PromptSpec[] = [];
  for (const [ti, tmpl] of FACT_TEMPLATES.entries()) for (const [wi, topic] of FACT_TOPICS.entries()) out.push({ id: `typed-fact-${ti}-${wi}`, cls: "typed", kind: "fact", text: tmpl(topic) });
  return out;
}
function buildHowTo(): PromptSpec[] {
  const out: PromptSpec[] = [];
  for (const [ti, tmpl] of HOWTO_TEMPLATES.entries()) for (const [wi, topic] of HOWTO_TOPICS.entries()) out.push({ id: `typed-howto-${ti}-${wi}`, cls: "typed", kind: "how-to", text: tmpl(topic) });
  return out;
}
function buildComparison(): PromptSpec[] {
  const out: PromptSpec[] = [];
  for (const [ti, tmpl] of COMPARISON_TEMPLATES.entries()) for (const [wi, [a, b]] of COMPARISON_PAIRS.entries()) out.push({ id: `typed-comparison-${ti}-${wi}`, cls: "typed", kind: "comparison", text: tmpl(a, b) });
  return out;
}
function buildList(): PromptSpec[] {
  const out: PromptSpec[] = [];
  for (const [ti, tmpl] of LIST_TEMPLATES.entries()) for (const [wi, topic] of LIST_TOPICS.entries()) out.push({ id: `typed-list-${ti}-${wi}`, cls: "typed", kind: "list", text: tmpl(topic) });
  return out;
}
function buildSmallTalk(): PromptSpec[] {
  const out: PromptSpec[] = [];
  let i = 0;
  for (const base of SMALL_TALK_BASE) for (const tag of SMALL_TALK_TAGS) out.push({ id: `typed-small-talk-${i++}`, cls: "typed", kind: "small-talk", text: `${base}${tag}`.trim() });
  return out;
}

/** owner-replay.json's own household-free rows (its own header: "No
 * household member is named in any row"), one prompt per turn, flattened
 * out of their multi-turn conversations - a real, already-reviewed
 * source distinct from every templated bank above. */
function buildFromOwnerReplay(): PromptSpec[] {
  const path = join(import.meta.dir, "..", "bench", "datasets", "owner-replay.json");
  const raw = JSON.parse(readFileSync(path, "utf-8")) as { failed: { id: string; turns: { say: string }[] }[]; control: { id: string; turns: { say: string }[] }[] };
  const out: PromptSpec[] = [];
  for (const row of [...raw.failed, ...raw.control]) {
    row.turns.forEach((turn, i) => out.push({ id: `typed-replay-${row.id}-${i}`, cls: "typed", kind: "replay", text: turn.say }));
  }
  return out;
}

const SPOKEN_TOPICS: readonly string[] = [
  "the game last night", "dinner plans", "the weather today", "the new show", "homework",
  "the weekend", "the road trip", "the new phone", "that book", "the traffic this morning",
  "the recipe", "the workout routine", "the haircut", "laundry day", "the doctor's appointment",
  "the neighbor's dog", "the concert", "gas prices", "the job interview", "spring cleaning",
];
const SPOKEN_CATEGORIES: readonly { kind: string; templates: readonly ((t: string) => string)[] }[] = [
  { kind: "brevity", templates: [(t) => `what time does ${t} start`, (t) => `is ${t} done yet`, (t) => `what's the deal with ${t}`, (t) => `how long is ${t} gonna take`] },
  { kind: "precision", templates: [(t) => `how much did ${t} end up costing`, (t) => `how much is ${t} usually`, (t) => `what's ${t} gonna run me`, (t) => `roughly how much for ${t}`] },
  { kind: "evidentials", templates: [(t) => `is ${t} gonna happen tomorrow`, (t) => `what's ${t} supposed to be like`, (t) => `any idea how ${t} turns out`, (t) => `think ${t} will go okay`] },
  { kind: "correction", templates: [(t) => `I thought ${t} was tomorrow, not today`, (t) => `pretty sure ${t} got cancelled, right`, (t) => `wait, isn't ${t} next week`, (t) => `I heard ${t} got moved, is that right`] },
  { kind: "acknowledgment", templates: [(t) => `cool, thanks for the heads up on ${t}`, (t) => `got it, appreciate you telling me about ${t}`, (t) => `okay, noted on ${t}`, (t) => `sounds good on ${t}, thanks`] },
  { kind: "uncertainty", templates: [(t) => `any idea why ${t} is such a mess right now`, (t) => `why's ${t} always so complicated`, (t) => `what's actually going on with ${t}`, (t) => `how come nobody tells me about ${t} ahead of time`] },
  { kind: "case", templates: [(t) => `hey, what's the story with ${t}`, (t) => `so what's happening with ${t}`, (t) => `quick one, what's up with ${t}`, (t) => `real quick, any news on ${t}`] },
];

/** spec/llm/naturalness-corpus.json's own seven categories give this its
 * shape (brevity, precision, evidentials, correction, acknowledgment,
 * uncertainty, case - that file's own `category` field), expanded here
 * with a topic bank rather than reused verbatim: the corpus's own ten
 * rows are fixtures a different bench (naturalness.ts) already scores
 * against, not a prompt list to duplicate. */
function buildSpokenCategoryRows(cat: (typeof SPOKEN_CATEGORIES)[number], ci: number): PromptSpec[] {
  const out: PromptSpec[] = [];
  cat.templates.forEach((tmpl, ti) => {
    for (let k = 0; k < 7; k++) {
      const topic = SPOKEN_TOPICS[(ci * 7 + k) % SPOKEN_TOPICS.length]!;
      out.push({ id: `spoken-${cat.kind}-${ti}-${k}`, cls: "spoken", kind: cat.kind, text: tmpl(topic) });
    }
  });
  return out;
}
function buildSpokenCategories(): PromptSpec[] {
  // Interleaved by category (see interleave()'s own comment): the full
  // count is unchanged, only the order, so a `.slice(0, SPOKEN_COUNT)`
  // draws from all seven categories instead of running out of
  // "brevity" rows before ever reaching "case".
  return interleave(SPOKEN_CATEGORIES.map((cat, ci) => buildSpokenCategoryRows(cat, ci)));
}

export function buildPromptList(): { typed: PromptSpec[]; spoken: PromptSpec[] } {
  const typedPool = interleave([buildFromOwnerReplay(), buildFact(), buildHowTo(), buildComparison(), buildList(), buildSmallTalk()]);
  const spokenPool = buildSpokenCategories();
  const typed = typedPool.filter((p) => !EXCLUDED_TEXTS.has(p.text.toLowerCase())).slice(0, TYPED_COUNT);
  const spoken = spokenPool.filter((p) => !EXCLUDED_TEXTS.has(p.text.toLowerCase())).slice(0, SPOKEN_COUNT);
  return { typed, spoken };
}

// ── Tool rows: fifty of tool-calling.ts's own positive fixtures, run
// once and frozen byte-identical into every companion's corpus ────────

interface ToolSourceRow {
  id: string;
  utterance: string;
  expect_calls: readonly string[];
}

// tool-calling.ts has no `import.meta.main` guard - it runs its whole
// bench (a real, billed sequence of live completions) unconditionally
// on import, so importing it here is unsafe. Its two small hand-written
// row sets, reproduced literally (kept in sync by hand, same as
// STEERING_SPIKE_EXCHANGES above); WRITE_DOCUMENT_ROWS is left out on
// purpose - write_document is not in modelCatalog.ts's shipped
// tools_offered today (that file's own comment: its row "reads
// 0/REPEATS on every run until that follow-up lands"), so it would
// never produce a real native tool call to freeze.
const ROUTE01_ROWS: readonly ToolSourceRow[] = [
  { id: "route01-0", utterance: "the plumber's number is 555 9876 extension 12, please remember it", expect_calls: ["remember"] },
  { id: "route01-1", utterance: "Friday is pizza night, please remember", expect_calls: ["remember"] },
];
const INVERSE_MISS_ROWS: readonly ToolSourceRow[] = [
  { id: "inverse-0", utterance: "who is the president of chile", expect_calls: ["websearch"] },
  { id: "inverse-1", utterance: "did chatgpt 6 luna come out", expect_calls: ["websearch"] },
  { id: "inverse-2", utterance: "what did Apple announce this week", expect_calls: ["websearch"] },
  { id: "inverse-3", utterance: "who won the Seattle Mariners game yesterday", expect_calls: ["websearch"] },
  { id: "inverse-4", utterance: "is the new iPhone out yet", expect_calls: ["websearch"] },
];

function loadToolCorpusPositiveRows(): ToolSourceRow[] {
  const raw = JSON.parse(readFileSync(join(SPEC_DIR, "llm", "tool-call-corpus.json"), "utf-8")) as { utterance: string; expect_calls: string[] }[];
  return raw.filter((r) => r.expect_calls.length > 0).map((r, i) => ({ id: `corpus-${i}`, ...r }));
}

const TOOL_SPEC_IDS = ["remember", "recall", "define", "trivia", "math", "convert", "almanac-time", "almanac-date", "websearch"] as const;

/** One JSON object per line, a trailing newline only when there's at
 * least one row - the exact shape both the full corpus file and its
 * 20-row committed sample write, in one place so the two can never
 * drift on the serialization (a code review, 2026-09-28). */
export function toJsonl(rows: readonly Record<string, unknown>[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : "");
}

/** Thrown when no Anthropic credential resolves - caught once at the
 * very top of main() (never at the call site) so the isolated data
 * directory this script creates is always cleaned up before the
 * process exits, whichever companion or row the credential first
 * failed on (a code review, 2026-09-28: `process.exit(2)` called from
 * inside the per-row loop skipped the cleanup at the end of main()). */
class MissingCredentialError extends Error {}

// ── main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  refuseIfGateRunning("voice-corpus");

  const anthropic = new Anthropic();

  const upstream = process.env.MAIPAI_LLAMA_SERVER_URL ?? "http://127.0.0.1:8788";
  process.env.MAIPAI_LLAMA_SERVER_URL = upstream;
  if (!process.env.MAIPAI_EMBED_URL) process.env.MAIPAI_EMBED_URL = "http://127.0.0.1:8794";
  const ownDataDir = mkdtempSync(join(tmpdir(), "voice-corpus-"));
  process.env.MAIPAI_DATA_DIR = ownDataDir;

  const waitForQuiet = () => waitForHubQuiet(undefined, (msg) => console.log(msg.replace("live-hub-quiet", "voice-corpus")));

  console.log(`[voice-corpus] chat=${upstream} embed=${process.env.MAIPAI_EMBED_URL} data=${ownDataDir}`);
  try {
    await run(anthropic, waitForQuiet);
  } finally {
    rmSync(ownDataDir, { recursive: true, force: true });
  }
}

async function run(anthropic: Anthropic, waitForQuiet: () => Promise<void>): Promise<void> {

  // CHAT-22: setup.ts must be imported (and awaited) before anything
  // that reaches "@/db" - persona.ts, plugins.ts, turnEngine.ts and
  // llm.ts all transitively do, through @/lib/access and @/lib/settings.
  const setup = await import("../bench/setup");
  await setup.startBench();

  const { complete } = await import("@/lib/llm");
  const { loadManifestOnly } = await import("@/lib/plugins");
  const { PERSONAS } = await import("@/lib/persona");
  const { identityLine } = await import("@/lib/turnEngine");
  const { visibleText } = await import("@/lib/wellFormed");

  const toolSpecs: ToolSpec[] = TOOL_SPEC_IDS.map((id) => {
    const loaded = loadManifestOnly(id);
    if (!loaded.ok) throw new Error(`bundled package ${id} failed to load: ${loaded.error}`);
    return { id, description: loaded.value.description, args: loaded.value.args };
  });
  const toolSourceRows = [...loadToolCorpusPositiveRows(), ...ROUTE01_ROWS, ...INVERSE_MISS_ROWS];

  console.log(`[voice-corpus] collecting ${TOOL_COUNT} tool rows from ${toolSourceRows.length} source fixtures (shared, frozen across every companion)...`);
  const toolRows: { id: string; utterance: string; replyText: string; toolCalls: { tool: string; args: unknown }[] }[] = [];
  {
    let attempts = 0;
    const maxAttempts = TOOL_COUNT * 8;
    let i = 0;
    while (toolRows.length < TOOL_COUNT && attempts < maxAttempts && toolSourceRows.length > 0) {
      const row = toolSourceRows[i % toolSourceRows.length]!;
      i++;
      attempts++;
      await waitForQuiet();
      const result = await complete("chat", [{ role: "user", content: row.utterance }], { thinking: false, tools: toolSpecs, tool_choice: "auto" });
      if (!result.ok) continue;
      const calls = result.value.tool_calls ?? [];
      const gotIds = calls.map((c) => c.tool).sort();
      const wantIds = [...row.expect_calls].sort();
      if (JSON.stringify(gotIds) !== JSON.stringify(wantIds)) continue;
      toolRows.push({ id: `tool-${toolRows.length}`, utterance: row.utterance, replyText: visibleText(result.value.text), toolCalls: calls.map((c) => ({ tool: c.tool, args: c.args })) });
    }
    if (toolRows.length < TOOL_COUNT) console.error(`[voice-corpus] only collected ${toolRows.length}/${TOOL_COUNT} tool rows after ${attempts} attempts (the real, honest count - never padded)`);
    else console.log(`[voice-corpus] collected ${toolRows.length} tool rows in ${attempts} attempts.`);
  }

  const { typed, spoken } = buildPromptList();
  console.log(`[voice-corpus] prompt list: ${typed.length} typed, ${spoken.length} spoken (${STEERING_SPIKE_EXCHANGES.length + WRITTEN_QUESTIONS.length} held-out rows excluded by text).`);
  // A code review (2026-09-28): buildSpokenCategories() can only ever
  // produce 196 rows (7 categories x 4 templates x 7 topics), one short
  // of SPOKEN_COUNT's default 200 - said out loud rather than silently
  // returning fewer than asked for, the same honesty the tool-row
  // collector's own short-count line already has below.
  if (typed.length < TYPED_COUNT) console.log(`[voice-corpus] typed pool has only ${typed.length} rows after held-out exclusion, short of the requested ${TYPED_COUNT}.`);
  if (spoken.length < SPOKEN_COUNT) console.log(`[voice-corpus] spoken pool has only ${spoken.length} rows after held-out exclusion, short of the requested ${SPOKEN_COUNT}.`);

  const summary: { companion: string; kept: number; dropped: number; dropRate: number; sha256: string }[] = [];

  for (const companionId of COMPANIONS) {
    const persona = PERSONAS.find((p: Persona) => p.id === companionId);
    const manifest = loadManifestOnly(companionId);
    if (!persona || !manifest.ok || !manifest.value.companion) throw new Error(`bundled companion ${companionId} failed to load`);
    const c = manifest.value.companion;
    const rewriteSystem = buildRewriteSystem({
      display_name: c.display_name,
      tagline: c.tagline,
      backstory: c.backstory,
      interests: c.interests,
      examples: c.examples,
      formality: persona.formality,
      complexity: persona.complexity,
      engagement: persona.engagement,
      filler_density: persona.filler_density,
    });

    console.log(`\n[voice-corpus] === ${companionId} ===`);
    const rows: Record<string, unknown>[] = [];
    let dropped = 0;
    const voicePrompts = [...typed, ...spoken];
    for (const p of voicePrompts) {
      await waitForQuiet();
      const neutralResult = await complete("chat", [{ role: "system", content: identityLine(persona) }, { role: "user", content: p.text }], { thinking: false });
      if (!neutralResult.ok) {
        console.error(`[voice-corpus] ${companionId} ${p.id}: neutral reply failed (${neutralResult.error})`);
        dropped++;
        continue;
      }
      const neutral = visibleText(neutralResult.value.text).trim();

      let rewrite: string;
      try {
        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 1024,
          system: rewriteSystem,
          messages: [{ role: "user", content: `Prompt: ${p.text}\n\nNeutral reply:\n${neutral}\n\nRewrite this reply now, following the brief exactly.` }],
        });
        const block = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
        rewrite = block ? block.text.trim() : "";
      } catch (err) {
        // Two distinct "no credential" shapes from the SDK: a client-side
        // refusal before any request goes out ("Could not resolve
        // authentication method", a plain Error - no request was ever
        // made, so no server-side error class applies) and a server-side
        // 401 (Anthropic.AuthenticationError, a real request that got
        // rejected). Either one means every remaining row would fail
        // identically, so this aborts the whole run right here instead
        // of quietly dropping every row and reporting a misleading
        // "drop rate" that reads as a corpus finding instead of a
        // missing credential.
        const message = (err as Error).message;
        if (err instanceof Anthropic.AuthenticationError || message.includes("Could not resolve authentication method")) {
          throw new MissingCredentialError(`no Anthropic credential resolves (ANTHROPIC_API_KEY or an \`ant auth login\` profile - never a project file). ${message}`);
        }
        console.error(`[voice-corpus] ${companionId} ${p.id}: rewrite call failed (${message})`);
        dropped++;
        continue;
      }
      if (!rewrite) {
        dropped++;
        continue;
      }

      const verdict = validatePair(neutral, rewrite);
      if (!verdict.ok) {
        dropped++;
        continue;
      }
      rows.push({ id: `${companionId}-${p.id}`, companion: companionId, class: p.cls, kind: p.kind, prompt: p.text, neutral, rewrite });
    }

    for (const tr of toolRows) {
      rows.push({ id: `${companionId}-${tr.id}`, companion: companionId, class: "tool", kind: "tool", prompt: tr.utterance, neutral: tr.replyText, rewrite: tr.replyText, tool_calls: tr.toolCalls });
    }

    const outDir = join(REPO_ROOT, "data-scratch", "voice", companionId);
    mkdirSync(outDir, { recursive: true });
    const jsonl = toJsonl(rows);
    const outPath = join(outDir, "corpus.jsonl");
    writeFileSync(outPath, jsonl);
    const sha256 = createHash("sha256").update(jsonl).digest("hex");

    mkdirSync(FIXTURES_DIR, { recursive: true });
    const voiceRows = rows.filter((r) => r.class !== "tool");
    const sample = voiceRows.slice(0, 20);
    writeFileSync(join(FIXTURES_DIR, `${companionId}.sample.jsonl`), toJsonl(sample));

    const dropRate = voicePrompts.length > 0 ? dropped / voicePrompts.length : 0;
    console.log(`[voice-corpus] ${companionId}: kept ${voiceRows.length}/${voicePrompts.length} voice pairs + ${toolRows.length} tool rows, dropped ${dropped} (${(dropRate * 100).toFixed(1)}%), sha256=${sha256}`);
    summary.push({ companion: companionId, kept: voiceRows.length, dropped, dropRate, sha256 });
  }

  console.log("\n## Drop rate summary\n");
  for (const s of summary) console.log(`${s.companion.padEnd(8)} kept=${s.kept} dropped=${s.dropped} dropRate=${(s.dropRate * 100).toFixed(1)}% sha256=${s.sha256}`);
  for (const s of summary) {
    if (s.dropRate >= 0.2) console.log(`[voice-corpus] FINDING: ${s.companion}'s drop rate is at or above 20% - a corpus/brief problem, not relaxed here.`);
  }
}

// Guarded (not top-level, unconditional): backend/tests/voiceCorpus.test.ts
// imports this module's pure exports directly (validatePair, interleave,
// buildPromptList and the rest), the exact pattern labels.test.ts already
// uses on labels.ts - without this guard, importing this file for its
// pure functions would also kick off a real live run against the
// household's chat engine and the Anthropic API.
if (import.meta.main) {
  main().catch((err) => {
    if (err instanceof MissingCredentialError) {
      console.error(`[voice-corpus] refused: ${err.message}`);
      process.exit(2);
    }
    console.error(`[voice-corpus] ${(err as Error).message}`);
    process.exit(1);
  });
}
