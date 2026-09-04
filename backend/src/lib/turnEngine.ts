// The turn engine (platform plan 4.5): "One turn engine for every
// surface... safety first; the deterministic skill floor; ...the model
// phrases, it does not judge." Full scope (six surfaces, prefix-cached
// prompt assembly, tier 2 native tool calling, remote candidates,
// `ask`-continuation) is documented in docs/dev.md as too large for one
// slice, the same judgment 4.11 made; this is the narrow real slice: one
// surface (`chat`), safety-first routing, a deterministic Tier 0 skill
// floor (pattern match, or a keyword-overlap stand-in for routing.examples
// the same way memory.ts stands in for real embeddings), and a
// stable-first prompt handed to the real `chat` role as the fallback.
//
// What's deferred, and why, is repeated at the point it matters below;
// read docs/dev.md's turn engine section before extending this file.
import { evaluateSafety } from "@/lib/safety";
import { listPackageIds, loadPackage, meetsMinRole, runSkill } from "@/lib/skills";
import { recall, type RecallMatch } from "@/lib/memory";
import { complete } from "@/lib/llm";
import { tokenize } from "@/lib/text";
import { logTurn } from "@/lib/conversationHistory";
import type { Role } from "@/middleware/auth";
import type { PersonRow } from "@/types";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
// TurnReply/TurnValue moved to @/wire (alias-free, so a frontend client
// can import the real shape through the @maipai/home-backend workspace
// dependency instead of a hand-duplicated mirror); re-exported here since
// this is where callers already look for them.
import type { TurnValue } from "@/wire";
export type { TurnReply, TurnValue } from "@/wire";

// 4.5 names six surfaces (chat, overlay, pod, robot, tv, phone), each
// changing memory sensitivity, discretion and presentation. Only `chat`
// has anything to render it (a curl caller today, same as every other
// core slice); the other five are a real, named gap the same shape as
// llm.ts's IMPLEMENTED_ROLES, not silently missing.
export type Surface = "chat" | "overlay" | "pod" | "robot" | "tv" | "phone";
const IMPLEMENTED_SURFACES: ReadonlySet<Surface> = new Set(["chat"]);

export type TurnOpResult =
  | { ok: true; value: TurnValue }
  | { ok: false; status: 400 | 503; code: "unsupported_surface" | "invalid_input" | "unavailable"; error: string };

const REFUSAL_TEXT = "I can't help with that.";
const CRISIS_RESOURCES_TEXT =
  "If you're in crisis, the 988 Suicide & Crisis Lifeline is free and available 24/7: call or text 988.";

const STABLE_SYSTEM_PREFIX = [
  "You are MaiPai, a private, self-hosted AI assistant for this household. Be warm, concise and honest. Nothing you say leaves this house.",
  "Requests already blocked by the household's safety rules never reach you; answer anything else helpfully and honestly.",
  "If you don't know something the household hasn't told you, say so instead of guessing.",
].join(" ");

interface LoadedManifest {
  id: string;
  manifest: PackageManifest;
}

// One catalog scan per turn, shared by route() and buildSystemPrompt()'s
// skills list, instead of each loading (readFileSync + JSON.parse + Zod
// safeParse) every bundled package's manifest independently (a review,
// 2026-09-04, found the first cut doing this twice per turn, or three
// times for a turn that also fires a skill). Sorted by id: `route()`'s
// tie-break among equally-scored candidates depends on this order, so it
// needs to be deterministic and independent of `readdirSync`'s
// OS-dependent enumeration order, not just "whatever order the disk
// returns," even though only one bundled package exists to tie against
// today.
function loadAllManifests(): LoadedManifest[] {
  const out: LoadedManifest[] = [];
  for (const id of [...listPackageIds()].sort()) {
    const loaded = loadPackage(id);
    if (loaded.ok) out.push({ id, manifest: loaded.value.manifest });
  }
  return out;
}

function skillsListLine(loaded: LoadedManifest[]): string {
  if (loaded.length === 0) return "";
  const lines = loaded.map(({ manifest: m }) => `- ${m.display}: ${m.description}`);
  return `\n\nThings this household has set up:\n${lines.join("\n")}`;
}

// Carved out of a shared budget so "a prompt budget as a test" (4.5) has
// something concrete to assert: the assembled system prompt never grows
// unbounded just because a household has a lot of memories or packages.
export const PROMPT_SYSTEM_CHAR_BUDGET = 4000;
const MAX_MEMORY_SNIPPETS = 5;
const MAX_MEMORY_SECTION_CHARS = 800;
const MAX_SKILLS_SECTION_CHARS = 800;

// Stable-first (4.5): persona/rules/content-policy/standing-instructions
// and the skills list are the same for every turn on this install, so they
// sit first for prefix caching; the volatile zone (memory, then time)
// comes after. 4.5 also names notes, methods, summary and context in the
// volatile zone: notes/methods need persona/companion state (not built);
// summary needs an LLM to distill conversation history into one (the raw
// history now exists for real, lib/conversationHistory.ts, but nothing
// summarizes it, 4.11's other roles); context needs the ambient-context
// wiring the robot side already has but the hub doesn't yet: all three
// are real gaps, not silently skipped.
export function buildSystemPrompt(memoryMatches: RecallMatch[], loaded: LoadedManifest[] = loadAllManifests()): string {
  let skillsSection = skillsListLine(loaded);
  if (skillsSection.length > MAX_SKILLS_SECTION_CHARS) {
    skillsSection = skillsSection.slice(0, MAX_SKILLS_SECTION_CHARS) + "...";
  }

  let memorySection = "";
  if (memoryMatches.length > 0) {
    const lines = memoryMatches.slice(0, MAX_MEMORY_SNIPPETS).map((m) => `- ${m.record.text}`);
    memorySection = `\n\nWhat you already know about this household:\n${lines.join("\n")}`;
    if (memorySection.length > MAX_MEMORY_SECTION_CHARS) {
      memorySection = memorySection.slice(0, MAX_MEMORY_SECTION_CHARS) + "...";
    }
  }

  const timeLine = `\n\nCurrent time: ${new Date().toISOString()}`;

  // The time line is appended last (4.5: "...time last") and must never
  // itself be truncated: a review (2026-09-04) found the first cut
  // blind-sliced the *whole* assembled prompt to the budget after
  // appending the time line, which could cut the timestamp (or a memory
  // bullet) off mid-word once enough packages or memories pushed the
  // total over budget. Truncating the body first, then appending a
  // never-truncated time line, keeps every truncation boundary inside
  // prose meant to be cut, never inside the one line a caller might parse.
  let body = STABLE_SYSTEM_PREFIX + skillsSection + memorySection;
  const bodyBudget = Math.max(0, PROMPT_SYSTEM_CHAR_BUDGET - timeLine.length);
  if (body.length > bodyBudget) body = body.slice(0, bodyBudget);

  return body + timeLine;
}

// Tier 1 of the deterministic skill floor (4.5: "tier 1 example-embedding
// match"). No embedder exists (4.11's embed role), so `routing.examples`
// is matched by keyword overlap against the utterance instead, the same
// documented-placeholder move memory.ts's recall() already made for
// "scored vectors." Coverage of the *example*'s words (not Jaccard) since
// examples are short template sentences and the live utterance is often
// longer or shorter; a 0..1 score, not a claim of semantic matching.
function exampleScore(text: string, examples: readonly string[] | undefined): number {
  if (!examples || examples.length === 0) return 0;
  const words = tokenize(text);
  let best = 0;
  for (const example of examples) {
    const exampleWords = tokenize(example);
    if (exampleWords.size === 0) continue;
    const overlap = [...exampleWords].filter((w) => words.has(w)).length;
    best = Math.max(best, overlap / exampleWords.size);
  }
  return best;
}
const EXAMPLE_MATCH_THRESHOLD = 0.6;

// A `routing.patterns` entry is a literal string with at most one `*`
// wildcard (docs/PACKAGES.md: "routing.patterns (linted)"); this is the
// first real consumer, so the wildcard semantics are this slice's own
// judgment call, documented rather than assumed: `*` captures the rest of
// the utterance after the literal prefix/suffix, case-insensitive,
// whitespace-trimmed. A pattern with no `*` at all is a real exact match
// (case-insensitive, trimmed), returning an empty capture rather than
// null: a review (2026-09-04) found the first cut rejected every
// zero-wildcard pattern outright, which combined with `route()`'s
// consequential guard (examples never checked for a raised-bar package)
// meant a consequential package with a plain literal trigger and no
// argument to capture (e.g. "lock the front door") could never fire
// deterministically at all. A pattern with more than one `*` still has no
// single capture to bind to an arg and is treated as non-matching (falls
// through to the fuzzy example score, or ultimately to the model): real
// multi-slot extraction needs tier 2 native tool calling (4.5), not built.
export function matchPattern(text: string, pattern: string): string | null {
  const parts = pattern.split("*");
  if (parts.length > 2) return null;
  const trimmedText = text.trim();
  if (parts.length === 1) {
    return trimmedText.toLowerCase() === pattern.trim().toLowerCase() ? "" : null;
  }
  const escaped = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`^${escaped[0]}(.+)${escaped[1]}$`, "is");
  const match = trimmedText.match(regex);
  return match ? match[1]!.trim() : null;
}

// A package's `args` schema declares its call arguments (manifest.schema.json:
// "a JSON Schema for this package's call arguments"), typed `unknown` by
// codegen since it's arbitrary. The deterministic floor can bind a call's
// inputs in exactly two shapes: no required args (fires with `{}`,
// ignoring any wildcard capture), or exactly one required string arg (the
// wildcard capture, when there is one, binds to it). Anything richer
// (multiple required args) is the same tier 2 gap `matchPattern` documents
// above: no capture to bind, so the floor doesn't fire and the turn falls
// through toward the model instead.
function deterministicArgs(args: unknown, captured: string | null): Record<string, unknown> | null {
  const schema = (args && typeof args === "object" ? args : {}) as {
    required?: unknown;
    properties?: Record<string, { type?: unknown }>;
  };
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (required.length === 0) return {};
  if (required.length > 1 || captured === null) return null;
  const name = required[0];
  if (typeof name !== "string") return null;
  const prop = schema.properties?.[name];
  if (prop && prop.type !== undefined && prop.type !== "string") return null;
  if (captured.length === 0) return null;
  return { [name]: captured };
}

interface RoutedSkill {
  id: string;
  args: Record<string, unknown>;
}

// The deterministic skill floor (4.5). A `consequential` package (4.9's
// manifest field) "raises the routing bar": it only fires on a real
// pattern match, never on a fuzzy example score, however high. Among
// everything that clears its own bar, the highest-scoring candidate wins
// (a pattern match always outranks a fuzzy one); a tie between two pattern
// matches goes to whichever package sorts first by id (loadAllManifests()'s
// deterministic order), a deliberately simple tie-break, not a claim of
// ranking by pattern specificity.
function route(text: string, actor: PersonRow, loaded: LoadedManifest[]): RoutedSkill | null {
  let best: { id: string; args: Record<string, unknown>; score: number } | null = null;

  for (const { id, manifest } of loaded) {
    if (!meetsMinRole(actor.role, manifest.min_role)) continue;

    for (const pattern of manifest.routing?.patterns ?? []) {
      const captured = matchPattern(text, pattern);
      if (captured === null) continue;
      const args = deterministicArgs(manifest.args, captured);
      if (!args) continue;
      if (!best || best.score < 1) best = { id, args, score: 1 };
    }

    if (manifest.consequential) continue; // examples alone never clear a raised bar
    const score = exampleScore(text, manifest.routing?.examples);
    if (score >= EXAMPLE_MATCH_THRESHOLD) {
      const args = deterministicArgs(manifest.args, null);
      if (!args) continue; // a fuzzy match has no capture to bind a required arg to
      if (!best || best.score < score) best = { id, args, score };
    }
  }

  return best ? { id: best.id, args: best.args } : null;
}

/** Runs one conversation turn end to end: safety first, then the
 * deterministic skill floor, then the chat model as the phrasing fallback. */
export async function runTurn(
  actor: PersonRow,
  surface: Surface,
  text: string,
  opts: { thinking?: boolean } = {},
): Promise<TurnOpResult> {
  if (!IMPLEMENTED_SURFACES.has(surface)) {
    return {
      ok: false,
      status: 400,
      code: "unsupported_surface",
      error: `the ${surface} surface is not implemented on this host build yet (4.5)`,
    };
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, status: 400, code: "invalid_input", error: "text is required" };
  }

  const safety = evaluateSafety(text, actor.role as Role);
  let value: TurnValue;

  if (safety.action === "refuse") {
    value = { reply: { text: REFUSAL_TEXT }, source: "safety_refuse", safety };
    logTurn(actor, surface, text, value);
    return { ok: true, value };
  }
  const crisisResources = safety.action === "allow_with_resources" ? CRISIS_RESOURCES_TEXT : undefined;
  const loaded = loadAllManifests(); // one catalog scan, shared below

  const routed = route(text, actor, loaded);
  if (routed) {
    const result = runSkill(routed.id, actor, routed.args);
    if (result.ok) {
      const reply = result.value.reply ?? { text: "Done." };
      value = { reply, source: "skill", skill_id: routed.id, safety, crisis_resources: crisisResources };
    } else {
      // A pre-filtered deterministic match failing at runSkill is a real,
      // if rare, gap (a role change or a bad manifest between the router's
      // check and the run); surfaced as a plain apology rather than leaking
      // the internal error string to a household member, logged for anyone
      // debugging it. Deliberately `ok: true`, not `ok: false`: the turn
      // engine successfully produced a reply for the person, same as the
      // safety_refuse and model paths, and a real HTTP error here would hand
      // a chat surface a raw error to render mid-conversation instead of a
      // spoken apology. A review (2026-09-04) flagged that this makes a
      // failed skill run indistinguishable from a real success to a caller
      // branching on `.ok` alone: `source: "skill_error"` on the returned
      // `TurnValue` is the intended way to detect it (routes/turn.ts's own
      // JSON body carries it straight through), not the top-level `ok` flag.
      console.log(`[turn] skill ${routed.id} matched but failed to run: ${result.error}`);
      value = {
        reply: { text: "Sorry, I couldn't do that." },
        source: "skill_error",
        skill_id: routed.id,
        safety,
        crisis_resources: crisisResources,
      };
    }
  } else {
    const memoryMatches = recall(actor, text);
    const systemPrompt = buildSystemPrompt(memoryMatches, loaded);
    const completion = await complete(
      "chat",
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      { thinking: opts.thinking },
    );
    if (!completion.ok) {
      return { ok: false, status: 503, code: "unavailable", error: completion.error };
    }
    value = { reply: { text: completion.value.text }, source: "model", safety, crisis_resources: crisisResources };
  }

  logTurn(actor, surface, text, value);
  return { ok: true, value };
}

// Not built this pass, deliberately (see docs/dev.md):
// - Every surface but `chat` (overlay, pod, robot, tv, phone).
// - Tier 2 native tool calling: the model choosing and calling a skill
//   when the deterministic floor doesn't clear (needs the chat contract's
//   tools support, deferred in spec/llm/README.md, and a real engine).
// - Remote candidates when no local skill clears the bar (no remote
//   backend configured anywhere in this repo).
// - `ask`-continuation: SkillResult.ask exists in the spec (result.schema.json)
//   but the recipe interpreter has no step that ever produces one
//   (runRecipe always sets `reply`, never `ask`), an interpreter-level gap
//   the same shape as the scheduler's input-carrying gap and
//   host.llm.complete's sync/async gap. Nothing routes a follow-up
//   deterministically today.
// - A real Persona/style record (3.1 lists the type; nothing implements
//   it yet): the system prompt's persona/rules line is a fixed default.
// - Cross-surface context and 90-day summarization (4.14: conversation
//   history itself is real now, see lib/conversationHistory.ts; a turn's
//   own *reasoning* is still stateless beyond what memory.recall()
//   surfaces fresh, the recalled history isn't fed back into the prompt
//   as prior conversational context yet).
