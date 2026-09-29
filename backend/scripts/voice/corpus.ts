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
//      companion's own identityLine() plus the REAL production
//      formatting/length guidance for that prompt's surface class (see
//      neutralReplySystem() in run() - STYLE-CORPUS-01b, 2026-09-28:
//      identityLine() alone under-represented a real turn), thinking
//      off, CHAT_SAMPLING (llm.ts's complete() applies it automatically
//      whenever no temperature is given).
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
// STYLE-CORPUS-01b (docs/plans/style-corpus-01-local-teacher-2026-09-28.md,
// 2026-09-28): the rewrite "teacher" is this household's own local
// Qwen3.8-27B (MAIPAI_VOICE_TEACHER_URL - required, no hardcoded
// default: a real LAN address is household-specific and never belongs
// in this repo's own source, not just its docs, so the operator sets
// it per invocation, the same way a real household's own address was
// redacted from this item's own work order doc; MAIPAI_VOICE_TEACHER_MODEL,
// default "qwen38-27b"), an OpenAI-compatible /v1/chat/completions endpoint
// reached through the identical LlamaServerClient the hub's own chat
// role uses (@maipai/spec/llm/ts/client.js) - never an Anthropic key,
// which will never exist on this machine (Jesse, 2026-09-28). A
// connection failure or non-2xx response aborts the whole run rather
// than silently dropping every remaining row as a misleading "drop
// rate." Every prompt here is generated from a topic word bank or
// drawn from owner-replay.json's own already household-free rows, so
// nothing about the real household reaches the teacher call - it stays
// on the LAN either way, matching the product's own "nothing leaves
// your house" promise.
//
// Output: data-scratch/voice/<companion>/corpus.jsonl (git-ignored, the
// full run, appended to incrementally as each row is kept - not held in
// memory and written once at the end - so a mid-run teacher drop, this
// laptop's eGPU has a documented history of dropping mid-session, never
// silently discards already-good rows) and a committed 20-row sample per
// companion under backend/scripts/voice/fixtures/<companion>.sample.jsonl
// (the builder's own tests read the samples, and the sha256 in the
// manifest entry STYLE-SPEC-01 declares is the FULL corpus file's,
// printed at the end of each companion's run).
//
// MAIPAI_VOICE_TYPED_COUNT / MAIPAI_VOICE_SPOKEN_COUNT /
// MAIPAI_VOICE_TOOL_COUNT override the default ~400/~200/50 row counts -
// a prefix of the identical deterministic generator, never a different
// one - for a smaller real validation run. Never set as a standing
// default; an operator sets them per invocation.
//
// STYLE-CORPUS-02 (docs/dev.md "VOICE-CLASS-01 design pass", Fable,
// 2026-09-29): the corpus teaches one adapter per companion two
// registers, not one brief applied everywhere. A spoken-class reply
// (production's real spoken prompt class, which includes every child's
// and teen's typed turn - promptSurfaceClassFor) still takes the
// REWRITE_BRIEF full rewrite, the whole reply in voice. A typed-adult
// reply is classified by replyShape() from its own bare shape: a short
// conversational reply (no heading, no list marker, two paragraphs or
// fewer) also gets the full rewrite; a document-shaped reply (a heading,
// a list marker, or more than two paragraphs - PREFIX-CLASS-01's own
// written-class shape) gets the FRAME_BRIEF instead, which rewrites only
// the opener and the closer in the companion's voice and copies every
// heading, list item and paragraph between them character for character
// (splitFrame()). validatePair() is class-aware to match: a document
// row requires its body byte-identical after whitespace normalization
// and its frame paragraphs within band; a full-rewrite row keeps the
// original five checks, with the length band restated as the larger of
// 25 percent or eight words (VOICE-CLASS-01's own number, and
// REWRITE_BRIEF states the same one - a brief that promises 15 beside a
// validator that enforces something else is two definitions). Each row
// records its shape and the exact system prompt its neutral reply was
// generated under, so STYLE-TRAIN-01 trains on the prompt a real turn
// sends. The spoken prompt pool gains the five typed kinds (fact,
// how-to, comparison, list, small-talk) generated under the spoken
// prefix, because a minor's typed turn is spoken-class in real
// production and the adapter has to have seen that shape too.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
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

// STYLE-CORPUS-02 (VOICE-CLASS-01): "within 15 percent" replaced with
// the validator's own real number (lengthWithinBand below) - a brief
// that states one number beside a validator that enforces a different
// one is two definitions, exactly what VOICE-CLASS-01 named as the
// thing to fix.
const REWRITE_BRIEF = [
  "Rewrite the reply below into this speaker's own voice.",
  "Keep every fact, number, name, date and list item exactly as given, in the same order.",
  "Keep the same structure: if the original has headings or a list, the rewrite keeps them; if it does not, the rewrite does not add them.",
  "Keep the length within 25 percent of the original, or within eight words, whichever allows more.",
  "Change only the voice: word choice, sentence rhythm, contractions, and the personality below.",
  "Never add a fact the original did not state, never drop one, and never soften or hedge a fact the original stated flatly.",
  "Reply with the rewritten text only: no preamble, no quotation marks around it, no explanation.",
].join(" ");

// STYLE-CORPUS-02 (VOICE-CLASS-01, "The decision" point 2): the second
// fixed brief, for a document-shaped typed reply. Never a variant of
// REWRITE_BRIEF - a different job (the frame only, never the body).
const FRAME_BRIEF = [
  "The reply below is a structured, document-shaped answer: an opening paragraph, then headings, list items or numbered sections, then a closing paragraph.",
  "Rewrite ONLY the opening paragraph and the closing paragraph into this speaker's own voice.",
  "If there is no opening paragraph, add one opening sentence in this speaker's voice, at most 25 words.",
  "If there is no closing paragraph, add one closing sentence in this speaker's voice, at most 25 words.",
  "Copy every heading, list item, numbered section and paragraph between the opener and the closer exactly as given, character for character - do not change a single word inside them, and do not insert a remark or an aside inside them.",
  "Never add a fact the original did not state, never drop one, and never soften or hedge a fact the original stated flatly.",
  "Reply with the full rewritten text only, opener through closer: no preamble, no quotation marks around it, no explanation.",
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

// STYLE-CORPUS-02: takes the brief as a parameter (REWRITE_BRIEF or
// FRAME_BRIEF) - the companion fields and dials are identical for both
// jobs, only the instruction at the end differs.
function buildRewriteSystem(c: CompanionFields, brief: string): string {
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
    brief,
  ];
  return parts.filter((p) => p.length > 0).join("\n\n");
}

// ── The deterministic validator ────────────────────────────────────────

const WORD_RE = /[A-Za-z0-9']+/g;
export function wordCount(s: string): number {
  return (s.match(WORD_RE) ?? []).length;
}

// STYLE-CORPUS-01b (docs/dev.md "the validator, revisited against a
// real 27B teacher"): widened from 0.15 to 0.35, backed by real
// drop-reason evidence gathered 2026-09-28 in two passes - a first
// small sample clustered its "brief"-persona-driven compression at
// 15-22% under the original word count; re-checking a larger sample of
// 32 real, still-dropping rewrites (after the capitalized-token fixes
// below already landed) against this household's own long,
// markdown-structured neutral replies found overage densely spread from
// 25% to 45%, not the wholesale padding/truncation this check exists to
// catch.
//
// STYLE-CORPUS-02 (VOICE-CLASS-01, "The decision" point 3): restated as
// the larger of 25 percent or eight words, now that this check only
// ever runs on a full-rewrite row (spoken, or a short typed reply) - the
// document rows that produced the wider 25-45% spread above are now
// validated by validateDocumentPair() instead, on the frame alone, not
// this check, so the population this band is calibrated against is the
// one VOICE-CLASS-01 measured at 15-22% under once those document rows
// are excluded; the eight-word floor is the STYLE-CORPUS-01b tutor
// finding (a formal rewrite growing a fifteen-word reply past a flat
// percentage). REWRITE_BRIEF above states this same number.
export function lengthWithinBand(neutral: string, rewrite: string): boolean {
  const n = wordCount(neutral);
  const r = wordCount(rewrite);
  if (n === 0) return r === 0;
  const allowed = Math.max(0.25 * n, 8);
  return Math.abs(r - n) <= allowed;
}

export function digitRuns(s: string): string[] {
  return (s.match(/\d+/g) ?? []).slice().sort();
}
export function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// STYLE-CORPUS-01b: closed-class words excluded from the capitalized-
// token check below - pronouns, articles, and discourse connectives
// that carry no entity identity of their own. Found live, 2026-09-28:
// a real, substance-preserving rewrite against this household's own
// markdown-structured neutral replies routinely swaps a repeated
// subject noun for a pronoun across several bullets ("Volcanoes are
// known for..." / "They're known for...", "The human eye is known
// for..." / "It's known for...") - an ordinary style economy, not a
// dropped or invented fact, but the exact same class of word the
// original sentence-initial exclusion already existed to ignore
// (English orthography, not substance). Real entities (Mount Everest,
// Chile, a name) are never in this list and stay fully protected.
const CAPITALIZED_STOPWORDS = new Set([
  "a", "an", "the", "i", "you", "he", "she", "it", "we", "they",
  "this", "that", "these", "those", "who", "what", "which",
  "so", "now", "here", "there", "however", "but", "and", "or",
  "if", "when", "while", "also", "then", "yes", "no", "well",
  "okay", "ok", "let's", "let", "do", "does", "is", "are", "was", "were",
]);

// Capitalized tokens after the first word of each sentence OR line -
// sentence-initial capitalization is just English orthography, not a
// fact the rewrite could drop or invent, so it is excluded on both
// sides. STYLE-CORPUS-01b added the `\n+` split: the original `.!?`-only
// boundary merges an unpunctuated markdown bullet or heading into the
// PRECEDING line (headings and short bullet fragments routinely have no
// terminal punctuation), which misclassified that bullet's own leading
// word as "mid-sentence" - found live, 2026-09-28, against this
// household's own long, markdown-structured neutral replies (the local
// 8B chat engine's real shape for an open-ended factual question, not
// the short plain-prose replies this check was designed against).
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+|\n+/;
// A bolded markdown label followed by a colon, either inside the bold
// span ("**Volcanic Eruptions:** Volcanoes are known for...") or right
// after it ("**Volcanic Eruptions**: Volcanoes are known for...", the
// numbered-list-item shape found live, 2026-09-28, just as often as the
// first - Qwen38-27B uses both interchangeably across otherwise
// near-identical rewrites) - sits on the SAME line as the real sentence
// it introduces, with neither a period nor a newline between them,
// still merging the label into the sentence after the `\n+` split above
// and hiding that sentence's true first word (which the `\n+` fix alone
// does not reach, since there is no line break to split on here at
// all). Treated as its own boundary, the same way a heading or a fresh
// line already is.
const BOLD_LABEL_RE = /(\*\*[^*\n]+:\*\*|\*\*[^*\n]+\*\*:)\s*/g;
export function capitalizedTokensAfterSentenceStart(s: string): string[] {
  const withLabelBreaks = s.replace(BOLD_LABEL_RE, (m) => `${m}\n`);
  const out: string[] = [];
  for (const sentence of withLabelBreaks.split(SENTENCE_SPLIT_RE)) {
    const words = sentence.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
    for (let i = 1; i < words.length; i++) {
      const w = words[i]!;
      if (/^[A-Z]/.test(w) && !CAPITALIZED_STOPWORDS.has(w.toLowerCase())) out.push(w);
    }
  }
  return out.sort();
}

const HEADING_RE = /^#{1,6}\s/m;
const LIST_RE = /^\s*([-*]|\d+\.)\s/m;

// ── STYLE-CORPUS-02: reply shape and the frame split (VOICE-CLASS-01,
// "The decision" point 2) ──────────────────────────────────────────────

/** A blank-line-separated block, trimmed. This is the one definition of
 * "paragraph" replyShape() and splitFrame() both use, so the two can
 * never disagree on where one paragraph ends and the next begins. */
export function splitIntoParagraphs(s: string): string[] {
  return s
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function isHeadingOrListLine(line: string): boolean {
  return /^#{1,6}\s/.test(line) || /^\s*([-*]|\d+\.)\s/.test(line);
}

export type ReplyShape = "document" | "conversational";

/** VOICE-CLASS-01, "The decision" point 2: a typed neutral reply that
 * carries a heading, a list marker, or more than two paragraphs is
 * document-shaped; anything else typed is conversational. Spoken rows
 * never call this - "The decision" point 1 says spoken rows are always
 * full-rewrite regardless of shape, so callers apply that rule before
 * reaching here (see run()'s own `p.cls === "spoken" ? "conversational"
 * : replyShape(neutral)`). */
export function replyShape(neutral: string): ReplyShape {
  if (HEADING_RE.test(neutral) || LIST_RE.test(neutral)) return "document";
  if (splitIntoParagraphs(neutral).length > 2) return "document";
  return "conversational";
}

export interface FrameSplit {
  opener: string;
  body: string;
  closer: string;
}

/** VOICE-CLASS-01, "The decision" point 2, verbatim: "the opener (the
 * first paragraph, when it is not itself a heading or a list item) and
 * the closer (the last paragraph, when it is not a heading or list item
 * and not the opener) are rewritten in the companion's voice ... every
 * heading, list item and paragraph between them is copied character for
 * character." Only called on a document-shaped reply (replyShape() ===
 * "document"), but defined to degrade sanely on anything else - no
 * frame paragraph found just means an empty opener or closer, which
 * FRAME_BRIEF is told to fill with one new sentence. */
export function splitFrame(neutral: string): FrameSplit {
  const paragraphs = splitIntoParagraphs(neutral);
  if (paragraphs.length === 0) return { opener: "", body: "", closer: "" };
  const firstLine = (p: string) => p.split("\n")[0] ?? "";
  const openerIdx = !isHeadingOrListLine(firstLine(paragraphs[0]!)) ? 0 : -1;
  const lastIdx = paragraphs.length - 1;
  const closerIdx = paragraphs.length > 1 && lastIdx !== openerIdx && !isHeadingOrListLine(firstLine(paragraphs[lastIdx]!)) ? lastIdx : -1;
  const opener = openerIdx >= 0 ? paragraphs[openerIdx]! : "";
  const closer = closerIdx >= 0 ? paragraphs[closerIdx]! : "";
  const bodyStart = openerIdx >= 0 ? 1 : 0;
  const bodyEnd = closerIdx >= 0 ? lastIdx : paragraphs.length;
  const body = paragraphs.slice(bodyStart, bodyEnd).join("\n\n");
  return { opener, body, closer };
}

/** "Byte-identical after whitespace normalization" (VOICE-CLASS-01,
 * "The decision" point 3): trims each line and collapses runs of blank
 * lines to one, so an incidental trailing space or an extra blank line
 * the teacher's own formatting habit adds is never confused with an
 * actual word changed inside a list item or a heading. */
export function normalizeWhitespace(s: string): string {
  return s
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** VOICE-CLASS-01, "The decision" point 3: "each frame paragraph within
 * 1.5x of its neutral counterpart's word count, an added frame sentence
 * at most 25 words." Both halves of that sentence are ceilings ("within
 * 1.5x", "at most 25 words"), never a floor - a first real validation
 * run against this household's own local teacher (STYLE-CORPUS-02,
 * 2026-09-29) found a symmetric 1/1.5x-to-1.5x band dropping the large
 * majority of real document rows, almost all of it a genuine, desirable
 * COMPRESSION: the teacher routinely turns a document's verbose,
 * multi-sentence lead-in ("For a beginner's toolbox, it's best to start
 * with the essentials that will cover most common home repair and DIY
 * tasks. Here's a list of items you might want to include:", 31 words)
 * into one short, voiced sentence ("Start with the essentials for
 * common home repairs and DIY jobs.", 11 words) - every fact stays in
 * the untouched body, so nothing is lost, and a short frame is exactly
 * "the voice" for a brief/casual companion. VOICE-CLASS-01's own
 * concern was never brevity - it was the opposite failure, an adapter
 * that learns to pad a document with interjections (the kept Pal pair
 * it names) - so only growth is bounded here; genuine content loss in a
 * shortened frame is still caught by the digit-run and
 * capitalized-token checks below, which run on the frame regardless of
 * its length. */
function frameWithinBand(neutralFrame: string, rewriteFrame: string): boolean {
  const n = wordCount(neutralFrame);
  const r = wordCount(rewriteFrame);
  if (n === 0) return r <= 25;
  return r <= n * 1.5;
}

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
function validateFullRewritePair(neutral: string, rewrite: string): ValidationResult {
  if (!lengthWithinBand(neutral, rewrite)) return { ok: false, reason: "length band" };
  if (!sameMultiset(digitRuns(neutral), digitRuns(rewrite))) return { ok: false, reason: "digit-run set" };
  // STYLE-CORPUS-01b: compared as a deduplicated SET, not the exact
  // multiset digit-run gets above. digitRuns() stays count-sensitive on
  // purpose (a repeated number dropped to one occurrence is drift); a
  // capitalized entity mentioned a different number of times across a
  // real rewrite is not the same kind of drift - found live, 2026-09-28,
  // a rewrite that referred to a repeated subject once by name and then
  // by pronoun ("Mount Fuji... it's also..." instead of naming it
  // twice) still names every entity the neutral reply named, just not
  // the identical number of times. An entity ADDED or DROPPED entirely,
  // or swapped for a different one (the "Canberra"/"Sydney" regression
  // test below), still fails: it is present in one set and absent from
  // the other either way.
  const neutralCaps = new Set(capitalizedTokensAfterSentenceStart(neutral));
  const rewriteCaps = new Set(capitalizedTokensAfterSentenceStart(rewrite));
  if (!sameMultiset([...neutralCaps].sort(), [...rewriteCaps].sort())) return { ok: false, reason: "capitalized-token set" };
  if (HEADING_RE.test(neutral) !== HEADING_RE.test(rewrite)) return { ok: false, reason: "heading presence changed" };
  if (LIST_RE.test(neutral) !== LIST_RE.test(rewrite)) return { ok: false, reason: "list marker presence changed" };
  return { ok: true };
}

// STYLE-CORPUS-02 (VOICE-CLASS-01, "The decision" point 3): "document
// rows require the body byte-identical after whitespace normalization,
// each frame paragraph within 1.5x of its neutral counterpart's word
// count ... digit-run and capitalized-token checks on the frame alone
// (the body is identical by construction, which also retires the
// carpet-stain class of false positive without touching those checks)."
function validateDocumentPair(neutral: string, rewrite: string): ValidationResult {
  const n = splitFrame(neutral);
  const r = splitFrame(rewrite);
  if (normalizeWhitespace(n.body) !== normalizeWhitespace(r.body)) return { ok: false, reason: "document body changed" };
  if (!frameWithinBand(n.opener, r.opener)) return { ok: false, reason: "frame opener out of band" };
  if (!frameWithinBand(n.closer, r.closer)) return { ok: false, reason: "frame closer out of band" };
  const neutralFrame = `${n.opener}\n${n.closer}`;
  const rewriteFrame = `${r.opener}\n${r.closer}`;
  if (!sameMultiset(digitRuns(neutralFrame), digitRuns(rewriteFrame))) return { ok: false, reason: "digit-run set" };
  const neutralCaps = new Set(capitalizedTokensAfterSentenceStart(neutralFrame));
  const rewriteCaps = new Set(capitalizedTokensAfterSentenceStart(rewriteFrame));
  if (!sameMultiset([...neutralCaps].sort(), [...rewriteCaps].sort())) return { ok: false, reason: "capitalized-token set" };
  return { ok: true };
}

/** STYLE-CORPUS-02: class-aware (VOICE-CLASS-01, "The decision" point
 * 3) - a document row (a document-shaped typed reply) is checked by
 * validateDocumentPair(), everything else (a full-rewrite row: spoken,
 * or a conversational typed reply) by validateFullRewritePair(). The
 * forbidden-phrase check is unconditional on the rewrite either way -
 * VOICE-CLASS-01 doesn't relax it for either class. */
export function validatePair(neutral: string, rewrite: string, shape: ReplyShape): ValidationResult {
  if (FORBIDDEN_RE.test(rewrite)) return { ok: false, reason: "forbidden phrase" };
  return shape === "document" ? validateDocumentPair(neutral, rewrite) : validateFullRewritePair(neutral, rewrite);
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

// STYLE-CORPUS-02 (VOICE-CLASS-01, "The decision" point 1): each of the
// five typed-kind generators below takes the target class, defaulting
// to "typed" - buildPromptList() also calls each with "spoken" to give
// the spoken pool the same five kinds under the spoken prefix, since a
// child's or teen's typed turn is spoken-class in real production
// (promptSurfaceClassFor). Same topic banks and templates either way -
// the text is deliberately identical between a typed and a spoken row
// of the same kind; what differs is which system prompt the neutral
// reply is generated under.
function buildFact(cls: PromptSpec["cls"] = "typed"): PromptSpec[] {
  const out: PromptSpec[] = [];
  for (const [ti, tmpl] of FACT_TEMPLATES.entries()) for (const [wi, topic] of FACT_TOPICS.entries()) out.push({ id: `${cls}-fact-${ti}-${wi}`, cls, kind: "fact", text: tmpl(topic) });
  return out;
}
function buildHowTo(cls: PromptSpec["cls"] = "typed"): PromptSpec[] {
  const out: PromptSpec[] = [];
  for (const [ti, tmpl] of HOWTO_TEMPLATES.entries()) for (const [wi, topic] of HOWTO_TOPICS.entries()) out.push({ id: `${cls}-howto-${ti}-${wi}`, cls, kind: "how-to", text: tmpl(topic) });
  return out;
}
function buildComparison(cls: PromptSpec["cls"] = "typed"): PromptSpec[] {
  const out: PromptSpec[] = [];
  for (const [ti, tmpl] of COMPARISON_TEMPLATES.entries()) for (const [wi, [a, b]] of COMPARISON_PAIRS.entries()) out.push({ id: `${cls}-comparison-${ti}-${wi}`, cls, kind: "comparison", text: tmpl(a, b) });
  return out;
}
function buildList(cls: PromptSpec["cls"] = "typed"): PromptSpec[] {
  const out: PromptSpec[] = [];
  for (const [ti, tmpl] of LIST_TEMPLATES.entries()) for (const [wi, topic] of LIST_TOPICS.entries()) out.push({ id: `${cls}-list-${ti}-${wi}`, cls, kind: "list", text: tmpl(topic) });
  return out;
}
function buildSmallTalk(cls: PromptSpec["cls"] = "typed"): PromptSpec[] {
  const out: PromptSpec[] = [];
  let i = 0;
  for (const base of SMALL_TALK_BASE) for (const tag of SMALL_TALK_TAGS) out.push({ id: `${cls}-small-talk-${i++}`, cls, kind: "small-talk", text: `${base}${tag}`.trim() });
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
  // STYLE-CORPUS-02 (VOICE-CLASS-01, "The decision" point 1): the spoken
  // pool gains the same five typed kinds, generated under the spoken
  // prefix - interleaved in beside the seven naturalness-corpus
  // categories, same SPOKEN_COUNT default as before ("the counts
  // unchanged" - the top-level pool size, not the per-kind topic count).
  const spokenPool = interleave([buildSpokenCategories(), buildFact("spoken"), buildHowTo("spoken"), buildComparison("spoken"), buildList("spoken"), buildSmallTalk("spoken")]);
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

/** Thrown when the local voice-rewrite teacher (STYLE-CORPUS-01b) can't
 * be reached - a connection failure or a non-2xx response, either one
 * meaning every remaining row would fail identically, so the whole run
 * aborts here rather than quietly dropping every row into a misleading
 * "drop rate." Caught once at the very top of main() (never at the call
 * site) so the isolated data directory this script creates is always
 * cleaned up before the process exits, whichever companion or row the
 * teacher first dropped on (a code review, 2026-09-28: `process.exit(2)`
 * called from inside the per-row loop skipped the cleanup at the end of
 * main()). */
class TeacherUnreachableError extends Error {}

// ── main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  refuseIfGateRunning("voice-corpus");

  // No hardcoded LAN address (STYLE-CORPUS-01b) - a real household's own
  // teacher endpoint never belongs in this repo's own source, so the
  // operator sets it per invocation; a clear refusal here, never a
  // silent fallback to some other address.
  const teacherUrl = process.env.MAIPAI_VOICE_TEACHER_URL;
  if (!teacherUrl) throw new TeacherUnreachableError("MAIPAI_VOICE_TEACHER_URL is required (this household's own local voice-rewrite teacher, e.g. an OpenAI-compatible llama-server address) - never a hardcoded default, set it per invocation.");
  const teacherModel = process.env.MAIPAI_VOICE_TEACHER_MODEL ?? "qwen38-27b";
  const teacher = new LlamaServerClient(teacherUrl);

  const upstream = process.env.MAIPAI_LLAMA_SERVER_URL ?? "http://127.0.0.1:8788";
  process.env.MAIPAI_LLAMA_SERVER_URL = upstream;
  if (!process.env.MAIPAI_EMBED_URL) process.env.MAIPAI_EMBED_URL = "http://127.0.0.1:8794";
  const ownDataDir = mkdtempSync(join(tmpdir(), "voice-corpus-"));
  process.env.MAIPAI_DATA_DIR = ownDataDir;

  const waitForQuiet = () => waitForHubQuiet(undefined, (msg) => console.log(msg.replace("live-hub-quiet", "voice-corpus")));

  console.log(`[voice-corpus] chat=${upstream} embed=${process.env.MAIPAI_EMBED_URL} teacher=${teacherUrl} (${teacherModel}) data=${ownDataDir}`);
  try {
    await run(teacher, teacherModel, waitForQuiet);
  } finally {
    rmSync(ownDataDir, { recursive: true, force: true });
  }
}

async function run(teacher: LlamaServerClient, teacherModel: string, waitForQuiet: () => Promise<void>): Promise<void> {

  // CHAT-22: setup.ts must be imported (and awaited) before anything
  // that reaches "@/db" - persona.ts, plugins.ts, turnEngine.ts and
  // llm.ts all transitively do, through @/lib/access and @/lib/settings.
  const setup = await import("../bench/setup");
  await setup.startBench();

  const { complete } = await import("@/lib/llm");
  const { loadManifestOnly } = await import("@/lib/plugins");
  const { PERSONAS, NATURALNESS_POLICY } = await import("@/lib/persona");
  const { identityLine, buildStablePrefix, stableSuffixFor } = await import("@/lib/turnEngine");
  const { visibleText } = await import("@/lib/wellFormed");

  // STYLE-CORPUS-01b (Jesse, 2026-09-28): the neutral-reply system
  // message used to be identityLine(persona) alone, on the theory that
  // stripping everything else isolates voice from content. That went
  // too far - a real household member's own typed chat turn gets
  // buildStablePrefix(persona, "written") (identity plus the privacy
  // sentence; PREFIX-CLASS-01, dev.md "The written prompt on tier 1,
  // decided", 2026-09-23, measured that ANY added policy or persona
  // prose collapses this model's reply quality on the written class, so
  // production deliberately sends nothing else - the model's own long,
  // structured, markdown-heavy habit for an open-ended question IS
  // today's real written-adult behavior, not a corpus-script artifact),
  // and a real SPOKEN turn additionally gets NATURALNESS_POLICY (@/lib/
  // persona.ts) - a fixed, non-persona-varying fragment ("never bullet
  // points," spoken-style numbers), the one formatting/length rule
  // every companion's spoken reply gets regardless of voice. Neither
  // adds a companion's own persona/voice fragments (composePersonaPrompt,
  // the engagement dial's own sentence-count language) - those stay the
  // rewrite step's job, exactly as before; this only stops
  // UNDER-representing what the bare model already does on each real
  // surface class.
  function neutralReplySystem(persona: Persona, cls: "typed" | "spoken"): string {
    if (cls === "typed") return buildStablePrefix(persona, "written");
    return `${identityLine(persona)} ${stableSuffixFor("spoken")} ${NATURALNESS_POLICY}`;
  }

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

  const summary: {
    companion: string;
    kept: number;
    dropped: number;
    dropRate: number;
    sha256: string;
    documentDropRate: number;
    fullRewriteDropRate: number;
  }[] = [];

  // STYLE-CORPUS-02: at least this many document-shaped rows in the
  // committed 20-row sample per companion (acceptance evidence below).
  const SAMPLE_SIZE = 20;
  const MIN_DOCUMENT_SAMPLE = 5;

  /** Builds the committed sample so it always carries at least
   * MIN_DOCUMENT_SAMPLE document-shaped rows when the run produced that
   * many, instead of leaving it to the luck of which 20 rows landed
   * first - a plain `.slice(0, 20)` on a typed-then-spoken row order can
   * easily miss the document rows entirely on a small validation run. */
  function buildSample(voiceRows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
    const documentRows = voiceRows.filter((r) => r.shape === "document");
    const otherRows = voiceRows.filter((r) => r.shape !== "document");
    const docCount = Math.min(MIN_DOCUMENT_SAMPLE, documentRows.length);
    const sample = [...documentRows.slice(0, docCount), ...otherRows.slice(0, Math.max(0, SAMPLE_SIZE - docCount))];
    if (sample.length < SAMPLE_SIZE && documentRows.length > docCount) {
      sample.push(...documentRows.slice(docCount, docCount + (SAMPLE_SIZE - sample.length)));
    }
    return sample.slice(0, SAMPLE_SIZE);
  }

  for (const companionId of COMPANIONS) {
    const persona = PERSONAS.find((p: Persona) => p.id === companionId);
    const manifest = loadManifestOnly(companionId);
    if (!persona || !manifest.ok || !manifest.value.companion) throw new Error(`bundled companion ${companionId} failed to load`);
    const c = manifest.value.companion;
    const companionFields: CompanionFields = {
      display_name: c.display_name,
      tagline: c.tagline,
      backstory: c.backstory,
      interests: c.interests,
      examples: c.examples,
      formality: persona.formality,
      complexity: persona.complexity,
      engagement: persona.engagement,
      filler_density: persona.filler_density,
    };
    // STYLE-CORPUS-02: two systems, one per brief - the companion fields
    // and dials are identical, only the instruction at the end differs
    // (buildRewriteSystem's own comment).
    const fullRewriteSystem = buildRewriteSystem(companionFields, REWRITE_BRIEF);
    const frameRewriteSystem = buildRewriteSystem(companionFields, FRAME_BRIEF);

    console.log(`\n[voice-corpus] === ${companionId} ===`);
    const rows: Record<string, unknown>[] = [];
    let dropped = 0;
    const voicePrompts = [...typed, ...spoken];

    // STYLE-CORPUS-02: kept/dropped per (class, shape) bucket, so the
    // drop rate can be reported and gated per class/shape (item 7 and
    // the acceptance evidence below), not just per companion overall.
    const classShapeStats = new Map<string, { kept: number; dropped: number }>();
    function bump(cls: PromptSpec["cls"], shape: ReplyShape, field: "kept" | "dropped"): void {
      const key = `${cls}:${shape}`;
      const cur = classShapeStats.get(key) ?? { kept: 0, dropped: 0 };
      cur[field]++;
      classShapeStats.set(key, cur);
    }

    const outDir = join(REPO_ROOT, "data-scratch", "voice", companionId);
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, "corpus.jsonl");
    // Checkpointed incrementally (STYLE-CORPUS-01b step 4): one line
    // appended per kept row as the loop runs, not accumulated in memory
    // and written once at the end, so a mid-companion teacher drop
    // (this laptop's eGPU has a documented history of dropping
    // mid-session) leaves every already-good row on disk instead of
    // discarding it.
    writeFileSync(outPath, "");

    for (const p of voicePrompts) {
      await waitForQuiet();
      const neutralSystem = neutralReplySystem(persona, p.cls);
      const neutralResult = await complete("chat", [{ role: "system", content: neutralSystem }, { role: "user", content: p.text }], { thinking: false });
      if (!neutralResult.ok) {
        console.error(`[voice-corpus] ${companionId} ${p.id}: neutral reply failed (${neutralResult.error})`);
        dropped++;
        continue;
      }
      const neutral = visibleText(neutralResult.value.text).trim();

      // STYLE-CORPUS-02 (VOICE-CLASS-01, "The decision" points 1-2):
      // spoken rows are always full-rewrite ("conversational" shape);
      // a typed row's shape comes from its own bare neutral reply.
      const shape: ReplyShape = p.cls === "spoken" ? "conversational" : replyShape(neutral);
      const rewriteSystem = shape === "document" ? frameRewriteSystem : fullRewriteSystem;

      let rewrite: string;
      try {
        const response = await teacher.chatComplete({
          model: teacherModel,
          max_tokens: 1024,
          messages: [
            { role: "system", content: rewriteSystem },
            { role: "user", content: `Prompt: ${p.text}\n\nNeutral reply:\n${neutral}\n\nRewrite this reply now, following the brief exactly.` },
          ],
        });
        rewrite = (response.choices[0]?.message.content ?? "").trim();
      } catch (err) {
        // A connection failure (this laptop's eGPU-backed teacher has a
        // documented history of dropping mid-session, see the homelab
        // repo's own host doc) or a non-2xx response - either one
        // surfaces here as LlamaServerClient.chatComplete()'s own
        // LlmClientError - means every remaining row would fail
        // identically, so this aborts the whole run right here instead
        // of quietly dropping every row and reporting a misleading
        // "drop rate" that reads as a corpus finding instead of an
        // unreachable teacher. Every row kept before this point is
        // already on disk (the incremental write above), so nothing
        // already good is lost.
        throw new TeacherUnreachableError(`local voice teacher unreachable (${(err as Error).message})`);
      }
      if (!rewrite) {
        dropped++;
        bump(p.cls, shape, "dropped");
        continue;
      }

      const verdict = validatePair(neutral, rewrite, shape);
      if (!verdict.ok) {
        console.error(`[voice-corpus] ${companionId} ${p.id}: dropped (${shape}, ${verdict.reason})`);
        // MAIPAI_VOICE_DEBUG_DROPS=1: the full pair, for characterizing a
        // real drop-rate finding against actual text (never logged by
        // default - hundreds of full replies would swamp a real run's
        // log for no reason once the cause is already understood).
        if (process.env.MAIPAI_VOICE_DEBUG_DROPS) {
          console.error(`  neutral: ${JSON.stringify(neutral)}`);
          console.error(`  rewrite: ${JSON.stringify(rewrite)}`);
        }
        dropped++;
        bump(p.cls, shape, "dropped");
        continue;
      }
      const row = { id: `${companionId}-${p.id}`, companion: companionId, class: p.cls, shape, kind: p.kind, system_prompt: neutralSystem, prompt: p.text, neutral, rewrite };
      rows.push(row);
      appendFileSync(outPath, JSON.stringify(row) + "\n");
      bump(p.cls, shape, "kept");
    }

    for (const tr of toolRows) {
      const row = { id: `${companionId}-${tr.id}`, companion: companionId, class: "tool", shape: "tool", kind: "tool", prompt: tr.utterance, neutral: tr.replyText, rewrite: tr.replyText, tool_calls: tr.toolCalls };
      rows.push(row);
      appendFileSync(outPath, JSON.stringify(row) + "\n");
    }

    const jsonl = readFileSync(outPath, "utf-8");
    const sha256 = createHash("sha256").update(jsonl).digest("hex");

    mkdirSync(FIXTURES_DIR, { recursive: true });
    const voiceRows = rows.filter((r) => r.class !== "tool");
    const sample = buildSample(voiceRows);
    writeFileSync(join(FIXTURES_DIR, `${companionId}.sample.jsonl`), toJsonl(sample));

    const dropRate = voicePrompts.length > 0 ? dropped / voicePrompts.length : 0;
    console.log(`[voice-corpus] ${companionId}: kept ${voiceRows.length}/${voicePrompts.length} voice pairs + ${toolRows.length} tool rows, dropped ${dropped} (${(dropRate * 100).toFixed(1)}%), sha256=${sha256}`);

    // STYLE-CORPUS-02: per-class-and-shape breakdown (item 7), and the
    // two buckets the acceptance evidence gates on - "document-shaped
    // typed rows" (typed:document) and "full-rewrite rows" (spoken and
    // conversational typed combined, VOICE-CLASS-01's own phrase).
    console.log(`[voice-corpus] ${companionId} by class/shape:`);
    for (const [key, stats] of [...classShapeStats.entries()].sort()) {
      const total = stats.kept + stats.dropped;
      const rate = total > 0 ? stats.dropped / total : 0;
      console.log(`  ${key.padEnd(22)} kept=${stats.kept} dropped=${stats.dropped} dropRate=${(rate * 100).toFixed(1)}%`);
    }
    const documentStats = classShapeStats.get("typed:document") ?? { kept: 0, dropped: 0 };
    const documentTotal = documentStats.kept + documentStats.dropped;
    const documentDropRate = documentTotal > 0 ? documentStats.dropped / documentTotal : 0;
    const fullRewriteStats = ["typed:conversational", "spoken:conversational"].reduce(
      (acc, key) => {
        const s = classShapeStats.get(key) ?? { kept: 0, dropped: 0 };
        return { kept: acc.kept + s.kept, dropped: acc.dropped + s.dropped };
      },
      { kept: 0, dropped: 0 },
    );
    const fullRewriteTotal = fullRewriteStats.kept + fullRewriteStats.dropped;
    const fullRewriteDropRate = fullRewriteTotal > 0 ? fullRewriteStats.dropped / fullRewriteTotal : 0;
    console.log(`  document-shaped typed (typed:document): ${(documentDropRate * 100).toFixed(1)}% dropped (${documentTotal} rows)`);
    console.log(`  full-rewrite (spoken + conversational typed): ${(fullRewriteDropRate * 100).toFixed(1)}% dropped (${fullRewriteTotal} rows)`);

    summary.push({ companion: companionId, kept: voiceRows.length, dropped, dropRate, sha256, documentDropRate, fullRewriteDropRate });
  }

  console.log("\n## Drop rate summary\n");
  for (const s of summary) {
    console.log(
      `${s.companion.padEnd(8)} kept=${s.kept} dropped=${s.dropped} dropRate=${(s.dropRate * 100).toFixed(1)}% documentDropRate=${(s.documentDropRate * 100).toFixed(1)}% fullRewriteDropRate=${(s.fullRewriteDropRate * 100).toFixed(1)}% sha256=${s.sha256}`,
    );
  }
  for (const s of summary) {
    // STYLE-CORPUS-02 acceptance: document-shaped typed rows under 20%
    // dropped per companion, and full-rewrite rows (spoken +
    // conversational typed) under 20% dropped per companion - two
    // separate findings, since VOICE-CLASS-01 gates them separately.
    if (s.documentDropRate >= 0.2) console.log(`[voice-corpus] FINDING: ${s.companion}'s document-shaped typed drop rate is at or above 20% - a corpus/brief problem, not relaxed here.`);
    if (s.fullRewriteDropRate >= 0.2) console.log(`[voice-corpus] FINDING: ${s.companion}'s full-rewrite drop rate is at or above 20% - a corpus/brief problem, not relaxed here.`);
  }
}

// Guarded (not top-level, unconditional): backend/tests/voiceCorpus.test.ts
// imports this module's pure exports directly (validatePair, interleave,
// buildPromptList and the rest), the exact pattern labels.test.ts already
// uses on labels.ts - without this guard, importing this file for its
// pure functions would also kick off a real live run against the
// household's chat engine and the local voice teacher.
if (import.meta.main) {
  main().catch((err) => {
    if (err instanceof TeacherUnreachableError) {
      console.error(`[voice-corpus] refused: ${err.message}`);
      process.exit(2);
    }
    console.error(`[voice-corpus] ${(err as Error).message}`);
    process.exit(1);
  });
}
