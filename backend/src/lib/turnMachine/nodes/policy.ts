import { GENERATE_MUSIC_TOOL_ID, EDIT_MUSIC_TOOL_ID, musicAudienceOf, musicRefusalFor } from "@/lib/music/tool";
// U2c, the `policy` node (turn-machine-state-record-2026-09-22.md's
// state table): each ActionProposal against the manifest's min_role,
// consequential, permissions; the grounding of the arguments against
// the context list (a set check, not a judgment); the household-subject
// rule for a search; temporary mode (no memory:write); the crisis state
// (no lookups). A side-effecting proposal still needs a consent or a
// confirmation - CONSENT_WORD/AFFIRMATIVE_RE stay deterministic on
// purpose (RULES-AND-LEARNED-COMPONENTS.md); this node only decides
// WHETHER to ask, never reads a "yes" itself (turnNext.ts's own
// continuation handling does, before `safety`, per the state record).
import { loadManifestOnly } from "@/lib/plugins";
import { speakerNamedAny } from "@/lib/subjects";
import { tokenize, wordsOf, isBarePronoun } from "@/lib/text";
import { READ_ITEM_TOOL_ID, itemRefsIn } from "@/lib/items/tool";
import { START_PROJECT_TOOL_ID, projectParamsOf, projectTypeForArgs, validateProjectParams, type StartProjectArgs } from "@/lib/projects/tool";
import { sentenceInitial } from "@/lib/projects/projectTypes";
import type { Node, ActionProposal, PolicyDecision, ToolCall, TurnState } from "../contract";
import { speakerIsAnonymous, turnAgeBand } from "../speaker";
import { modelFacingArgs } from "./tool";
import { OWN_WORDS_CALL_ID } from "./model";
import { GENERATE_IMAGE_TOOL_ID, audienceOf, refusalFor } from "@/lib/pictures/tool";
import { GENERATE_VIDEO_TOOL_ID, videoAudienceOf, videoRefusalFor } from "@/lib/videos/tool";
import { decide } from "@/lib/gate/decide";
import type { Role } from "@/middleware/auth";
import { brakeFor, type BrakeTool, type BrakeMode } from "@/lib/toolBrake";
import { getHouseholdSettingValue } from "@/lib/settings";
import { recordToolAudit } from "@/lib/toolAudit";
import { LIST_ACTIONS } from "@/lib/listActions";

export interface PolicyInput {
  calls: readonly ToolCall[];
  /** Continuations (turn-machine-state-record's own "an affirmative
   * re-enters at policy with the stored proposal marked confirmed"):
   * the tool/args this turn's "yes" already confirmed, from the
   * pending ask turnNext.ts read before `safety`. A call matching this
   * proposal's tool skips the consent/confirm checks below entirely -
   * asking twice for the same action would be the stuck-question
   * failure REPLY-FIND-01 already named, just moved to a new node. */
  preConfirmed?: ActionProposal;
}

/** One call's own proposal and decision, paired by construction rather
 * than by matching index across two parallel arrays - a decision that
 * refused before a proposal was even built (min_role, an unknown tool)
 * still gets a placeholder proposal here so `machine.ts` never has to
 * guess which proposal a given decision was about. */
export interface PolicyEntry {
  proposal: ActionProposal;
  decision: PolicyDecision;
}

export interface PolicyOutput {
  entries: PolicyEntry[];
}

function gateRefusalReason(reason: import("@/lib/gate/types").DenyReason): Extract<PolicyDecision, { allow: false }>["reason"] {
  if (reason === "crisis_state") return "crisis_state";
  if (reason === "anonymous_speaker") return "anonymous_speaker";
  if (reason === "temporary_mode") return "temporary_mode";
  if (reason === "needs_parent_unavailable") return "parent_required";
  // Keep the legacy policy line for both a role floor and a capability
  // the band may never use; no new parent-approval path is implied.
  return "min_role";
}

/** The owner's ruling (state record, "Grounding, stated exactly",
 * 2a28e4e8), after a live run caught the original substring version
 * refusing every real, naturally-reworded search query ("president of
 * Chile 2026" is not a substring of "who is the president of chile",
 * so it always refused): a string argument passes when it shares at
 * least one CONTENT TERM (case-folded, stop words dropped - the same
 * tokenize() guards.ts's own repeat guard already uses, reused rather
 * than a second tokenizer) with the source texts; a number, year or
 * date never counts against it (dropped before the overlap check, so
 * an arg that is nothing but digits neither passes nor fails on its
 * own weight); refuse exactly two things - a bare pronoun as the WHOLE
 * argument (unresolved: "he", "it", not a real query), and zero
 * overlap with every non-numeric term dropped. */
// rule: grounding.pure_number (docs/plans/turn-machine-state-record-2026-09-22.md, "Grounding, stated exactly", 2a28e4e8)
const PURE_NUMBER_RE = /^\d+$/;

// Quotes, brackets and sentence punctuation the model may leave around an item id; not a policy rule, so no regex.
const ITEM_QUOTING = "\"'<>()[].,;:!? \t\n";
function trimItemQuoting(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && ITEM_QUOTING.includes(text[start]!)) start += 1;
  while (end > start && ITEM_QUOTING.includes(text[end - 1]!)) end -= 1;
  return text.slice(start, end);
}

/** GROUND-01 step 2 ("Ground the query, not every field"): the shape a
 * manifest's `args` JSON Schema carries for one property - only what
 * this function reads from it, never a schema validator of its own
 * (validatePackageArgs()/Ajv already own real schema validation
 * elsewhere; this is a term-overlap decision, not a shape check).
 *
 * A review of the first cut of this file caught it reading the design
 * record's own `search_text: true` mark as an OPT-IN gate (only a
 * marked field is ever checked) - that shape is exactly right for
 * websearch, whose manifest is the only one that carries the mark
 * today, but it silently switched every OTHER package's string
 * arguments (remember's `fact`, recall's/knowledge's `topic`, music's
 * `query`, define's `word`, ...) from "checked" to "never checked,"
 * since "the executor's own exact-match validation" the record names
 * for identifiers, recipients, quantities and durations does not
 * actually exist anywhere in this codebase as a distinct mechanism
 * (`validatePackageArgs()` is JSON-Schema shape validation only - type,
 * required, enum - never "does this value relate to what the person
 * said"). Shipping the literal opt-in reading would have quietly
 * removed the anti-hallucination check from every package but one.
 * Fixed here to the reading that actually matches "ground the query,
 * not every field": a string argument is checked by DEFAULT (the
 * original behavior, preserved for every package that isn't
 * websearch), and only a manifest's own schema-typed fields - enum or
 * boolean, values the manifest supplies rather than the person - are
 * exempt. `search_text` is kept as a mark a manifest MAY still carry
 * (websearch's `expression` does) for a future, more precise per-field
 * policy; nothing here requires it. */
interface ArgPropertySchema {
  type?: string;
  enum?: readonly unknown[];
  /** `false`: the manifest declares this field the model's own label, never
   * the person's words (show_images' `kind`: "person", "building"), so it is
   * not checked for term overlap. The field that carries the person's words
   * (the subject, the query) is still checked. ANSWER-IMG-06. */
  grounded?: boolean | "conversation";
}
interface ArgSchema {
  properties?: Record<string, ArgPropertySchema>;
}

// isBarePronoun() moved to @/lib/text.ts (CONFIRM-01): nodes/model.ts's
// own offeredButInvalid check needs the identical test, so it lives
// where both can import it. The `terms.length === 0`
// branch below is for a genuinely numbers-only argument, not a
// punctuation-dressed pronoun - isBarePronoun() is checked first,
// ahead of it, for exactly that reason.

/** GROUND-01's own live capture (data-scratch/ground-01-capture.md):
 * `{ expression: "president of chile", category: "images", read_page:
 * false }` against "who is the president of chile" refused on
 * `category` - an enum value the manifest itself supplies, never
 * something the household said, checked for term overlap anyway
 * because the old version treated "every string argument" as a search
 * query. This is the actual result: which field failed, `undefined`
 * when every field grounds (or nothing needed grounding at all). */
interface GroundingCheck {
  ok: boolean;
  /** The refusing argument's name only - never checked in a test,
   * never logged with the value (the state record's own "terms are the
   * person's data" ruling). */
  arg?: string;
}

/** CF-SEARCH-01 (live, 2026-10-17): "is cloud flare down right now" made the model write the query
 * "Cloudflare outage status October 17 2026". The person typed two words ("cloud flare"), the model
 * wrote the one real name, and exact-term overlap saw nothing in common, so a correct search call was
 * refused as ungrounded and the fixed "I won't guess" line replaced the answer. Two terms are the same
 * name when they differ only by spacing ("cloud flare" / "cloudflare", "git hub" / "github") or by one
 * typo letter. Both need a term of 6 or more letters, so a short word never matches loosely. */
const LOOSE_MATCH_MIN = 6;
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  const restA = a.slice(a.length === b.length ? i + 1 : a.length > b.length ? i + 1 : i);
  const restB = b.slice(a.length === b.length ? i + 1 : a.length > b.length ? i : i + 1);
  return restA === restB;
}
function termGrounded(term: string, sourceTerms: ReadonlySet<string>, sourceSquashed: string, queryTerms: readonly string[]): boolean {
  if (sourceTerms.has(term)) return true;
  if (term.length >= LOOSE_MATCH_MIN) {
    if (sourceSquashed.includes(term)) return true;
    for (const s of sourceTerms) if (s.length >= LOOSE_MATCH_MIN && withinOneEdit(term, s)) return true;
  }
  // The person typed the one word, the model wrote it as two ("cloudflare" typed, "cloud flare" queried).
  const queryJoined = queryTerms.join("");
  for (const s of sourceTerms) if (s.length >= LOOSE_MATCH_MIN && queryJoined.includes(s)) return true;
  return false;
}

function checkGrounding(args: Record<string, unknown>, sourceTexts: readonly string[], schema: ArgSchema | undefined, conversationTexts: readonly string[] = []): GroundingCheck {
  const sourceTerms = tokenize(sourceTexts.join(" "));
  const sourceSquashed = wordsOf(sourceTexts.join(" ")).join("");
  // SEARCH-ANSWER-05: only a field the manifest marks `grounded: "conversation"` also grounds on the
  // recent assistant turns (a follow-up like "show me the poster" names no film; the last reply did).
  const hasWidened = conversationTexts.length > 0 && Object.values(schema?.properties ?? {}).some((p) => p.grounded === "conversation");
  const conversationTerms = hasWidened ? tokenize(conversationTexts.join(" ")) : new Set<string>();
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const prop = schema?.properties?.[key];
    // Enum and boolean fields pass by schema alone (the manifest's own
    // fixed values, never something a person said - "images" is never
    // going to be in the utterance, and checking it there is exactly
    // U2d's live-run defect). A boolean never reaches here as a string
    // value anyway; kept for a schema that declares one loosely. Every
    // other string field is checked, the same as before this fix -
    // that is the actual bug this step closes (category and read_page
    // wrongly checked as if they were free text), not a reason to stop
    // checking anything else.
    if (prop?.enum !== undefined || prop?.type === "boolean") continue;
    if (prop?.grounded === false) continue;
    if (isBarePronoun(value)) return { ok: false, arg: key };
    const terms = [...tokenize(value)].filter((t) => !PURE_NUMBER_RE.test(t));
    if (terms.length === 0) continue; // nothing left but numbers/stopwords - never counts against it
    const widened = prop?.grounded === "conversation";
    const queryTerms = wordsOf(value);
    if (!terms.some((t) => termGrounded(t, sourceTerms, sourceSquashed, queryTerms) || (widened && conversationTerms.has(t)))) return { ok: false, arg: key };
  }
  return { ok: true };
}

export function argsGrounded(args: Record<string, unknown>, sourceTexts: readonly string[], schema?: ArgSchema, conversationTexts: readonly string[] = []): boolean {
  return checkGrounding(args, sourceTexts, schema, conversationTexts).ok;
}

/** SEARCH-ANSWER-05: the last two assistant turns with text in the window (a tool-call-only turn has none and takes no slot), for a manifest field marked
 * `grounded: "conversation"` (show_images' `subject`) alone. Never a tool item
 * (`window-tool-*`) or the system summary, and never read for any other field. */
const CONVERSATION_GROUNDING_TURNS = 2;
function conversationGroundingTexts(context: TurnState["context"]): string[] {
  const assistant = context.filter((item) => item.source === "window" && item.id.startsWith("window-assistant-") && item.text.trim().length > 0);
  return assistant.slice(-CONVERSATION_GROUNDING_TURNS).map((item) => item.text);
}

/** "The utterance, the window's user turns or the hub-said names"
 * (the ruling's own three sources) - narrower than the full context
 * list: a memory or a clock line grounds nothing a model didn't
 * actually say or hear this turn. The roster stands in for "hub-said
 * names" (no name-extraction from the hub's own prior turns exists -
 * every real pronoun-resolution case is a household member's name,
 * which the roster already carries). */
function groundingSourceTexts(utterance: string, context: TurnState["context"]): string[] {
  const texts = [utterance];
  for (const item of context) {
    if (item.source === "roster") texts.push(item.text);
    if (item.source === "window" && item.id.split("-")[1] === "user") texts.push(item.text);
  }
  return texts;
}

function rosterNames(contextItems: readonly { source: string; text: string }[]): string[] {
  return contextItems.filter((c) => c.source === "roster").map((c) => c.text);
}

function placeholderProposal(tool: string, call: ToolCall): ActionProposal {
  return { kind: "read_only", request: { tool, args: (call.args ?? {}) as Record<string, unknown>, callId: call.id ?? tool } };
}

// MANIFEST-REFUSAL-01: the same caution GENFAIL-01 already applies to
// the model node's own engine diagnostic text (contract.ts's own
// NodeOutcome doc) - `loaded.error` is a Zod message about the
// manifest's OWN shape, never a household member's words, but it is
// still persisted to the household's DB and served over the wire, so
// it gets the identical 2000-char cap nodes/model.ts's own
// boundedGenerationError() applies before trusting an engine's error
// body. Not imported from there (that function isn't exported, and
// this node doesn't own model.ts) - the same bound, kept in sync by
// the constant's value, not by a shared function.
const MAX_POLICY_ERROR_CHARS = 2000;
function boundedPolicyError(message: string): string {
  return message.slice(0, MAX_POLICY_ERROR_CHARS);
}

export const policyNode: Node<PolicyInput, PolicyOutput> = async (state, input) => {
  const entries: PolicyEntry[] = [];
  // GROUND-01 ("1. Split the reason"): the trace's own record of "the
  // branch and the argument name, never the terms" - the first refusal
  // this call produces, whichever kind. One node execution covers every
  // proposal this turn, so the node-level outcome below can only speak
  // for the first refusal; every entry's own PolicyDecision (returned
  // in `output.entries`) still carries its own full reason regardless.
  let firstRefusal: { code: string; arg?: string; message?: string } | undefined;
  const noteRefusal = (code: string, arg?: string, message?: string): void => {
    if (firstRefusal) return;
    firstRefusal = { code, ...(arg !== undefined ? { arg } : {}), ...(message !== undefined ? { message } : {}) };
  };

  // "The model's own tool arguments as the query, grounded against the
  // window, not the line" (U2's brief), stated exactly by the owner's
  // ruling (state record, "Grounding, stated exactly", 2a28e4e8): the
  // utterance, the window's user turns, or the hub-said names (the
  // roster stands in for the last - see groundingSourceTexts()) - a
  // first-turn query like "president of Chile 2026" grounds against
  // THIS utterance (sharing "president"/"chile"); a follow-up's query
  // grounds against the window's prior user turn instead.
  const sourceTexts = groundingSourceTexts(state.utterance, state.context);
  const roster = rosterNames(state.context);
  const conversationTexts = conversationGroundingTexts(state.context);

  for (const call of input.calls) {
    // PROJECT-START-01: `start_project` is never a real package (tool.ts's
    // own header), so it never goes through loadManifestOnly() below -
    // its classification comes from the NAMED project type's own registry
    // entry instead (the design record: "min_role from the project
    // type's manifest... consequential per the type's manifest, the tool
    // doesn't hardcode it"), keyed by this call's own `type` argument
    // rather than by the tool id, since what start_project actually DOES
    // depends on which type it's starting, not on the fact that
    // something starts it. GROUND-01's own term-overlap grounding check
    // is deliberately not run here (below): it operates on top-level
    // string arguments, and a project's real parameters live nested
    // under `params`, which a future project type with a real household-
    // fact-shaped field should ground itself, inside its own `text` step
    // prompts - a gap named, not silently inherited from the generic path
    // by accident.
    if (call.tool === START_PROJECT_TOOL_ID) {
      const projectType = projectTypeForArgs(call.args ?? {});
      if (!projectType) {
        noteRefusal("unknown_project_type", call.tool);
        entries.push({ proposal: placeholderProposal(call.tool, call), decision: { allow: false, reason: "unknown_project_type" } });
        continue;
      }
      const args = (call.args ?? {}) as Record<string, unknown>;
      const proposal: ActionProposal = { kind: projectType.consequential ? "side_effecting" : "read_only", request: { tool: call.tool, args, callId: call.id ?? call.tool } };
      const gate = decide({ who: { personId: state.actor.id, role: state.actor.role as Role, band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId), anonymous: speakerIsAnonymous(state) }, what: { capabilities: ["artifact:write"], consequential: projectType.consequential, minRole: projectType.minRole }, context: { crisis: state.crisis, temporary: state.temporary } });
      if (gate.kind === "deny") {
        const reason = gateRefusalReason(gate.reason);
        noteRefusal(reason);
        entries.push({ proposal, decision: { allow: false, reason } });
        continue;
      }
      // Live 2026-10-06: a runaway generation sent { title, author } for a
      // type whose schema requires `topic`, and the household was asked
      // "Want me to create it?" for a call that a yes could only fail. A
      // call whose params fail the type's own schema is never parked as a
      // confirm: it is let through to run, where runStartProjectTool()'s
      // identical check fails it as invalid_params before anything starts,
      // so the T5 retry round still gives the model one chance to fix it.
      const paramsValid = validateProjectParams(projectType, projectParamsOf(args as StartProjectArgs)) === null;
      // No temporary_mode refusal here (unlike an ordinary
      // memory:write-permissioned package below): the design record's
      // own ruling is that a project started from an incognito or
      // temporary thread is ALLOWED ("its artifact is the point and is
      // durably wanted"), never blocked the way saving a fact is.
      const isPreConfirmed = input.preConfirmed?.request.tool === call.tool && JSON.stringify(input.preConfirmed.request.args) === JSON.stringify(args);
      if (gate.kind === "ask_parent") {
        noteRefusal("parent_required");
        entries.push({ proposal, decision: { allow: false, reason: "parent_required" } });
        continue;
      }
      if (!isPreConfirmed && gate.kind === "ask_self" && paramsValid) {
        noteRefusal("confirm_needed");
        // Jesse found live (2026-09-27): "Start Bedtime storybook?" reads
        // as a bare yes/no with no reason given - `consequential` is
        // exactly "spends real compute for minutes" (this file's own
        // ProjectType doc comment), so the ask should say that plainly,
        // the actual reason a project asks at all (an instant project
        // type would never reach this branch). No precise number here on
        // purpose: the params passed the schema check above, but the plan
        // is only built when the project starts, and tool.ts's own real,
        // ceiling-backed `durationLabel()` names the honest number then.
        entries.push({ proposal, decision: { allow: false, reason: "confirm_needed", ask: { prompt: `${sentenceInitial(projectType.title)} can take a few minutes to put together. Want me to create it?`, capabilities: ["artifact:write"], consequential: projectType.consequential } } });
        continue;
      }
      entries.push({ proposal, decision: { allow: true } });
      continue;
    }

    // IMGGEN-HOME-01 / IMGGEN-SAFE-01: the picture tool's gates run first and are not a grounding or a consent question.
    // A person who may not make a picture here, or a prompt over one of the two absolute lines, is refused with a fixed
    // reply before any job exists; the Stack is never asked.
    if (call.tool === GENERATE_IMAGE_TOOL_ID) {
      const callArgs = (call.args ?? {}) as Record<string, unknown>;
      const pictureProposal: ActionProposal = { kind: "read_only", request: { tool: call.tool, args: callArgs, callId: call.id ?? call.tool } };
      const refusal = !state.picturesAllowed ? { kind: "denied" as const } : refusalFor(audienceOf(state, false), callArgs);
      if (refusal) {
        const reason = refusal.kind === "denied" ? "picture_not_here" as const : "picture_refused_minor" as const;
        noteRefusal(reason);
        entries.push({ proposal: pictureProposal, decision: { allow: false, reason } });
        continue;
      }
    }

    // NEWS-DISCUSS-TOOL-2026-10-27: `read_item` reads only a reference the person typed in this very message, and only on a turn
    // that was offered it; a guessed or invented reference is refused here, before any reader runs.
    if (call.tool === READ_ITEM_TOOL_ID) {
      const callArgs = (call.args ?? {}) as Record<string, unknown>;
      const itemProposal: ActionProposal = { kind: "read_only", request: { tool: call.tool, args: callArgs, callId: call.id ?? call.tool } };
      // The model may quote the reference with punctuation around it or pass only the id; both name what the person typed.
      const given = typeof callArgs.ref === "string" ? callArgs.ref.trim() : "";
      const typed = itemRefsIn(state.utterance);
      const asked = given ? (typed.find((item) => item.ref === (itemRefsIn(given)[0]?.ref ?? given)) ?? typed.find((item) => item.id === trimItemQuoting(given))) : undefined;
      if (asked) callArgs.ref = asked.ref;
      if (!state.itemReferenceAllowed || !asked) {
        noteRefusal("item_not_here");
        entries.push({ proposal: itemProposal, decision: { allow: false, reason: "item_not_here" } });
        continue;
      }
      entries.push({ proposal: itemProposal, decision: { allow: true } });
      continue;
    }

    // MUSIC-GEN-03: the music offer and both absolute lines bind forged calls too.
    if (call.tool === GENERATE_MUSIC_TOOL_ID || call.tool === EDIT_MUSIC_TOOL_ID) {
      const callArgs = (call.args ?? {}) as Record<string, unknown>;
      const musicProposal: ActionProposal = { kind: "read_only", request: { tool: call.tool, args: callArgs, callId: call.id ?? call.tool } };
      const offered = call.tool === EDIT_MUSIC_TOOL_ID ? state.musicEditAllowed : state.musicAllowed;
      const refusal = !offered ? { kind: "denied" as const } : musicRefusalFor(musicAudienceOf(state, false), callArgs);
      if (refusal) {
        const reason = refusal.kind === "denied" ? "music_not_here" as const : "music_refused_minor" as const;
        noteRefusal(reason);
        entries.push({ proposal: musicProposal, decision: { allow: false, reason } });
        continue;
      }
    }

    if (call.tool === GENERATE_VIDEO_TOOL_ID) {
      const callArgs = (call.args ?? {}) as Record<string, unknown>;
      const videoProposal: ActionProposal = { kind: "read_only", request: { tool: call.tool, args: callArgs, callId: call.id ?? call.tool } };
      const refusal = !state.videosAllowed ? { kind: "denied" as const } : videoRefusalFor(videoAudienceOf(state, false), callArgs);
      if (refusal) {
        const reason = refusal.kind === "denied" ? "video_not_here" as const : "video_refused_minor" as const;
        noteRefusal(reason);
        entries.push({ proposal: videoProposal, decision: { allow: false, reason } });
        continue;
      }
    }

    const loaded = loadManifestOnly(call.tool);
    if (!loaded.ok) {
      // MANIFEST-REFUSAL-01 (fixes #166): a manifest that EXISTS but
      // failed Zod validation (loadManifestOnly's own `code:
      // "manifest_invalid"` on its 400) is a real, diagnosable defect,
      // split from every other loader failure - no such package (404),
      // an unreadable/malformed manifest.json (also 404), or a
      // syntactically invalid id (a DIFFERENT 400, checked before this
      // node ever touches the filesystem) - which all stay
      // `unknown_tool` exactly as before: the ordinary case of a model
      // inventing a tool name, or an infrastructure edge case that
      // isn't "a package's own content is broken." Matched on `code`,
      // never bare `status`, since a syntactically invalid id is ALSO a
      // 400 and must not become `manifest_invalid`. `loaded.error` is
      // the loader's own Zod message - bounded the same way
      // nodes/model.ts's own boundedGenerationError() bounds the
      // engine's diagnostic text before it lands on a NodeOutcome (that
      // function isn't exported and this node doesn't own model.ts, so
      // the same 2000-char cap is applied here directly rather than
      // imported).
      if (loaded.code === "manifest_invalid") {
        noteRefusal("manifest_invalid", call.tool, boundedPolicyError(loaded.error));
        entries.push({ proposal: placeholderProposal(call.tool, call), decision: { allow: false, reason: "manifest_invalid" } });
        continue;
      }
      noteRefusal("unknown_tool", call.tool);
      entries.push({ proposal: placeholderProposal(call.tool, call), decision: { allow: false, reason: "unknown_tool" } });
      continue;
    }
    const manifest = loaded.value;
    if (manifest.id === "alarm" && speakerIsAnonymous(state)) {
      noteRefusal("anonymous_speaker");
      entries.push({ proposal: placeholderProposal(call.tool, call), decision: { allow: false, reason: "anonymous_speaker" } });
      continue;
    }
    const args = (call.args ?? {}) as Record<string, unknown>;
    // FORM-CHAT-HUB-01: the Home-set flags count only when this call is exactly the turn's own pre-confirmed proposal
    // (same tool, same args); a model's call can never carry them.
    const matchesPre = input.preConfirmed?.request.tool === call.tool && JSON.stringify(input.preConfirmed.request.args) === JSON.stringify(args);
    const resumedForm = matchesPre && call.formResume === true && input.preConfirmed?.formResume === true;
    const redactArgs = matchesPre && call.redactArgs === true && input.preConfirmed?.redactArgs === true;
    const proposal: ActionProposal = {
      kind: manifest.consequential ? "side_effecting" : "read_only",
      request: { tool: call.tool, args, callId: call.id ?? call.tool },
      ...(resumedForm ? { formResume: true } : {}),
      ...(redactArgs || resumedForm ? { redactArgs: true } : {}),
    };

    // FORM-CHAT-HUB-01: a package re-run with a form's values is never pre-confirmed: the same role, band, consent and confirm
    // checks as a model call apply (a consequential package parks its own confirm). Only the grounding check is skipped below,
    // because the person's typed values are not in the conversation text by design.
    // Pre-confirmation belongs to the Home-built call only: a later model round that re-issues the same tool and args is not it.
    const isPreConfirmed = !resumedForm && matchesPre && input.preConfirmed?.formResume !== true && (input.preConfirmed?.redactArgs !== true || call.redactArgs === true);
    if (!isPreConfirmed) {
      const householdSubject = call.tool === "websearch" && roster.length > 0 && speakerNamedAny(JSON.stringify(args), roster);
      const gate = decide({ who: { personId: state.actor.id, role: state.actor.role as Role, band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId), anonymous: speakerIsAnonymous(state) }, what: { capabilities: householdSubject ? ["search.household_subject"] : manifest.permissions ?? [], summary: "Search the web for this request.", consequential: manifest.consequential, minRole: manifest.min_role }, context: { crisis: state.crisis, temporary: state.temporary } });
      if (gate.kind === "deny") {
        // MINOR-SEARCH-01b: a child naming a household member in a web search
        // is never allowed; it gets its own line, not the role-floor one.
        const reason = householdSubject && gate.reason === "never_for_band" ? "household_subject_never" as const : gateRefusalReason(gate.reason);
        noteRefusal(reason);
        entries.push({ proposal, decision: { allow: false, reason } });
        continue;
      }
      if (gate.kind === "ask_parent") {
        noteRefusal("parent_required");
        entries.push({ proposal, decision: { allow: false, reason: "parent_required" } });
        continue;
      }
      if (householdSubject && gate.kind === "ask_self") {
        noteRefusal("consent_needed");
        entries.push({ proposal, decision: { allow: false, reason: "consent_needed", ask: { prompt: `Want me to look that up?`, capabilities: ["search.household_subject"], consequential: false } } });
        continue;
      }
      // Grounded on the arguments the call will actually run with: a stray
      // model-set field the tool node strips (websearch's retired
      // `category`, ANSWER-IMG-02) never blocks the call.
      const grounding = resumedForm ? { ok: true as const } : checkGrounding(modelFacingArgs(call.tool, args), sourceTexts, manifest.args as ArgSchema | undefined, conversationTexts);
      if (!grounding.ok) {
        // GROUND-01: the trace records the branch and the argument name, never the terms.
        noteRefusal("ungrounded_args", grounding.arg);
        entries.push({ proposal, decision: { allow: false, reason: "ungrounded_args" } });
        continue;
      }
      if (call.tool === "remind" || call.tool === "timer" || call.tool === "lists") {
        const action = typeof args.action === "string" ? args.action : "";
        const scope = args.scope === "household" || args.list_scope === "household" ? "household" : args.scope === "person" || args.list_scope === "person" ? "person" : undefined;
        const listActions: ReadonlySet<string> = new Set(LIST_ACTIONS);
        const brakeTool: BrakeTool = call.tool === "remind" && listActions.has(action) ? "lists" : call.tool as BrakeTool;
        const rawMode = getHouseholdSettingValue(`tools.${brakeTool}.mode`);
        const mode: BrakeMode = rawMode === "ask" || rawMode === "never" ? rawMode : "do";
        const itemCount = typeof args.itemCount === "number" ? args.itemCount : typeof args.item_count === "number" ? args.item_count : Array.isArray(args.items) ? args.items.length : undefined;
        const brake = brakeFor({ tool: brakeTool, action, args, itemCount, actor: { id: state.actor.id, role: String(state.actor.role), band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId) }, listScope: scope, tainted: state.context.some((item) => item.source === "search_result" || item.source === "page"), mode });
        const auditBand = turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId);
        recordToolAudit({ personId: state.actor.id, tool: brakeTool, action, decision: brake.decision, band: auditBand });
        if (brake.reason === "parent_required") {
          noteRefusal("parent_required");
          entries.push({ proposal, decision: { allow: false, reason: "parent_required" } });
          continue;
        }
        if (brake.decision === "never") {
          noteRefusal(brake.reason ?? "min_role");
          entries.push({ proposal, decision: { allow: false, reason: "min_role" } });
          continue;
        }
        if (brake.decision === "ask") {
          const prompt = action === "delete_list" || action === "clear_list"
            ? `Delete this list and its ${itemCount ?? 0} items?`
            : itemCount !== undefined && itemCount > 5
              ? `Change ${itemCount} items?`
              : `Go ahead and ${manifest.display.toLowerCase()}?`;
          noteRefusal("confirm_needed");
          entries.push({ proposal, decision: { allow: false, reason: "confirm_needed", ask: { prompt, capabilities: manifest.permissions ?? [], consequential: manifest.consequential } } });
          continue;
        }
      }
      if (gate.kind === "ask_self") {
        noteRefusal("confirm_needed");
        entries.push({ proposal, decision: { allow: false, reason: "confirm_needed", ask: { prompt: `Go ahead and ${manifest.display.toLowerCase()}?`, capabilities: manifest.permissions ?? [], consequential: manifest.consequential } } });
        continue;
      }
    }

    entries.push({ proposal, decision: { allow: true } });
  }

  const retried = input.calls.some((c) => c.id === OWN_WORDS_CALL_ID);
  const outcome = firstRefusal ? { ok: false as const, code: firstRefusal.code, arg: firstRefusal.arg, message: firstRefusal.message } : { ok: true as const, ...(retried ? { retried_with_user_words: true } : {}) };
  return { outcome, output: { entries } };
};
