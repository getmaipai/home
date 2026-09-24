// The first real slice of the "Persona/style record" gap turnEngine.ts's
// own comment has named since before this file existed (3.1 lists the
// type; nothing implemented it). Jesse, 2026-09-05, after the humanistic-
// speech work landed: "work on persona as that ties into humanistic
// speech (can have humanism without a persona)" - then, correcting
// himself - "humanism requires persona." That reframing is this file's
// actual thesis: `turnEngine.ts`'s old NATURAL_REGISTER_POLICY wasn't
// "no persona," it was one fixed, unnamed, un-editable persona. This
// makes that explicit: everything now goes through ONE composition
// mechanism (`composePersonaPrompt`), and what shipped before becomes
// `DEFAULT_PERSONA`, not a separate code path.
//
// Deliberately NOT a database table or a selection/authoring UI: those
// are real, larger, separate gaps (see docs/dev.md's "Notes for later"
// persona research entry). A per-person settings key picks one, and a
// composer function renders the pick into a system-prompt fragment.
//
// The catalog itself IS a spec-shaped record now (step 8, session-a-
// intelligence.md): "companions are packages" - `kind: "companion"`
// already existed in manifest.schema.json's own enum before this file
// ever named it. `PERSONAS` below is read from every bundled
// `kind: "companion"` package's own `manifest.json` (via
// `lib/plugins.ts`'s `loadManifestOnly()`, not `loadPackage()` - a
// companion has no `recipe.json` at all, it's never run) rather than
// hardcoded here, so bundling a fifth companion package is most of the
// change needed to add one; this file only composes what a manifest
// already declared. NOT the whole change, though (a code review,
// 2026-09-05, found this comment overclaiming it): `persona.active_id`'s
// settings-key `range.options` list (spec/settings/keys.json) is a
// committed, hand-regenerated snapshot, not read live from `PERSONA_IDS`
// - `bun run gen:settings` in backend/ still has to run and its result
// still has to be committed, the identical friction adding any other
// settings-key option already has, or `PUT /settings` for the new id
// gets rejected as "must be one of [...]" against the stale list.
//
// Structured dimensions only, no freeform "backstory"/"interests" field:
// the research this session did (docs/dev.md, both the legacy-mining and
// the real web-research pass) is honest that freeform persona-authored
// identity needs its own consistency story this pass doesn't have use
// for yet (nothing surfaces it, and legacy's own lesson was that a
// freeform backstory needs to be paired with real conversational memory
// of it to avoid "inventing a new past every time" - moot when there's
// no authoring UI to write one into in the first place). Four dimensions
// for v1 (formality, complexity, engagement, filler_density), covering
// Jesse's own named examples (a formal tutor, a five-year-old, a slang-
// heavy teenager, a nurturing grandmother) without the larger surface
// area the research brief's own taxonomy named as real but not yet
// validated against this codebase (regional dialect - real, but risks
// caricature if rushed, needs its own careful pass; candor - deliberately
// kept OUT of this file because it sits right next to the org's non-
// removable child-safety invariants, `.github/CLAUDE.md`'s Safety
// invariants section, and needs its own explicit reconciliation rule,
// not a value dropped in beside three harmless ones).
import { listPackageIds, loadManifestOnly } from "@/lib/plugins";
import type { SurfaceClass } from "@/lib/surfaceClass";

export interface Persona {
  id: string;
  display_name: string;
  formality: "casual" | "neutral" | "formal";
  complexity: "simple" | "standard" | "advanced";
  /** How much a persona probes vs. lets something go (Jesse's own
   * example: a "mother" persona asks concerned follow-ups, a "teenager"
   * persona says "that sucks" and moves on). Named in the dialogue-
   * systems literature as closer to "mixed-initiative interaction" than
   * a personality trait (docs/dev.md's research entry). */
  engagement: "brief" | "balanced" | "curious";
  /** NOT literal disfluency insertion into confident answers - the
   * research this session did is explicit that prompted "um"s in a
   * confident reply measurably lower perceived confidence
   * (replyVariation.ts's own comment on why fillers live in the delay-
   * gated cue instead). This controls casual discourse-marker density
   * ("honestly," "I mean," "like") the sociolinguistics research found
   * serves a real stance/emphasis function in teen speech specifically,
   * not meaningless hesitation noise. */
  filler_density: "none" | "light" | "frequent";
  /** 3 to 5 lines in the character's own voice (manifest.schema.json's
   * own field), composed as a short few-shot block by
   * `composePersonaPrompt()` below - legacy's own finding, "the single
   * biggest lever for small-model voice fidelity." Optional here only
   * because Zod's `.optional()` on the generated companion schema allows
   * it; every bundled companion package actually sets it. */
  examples?: readonly string[];
  /** STATUS-PHRASES-01: this companion's own waiting-line phrases
   * (manifest.schema.json's own `companion.status_phrases`), one moment
   * at a time - `statusPhrases.ts`'s `pickStatusPhrase()` falls back to
   * `vocab/status-phrases.json`'s default set for a moment this leaves
   * out (or when it's undefined entirely, the common case: no bundled
   * companion package declares one yet). */
  status_phrases?: { thinking?: readonly string[]; searching?: readonly string[]; checking?: readonly string[] };
}

// Read once at module load, the same "bundled packages are static this
// pass, no install flow yet" assumption `lib/plugins.ts`'s own
// PACKAGES_DIR scan already makes (unlike `loadAllManifests()` in
// turnEngine.ts, which re-scans every turn because a plugin's OWN
// recipe can matter mid-session - a companion's voice dials changing
// requires editing a file on disk regardless of when this ran).
// Skips (rather than throws on) a package that fails to load or isn't
// `kind: "companion"`: this file has no business refusing to boot the
// whole hub because one unrelated bundled package is malformed.
function loadPersonaCatalog(): Persona[] {
  const out: Persona[] = [];
  for (const id of [...listPackageIds()].sort()) {
    const loaded = loadManifestOnly(id);
    if (!loaded.ok || loaded.value.kind !== "companion" || !loaded.value.companion) continue;
    const c = loaded.value.companion;
    out.push({
      id,
      display_name: c.display_name,
      formality: c.formality,
      complexity: c.complexity,
      engagement: c.engagement,
      filler_density: c.filler_density,
      examples: c.examples,
      status_phrases: c.status_phrases,
    });
  }
  return out;
}

export const PERSONAS: readonly Persona[] = loadPersonaCatalog();

// Fails loudly, right here, rather than letting a `!`-asserted
// DEFAULT_PERSONA silently be `undefined` and crash with a confusing
// TypeError somewhere far downstream (composePersonaPrompt(undefined),
// say) the first time anything touches it - a code review (2026-09-05)
// found the original version trusted an empty catalog couldn't happen
// without actually guarding it. An empty catalog (PACKAGES_DIR missing,
// unreadable, or genuinely shipping zero companion packages) is exactly
// the kind of misconfiguration that should stop the hub from starting,
// not degrade into "every persona-dependent feature throws."
if (PERSONAS.length === 0) {
  throw new Error('persona.ts: no bundled kind:"companion" package found under backend/packages/ - at least one is required to boot');
}

export const PERSONA_IDS = PERSONAS.map((p) => p.id);
export const DEFAULT_PERSONA_ID = "default";
// Falls back to whatever loaded first when "default" itself is missing
// for some reason - PERSONAS is guaranteed non-empty by the guard above,
// so this non-null assertion is now actually backed by something,
// unlike the version the review above found.
export const DEFAULT_PERSONA: Persona = PERSONAS.find((p) => p.id === DEFAULT_PERSONA_ID) ?? PERSONAS[0]!;

/** Looks a persona id up in the catalog; an unset, unknown, or stale id
 * (a persona removed from the catalog after someone picked it, the
 * settings registry's own `select` validation only guards WRITES, not a
 * value already stored before a catalog change) always falls back to
 * `DEFAULT_PERSONA` rather than producing an empty or broken prompt
 * fragment. */
export function resolvePersona(id: unknown): Persona {
  if (typeof id !== "string") return DEFAULT_PERSONA;
  return PERSONAS.find((p) => p.id === id) ?? DEFAULT_PERSONA;
}

// ── Universal information-handling rules ──────────────────────────────
// Always included, regardless of persona: these are about factual
// precision and honesty, not voice, so no persona should ever be able to
// turn them off by picking a dimension value - the research behind this
// split (docs/dev.md) is that fast, non-drifting persona control needs a
// hard line between what's said (fixed) and how it's said (the only
// thing composePersonaPrompt below varies).
export const INFORMATION_HANDLING_POLICY = [
  "Skip detail nobody asked for (exact decimals, timezones, a full date when only the day matters) and round the way people round in conversation (\"about thirty\", \"low seventies\") unless they asked for the exact number or it genuinely matters, like money or an appointment time.",
  "Talk about anything uncertain or secondhand as uncertain, never as flat fact: forecasts, predictions, and guesses get hedged (\"it's supposed to\", \"I think\", \"probably\"), not asserted outright.",
  // FAST-06 (2026-09-12): the third sentence, "Never say the same thing
  // the same way twice: vary how you open a reply and how you phrase
  // something you've already said earlier in the conversation", is
  // gone. Variety is the sampler's job now (llm.ts's CHAT_SAMPLING:
  // min-p, XTC and DRY), which is cheaper, more predictable, and does
  // not spend a prompt sentence asking a small model to police itself.
].join(" ");

// Step 4 (session-c-brain-and-voice.md): "the before/after framing
// examples... joining the stable prefix." spec/llm/naturalness-corpus.json
// holds the fuller set (rounding, hedged forecasts, flat corrections,
// tiny acknowledgments, brief "I don't know"s) that `scripts/bench/
// naturalness.ts` scores a model and prompt against; these three are the
// ones the plan names by name (time, yes/no, a list), kept in prose here
// rather than loaded from that JSON at runtime for the same reason every
// other prompt fragment in this file is hand-written prose, not a data
// file read at request time - a system prompt fragment is product
// copy, reviewed and versioned like any other, not configuration.
// Universal like INFORMATION_HANDLING_POLICY above: how something is
// said varies by persona, but never saying a clock time or a list back
// like a machine read them off a screen doesn't.
//
// Provisional, not permanent, unlike INFORMATION_HANDLING_POLICY next to
// it: this step's own activation-steering spike (docs/BACKLOG.md,
// docs/dev/session-c.md's step 4 entry) found a trained control vector
// costs meaningfully fewer tokens than paragraph prose for exactly this
// kind of register instruction, and org principle 6 names "a paragraph
// of personality prose instead of activation steering" as the pattern to
// avoid. The spike wasn't a clear enough win to act on yet (its own
// training data didn't isolate naturalness specifically), so this stays
// prose for now - but a future pass replacing it with a vector should
// look here first, not treat this as settled the way the rules above it
// are.
export const NATURALNESS_POLICY =
  'Say things the way a person talking out loud would, not the way a screen would print them: a time is "it\'s three forty-five," never "the current time is 3:45 PM"; a yes/no question gets "yep" or "nope," never "the answer to your question is yes"; a short list gets said as a sentence ("you\'ve got milk, eggs, and bread"), never read back with "the following items:" or bullet points.';

// The reply floor (owner's rule, 2026-09-23, the state record "The
// reply floor"): NATURALNESS_POLICY above is a spoken-class fragment -
// "never bullet points" is right for a voice reply and wrong for a
// typed one, where the bare model's own structure (headings, numbered
// steps, a list) is exactly what a written answer keeps. This is that
// fragment's written twin: the same "say it exactly, don't pad it"
// spirit, permitting and expecting the structure the spoken policy
// forbids.
//
// Not reachable from production's own buildStablePrefix() any more
// (dev.md "The written prompt on tier 1, decided", 2026-09-23): the
// written-adult prompt carries no policy prose at all while
// WRITTEN_VOICE_PROSE (below) is off. Kept exported and defined - a
// code review flagged it as a possible orphan - because PARITY-BISECT-
// 02/03/04's own frozen bench scripts and tests still import and
// compose with it directly, as real historical measurement fixtures,
// not because anything live still reads it.
export const WRITTEN_POLICY =
  "This is a typed reply on a screen, not read aloud: use whatever structure makes it clearest - headings, a numbered list, short paragraphs - the same way a well-written answer to this would be structured anywhere else. Say a time, a fact or a list exactly, the way it reads written down; never pad it into spoken phrasing to avoid structure.";

// PREFIX-CLASS-01 (dev.md "PARITY-BISECT-04: arms e and f, and the
// ruling"): INFORMATION_HANDLING_POLICY and WRITTEN_POLICY above are
// both instructions ("Skip...", "use whatever structure..."); on the
// written class they fold into buildStablePrefix()'s own descriptive-
// voice section as their third-person twins below instead of appending
// as separate instructive sections - the composition PARITY-BISECT-04's
// arm e measured (0.48x/0.37x the bare floor, tier 1's own 0.35x
// acceptance bar). The spoken class keeps INFORMATION_HANDLING_POLICY
// itself untouched, exactly as today.
export const INFORMATION_HANDLING_POLICY_WRITTEN = [
  "Detail nobody asked for (exact decimals, timezones, a full date when only the day matters) is left out, rounded the way people round in conversation (\"about thirty\", \"low seventies\") unless the exact number genuinely matters, like money or an appointment time.",
  "Anything uncertain or secondhand is talked about as uncertain, never as flat fact: forecasts, predictions and guesses get hedged (\"it's supposed to\", \"I think\", \"probably\"), not asserted outright.",
].join(" ");

// WRITTEN_POLICY's own descriptive twin, folded into the written class's
// voice section the same way INFORMATION_HANDLING_POLICY_WRITTEN is.
export const WRITTEN_VOICE_POLICY =
  "Numbers and dates are said exactly as they read written down. Replies on a screen use headings and lists where they make an answer clearest.";

const FORMALITY_FRAGMENT: Record<Persona["formality"], string> = {
  casual:
    "Talk the way a person actually talks in a relaxed conversation, not like a written page being read aloud: use contractions (it's, you're, don't) and keep your phrasing easygoing.",
  neutral:
    "Talk the way a person actually talks, using contractions (it's, you're, don't), in a natural, unforced tone - neither stiff nor overly casual.",
  formal:
    "Speak in complete, well-formed sentences without contractions, the way a careful professional would in conversation: polite and precise, never stiff or robotic.",
};

// PREFIX-CLASS-01 (dev.md "PARITY-BISECT-04: arms e and f, and the
// ruling", the coordinator's own ruling, 2026-09-23): FORMALITY_FRAGMENT
// above is written for the ear, its own written twin below WAS an
// instruction to write "a relaxed message" - PARITY-BISECT-02 measured
// that "relaxed message" framing alone makes an 8B answer in all
// lowercase (the register bug), independent of PARITY-BISECT-03/04's
// separate finding that nearly any second-person instruction in the
// stable prefix collapses this model's reply length. The fix for both
// findings at once, on this fragment and on COMPLEXITY_FRAGMENT_WRITTEN/
// ENGAGEMENT_FRAGMENT_WRITTEN/FILLER_FRAGMENT_WRITTEN below: describe the
// reply's own voice in the third person ("The reply reads in...") rather
// than instruct the model to produce it ("Write in..."), naming a tone
// rather than a message. This is PARITY-BISECT-04's own arm e
// composition (measured 0.48x/0.37x the bare floor, 0/5 lowercase on
// both questions, tier 1's own 0.35x acceptance bar), promoted from the
// bench script to real production text, not new untested copy.
// Exported alongside COMPLEXITY_FRAGMENT_WRITTEN/ENGAGEMENT_FRAGMENT_
// WRITTEN/FILLER_FRAGMENT_WRITTEN below (PARITY-BISECT-02): scripts/
// bench/parity-bisect2.ts isolates each stable-prefix fragment's own
// marginal effect on a written reply's length, one at a time - it needs
// the exact real fragment text, never a re-typed copy that can drift.
export const FORMALITY_FRAGMENT_WRITTEN: Record<Persona["formality"], string> = {
  casual: "The reply reads in a relaxed, friendly tone, with contractions (it's, doesn't, isn't).",
  neutral: "The reply reads in a natural, unforced tone, with contractions, neither stiff nor overly casual.",
  formal: "The reply reads in complete, well-formed sentences without contractions, polite and precise, never stiff or robotic.",
};

export const COMPLEXITY_FRAGMENT: Record<Persona["complexity"], string> = {
  simple:
    "Use short sentences and everyday words a young child would understand, and explain anything unfamiliar in the simplest possible terms.",
  standard: "Use plain, everyday language: no unexplained jargon, no unnecessarily complex sentence structure.",
  advanced:
    "You may use precise, subject-specific vocabulary and more nuanced sentence structure when it genuinely helps explain something well.",
};

// PREFIX-CLASS-01's own written twin of COMPLEXITY_FRAGMENT above -
// COMPLEXITY_FRAGMENT itself had no written variant before this; the
// spoken one is instructive ("Use..."), this one describes the reply's
// own vocabulary the same descriptive way FORMALITY_FRAGMENT_WRITTEN
// does, for the same reason (PARITY-BISECT-03/04: an instruction in the
// stable prefix collapses this model's reply length on its own).
export const COMPLEXITY_FRAGMENT_WRITTEN: Record<Persona["complexity"], string> = {
  simple: "The reply uses short sentences and everyday words a young child would understand, explaining anything unfamiliar in the simplest possible terms.",
  standard: "The reply uses plain, everyday language: no unexplained jargon, no unnecessarily complex sentence structure.",
  advanced: "The reply may use precise, subject-specific vocabulary and more nuanced sentence structure when it genuinely helps explain something well.",
};

// A code review (2026-09-05) found the old NATURAL_REGISTER_POLICY's
// explicit length cap ("keep most replies to a sentence or two") had no
// replacement once its one sentence got split across formality and
// engagement - every household member who never touches persona.active_id
// (the common case, DEFAULT_PERSONA's own `engagement: "brief"`) silently
// lost brevity control entirely. Restored here, since length is really an
// engagement-adjacent concern (how much room a reply takes up tracks how
// much it's allowed to wander), with each level keeping its own
// proportional cap rather than only "brief" getting one.
const ENGAGEMENT_FRAGMENT: Record<Persona["engagement"], string> = {
  brief:
    'Keep replies to a sentence or two, and answer the exact question then stop: no restating it back, no "let me know if you need anything else," no follow-up question tacked on.',
  balanced:
    "Keep replies short, usually just a few sentences: answer the question directly, and offer one natural follow-up only if it would genuinely help, never as a matter of habit.",
  curious:
    "Keep it natural and not too long: when they share something personal or emotional, show you noticed - ask a brief, genuine follow-up or say something caring before moving on, the way someone who cares about them would.",
};

// The reply floor (owner's rule, 2026-09-23) plus PREFIX-CLASS-01
// (dev.md "PARITY-BISECT-04: arms e and f, and the ruling"): the
// sentence-count language above is a spoken-class assumption ("a
// sentence or two" measures a voice reply, not a typed one) - on the
// written class, "brief" means no padding and no habit-follow-up, never
// a cap on how complete the answer is allowed to be. Same three
// characters (brief stays the most economical, curious still asks a
// follow-up), the length constraint dropped for all three since a
// written answer's own length already comes from the plan (register.ts's
// writtenBudgetFor), never from this fragment - and, per the ruling,
// described in the third person rather than instructed, the same fix
// FORMALITY_FRAGMENT_WRITTEN above got.
export const ENGAGEMENT_FRAGMENT_WRITTEN: Record<Persona["engagement"], string> = {
  brief:
    "The reply answers the exact question completely, then stops - it never cuts a genuinely complete answer short for the sake of being brief; brief means no padding, not less substance.",
  balanced:
    "The reply answers the question directly and completely, and offers one natural follow-up only if it would genuinely help, never as a matter of habit.",
  curious:
    "The reply answers completely; when someone shares something personal or emotional, it shows that was noticed - a brief, genuine follow-up or something caring before moving on, the way someone who cares would.",
};

export const FILLER_FRAGMENT: Record<Persona["filler_density"], string> = {
  none: "Keep your wording clean and direct, without casual filler phrases.",
  light: 'A little casual phrasing here and there ("honestly," "I mean") is fine, used naturally, never forced.',
  frequent:
    'Talk casually, the way a teenager texting a friend would: casual asides like "honestly," "I mean," and "like" are natural here, used the way a person actually talks, not sprinkled in at random.',
};

// PREFIX-CLASS-01's own written twin of FILLER_FRAGMENT above - no
// written variant existed before this; described in the third person
// for the same reason every other written fragment here now is.
export const FILLER_FRAGMENT_WRITTEN: Record<Persona["filler_density"], string> = {
  none: "The reply's wording is clean and direct, without casual filler phrases.",
  light: 'A little casual phrasing here and there ("honestly," "I mean") reads naturally, never forced.',
  frequent: 'The reply talks casually, the way a text between friends would: casual asides like "honestly," "I mean," and "like" come naturally, not sprinkled in at random.',
};

/** The one persona-composition function (2026-09-05): renders a
 * Persona's four dimensions into one system-prompt fragment, each
 * dimension a single canned sentence - the same "a small number of
 * discrete values, each a hand-written sentence, composed at prompt-
 * build time" shape the old NATURAL_REGISTER_POLICY already used, and
 * the shape the research behind this file found is the one proven way
 * to vary register without a live rewriting pass or a risk of drifting
 * meaning (docs/dev.md's persona research: PERSONAGE, ACL 2007/2008,
 * did exactly this - deterministic, parametrized realization, zero
 * runtime cost). On the spoken class, still never touches
 * INFORMATION_HANDLING_POLICY, which every persona gets identically
 * there; PREFIX-CLASS-01 (below) folds that policy's own written twin
 * in on the written class only, still identical across personas. */
// Step 8's own addition: a short few-shot block of the companion's
// examples, in its own voice - legacy's review named this "the single
// biggest lever for small-model voice fidelity," a stronger signal than
// any amount of prose describing the voice. Quoted, one per line, no
// framing beyond a single label line: kept minimal on purpose (the
// plan's own "keep the prose under about 150 tokens" applies to this
// ADDITION specifically, not to the four dial sentences above it, which
// predate step 8 and already run close to that budget on their own).
// OUT-01: each example is a dash line with no quotation marks. Rendered
// inside double quotes, the model's own closing quote and a reply that
// restated itself inside quotation marks were the prompt's format
// echoed back (the design pass, finding 17).
function examplesBlock(examples: readonly string[] | undefined): string {
  if (!examples || examples.length === 0) return "";
  const lines = examples.map((e) => `- ${e}`).join("\n");
  return ` Some examples of how you talk:\n${lines}`;
}

/** `surfaceClass` defaults "spoken" - the old path's own four call
 * sites (turnEngine.ts, personaJudge.ts) pass nothing and get today's
 * exact wording, frozen; only the new path (messages.ts, via
 * buildStablePrefix's own new parameter) passes "written" explicitly.
 * The spoken branch is byte-identical to before PREFIX-CLASS-01.
 *
 * The reply floor (owner's rule, 2026-09-23): the few-shot voice
 * examples are the spoken voice lever (`examplesBlock`'s own comment:
 * "the single biggest lever for small-model voice fidelity") and are
 * spoken-only - a code review of U4b-2's live measurement found an 8B
 * model handed four short, casual, spoken one-liners alongside the
 * written-mode prose reading them as the stronger signal and writing
 * short and casual despite it. On the written class the voice carries
 * through the formality and engagement fragments alone; a written
 * examples field is a later, spec-first item (WRITTEN-EXAMPLES-01),
 * not this one.
 *
 * PREFIX-CLASS-01, decided (dev.md "The written prompt on tier 1,
 * decided", the coordinator's own design record, 2026-09-23): every
 * shape tried this whole chain that added ANY persona or policy prose
 * to the written-adult prompt measured 0.12x to 0.48x the bare floor;
 * the two shapes that ever cleared close to it (the ceiling, arm e's
 * own no-prose variant) both lacked it entirely. The reading: this 8B
 * treats a written system message with instruction sentences in it -
 * any of them, worded any way, in any role, with or without a plan
 * line - as a cue to answer briefly, dose-dependent on how many
 * sentences it holds. So the written-adult prompt carries no persona
 * voice prose on this tier, full stop, until a prebuilt mechanism
 * exists to vary voice without spending prompt sentences on it
 * (EVAL-03, org principle 6: activation steering over prompt prose -
 * merged from PERSONA-STEER-01, TRUEUP-01, 2026-09-23).
 * WRITTEN_VOICE_PROSE below is that off switch - the written twins
 * above (FORMALITY_FRAGMENT_WRITTEN and the rest) stay declared and
 * exported, kept as the designed fallback (owner, 2026-09-23 evening:
 * offered per tier once the primary, EVAL-03's control vector, has
 * been tested - never a second pass ahead of it). WRITTEN-VOICE-TIER-01
 * turns this on once a bigger tier measures them clearing the bar, but
 * composePersonaPrompt never reaches them while it's false. */
export const WRITTEN_VOICE_PROSE = false;

export function composePersonaPrompt(persona: Persona, surfaceClass: SurfaceClass = "spoken"): string {
  const written = surfaceClass === "written";
  if (written && !WRITTEN_VOICE_PROSE) return "";
  const formality = written ? FORMALITY_FRAGMENT_WRITTEN[persona.formality] : FORMALITY_FRAGMENT[persona.formality];
  const complexity = written ? COMPLEXITY_FRAGMENT_WRITTEN[persona.complexity] : COMPLEXITY_FRAGMENT[persona.complexity];
  const engagement = written ? ENGAGEMENT_FRAGMENT_WRITTEN[persona.engagement] : ENGAGEMENT_FRAGMENT[persona.engagement];
  const filler = written ? FILLER_FRAGMENT_WRITTEN[persona.filler_density] : FILLER_FRAGMENT[persona.filler_density];
  const examples = written ? "" : examplesBlock(persona.examples);
  const voice = [formality, complexity, engagement, filler].join(" ") + examples;
  if (!written) return voice;
  return [voice, INFORMATION_HANDLING_POLICY_WRITTEN, WRITTEN_VOICE_POLICY].join(" ");
}
