import { MUSIC_NOT_HERE_LINE, MUSIC_REFUSAL_LINE } from "@/lib/music/policy";
// U2c, the `answer` node (turn-machine-state-record-2026-09-22.md's
// state table): "the model's final text or the package reply, the
// outcomes' sources, the surface's projection (reply.speech), the
// plan's budget." Three producers feed it (the commands node's package
// reply, the model node's own text, and a second model call's text once tool
// outcomes exist - all folded to the same shape here so `output_gate`
// never has to know which one ran).
import type { Node, ToolExecutionOutcome, PolicyDecision } from "../contract";
import type { Source } from "@maipai/spec/gen/ts/source.js";
import { engineComputerAwayFromHome, failureLine, type FailureKind } from "@/lib/generationFailure";
import { COMPOSE_FAILURE_LINE, pictureForOutcomes, videoForOutcomes, musicForOutcomes } from "@/lib/composer";
import { PICTURE_NOT_HERE_LINE, PROMPT_REFUSAL_LINE } from "@/lib/pictures/policy";
import { VIDEO_NOT_HERE_LINE, VIDEO_REFUSAL_LINE } from "@/lib/videos/policy";
import { startAnswerImages } from "@/lib/answerImages/turn";

/** The reasons `policy` can refuse a proposal WITHOUT parking an ask
 * (consent_needed/confirm_needed always carry one, so machine.ts's
 * `policyHasParkedAsk` guard catches those first - only these ever
 * reach `policyAllRefused` and this node). GROUND-01 split the old
 * single `ungrounded_args` into three ("1. Split the reason", state
 * record): `unknown_tool` (the manifest failed to load) carries its own name, so
 * the trace can tell it apart even though `policyRefusalLine()` below
 * still prints them all as the one honesty line. */
export type PolicyRefusedReason = Exclude<Extract<PolicyDecision, { allow: false }>["reason"], "consent_needed" | "confirm_needed">;

export type AnswerInput =
  | { kind: "immediate"; text: string; speech?: string; language?: string; outcome: ToolExecutionOutcome }
  | { kind: "model_text"; text: string }
  | { kind: "from_outcomes"; text: string; outcomes: readonly ToolExecutionOutcome[] }
  // A code review (2026-09-22) caught `policy`'s own "every proposal
  // refused, nothing parked" exit (machine.ts's policyAllRefused) with
  // no producer here at all - it fell through to the empty-text
  // fallback below, an empty reply where the state table promises "the
  // refusal line for min_role."
  | { kind: "policy_refused"; reason: PolicyRefusedReason }
  // DEADLINE-01: the model node's own generation never finished (a
  // deadline, a dead engine) on a turn where the builder row wasn't a
  // fit either (tool_choice not "required") - a real, honest line,
  // never the empty string this case used to deliver silently.
  | { kind: "model_failed"; failure?: FailureKind };

export interface AnswerOutput {
  text: string;
  speech?: string;
  language?: string;
  sources: Source[];
  /** COMMAND-FAIL-01 (dev.md "The knowledge hijack" (b)): set when
   * `text` was drawn directly from a failed outcome's own `error`/
   * `userMessage` field (the household's own custom command failing,
   * "immediate"; a tool round's own last call failing with nothing
   * else to say, "from_outcomes") - `output_gate`'s own provenance
   * check refuses to deliver it verbatim, the same place and shape as
   * the envelope catch (ENGINE-CONTRACT-03). A pattern outcome's own
   * failure never reaches this node this way any more (it returns
   * `matched: false` instead, commands.ts) - this tag is the
   * structural backstop for every OTHER producer of "immediate"/
   * "from_outcomes" text, present and future, not a single
   * enumerated list of today's callers. */
  provenance?: "outcome_error";
}

/** Three distinct lines plus one shared fallback, not a rule reading a
 * household member's words (RULES-AND-LEARNED-COMPONENTS.md's own
 * target), but the same kind of fixed internal-reason-code-to-text
 * mapping safety.ts's own refusal line and turnNext.ts's blocked line
 * already use. Individual branches, never a literal array, the same
 * reason messages.ts's windowRoleFromId() checks its four roles one at
 * a time (the rule-budget lint's word-list check is syntactic, not
 * semantic - a 3+-string array trips it whatever it holds). GROUND-01:
 * "the refusal line stays one sentence; the trace is what changes" -
 * `ungrounded_args` and `unknown_tool` both
 * fall to the same honesty line on purpose; the branch and the argument
 * name live in `stats.nodes[]`'s `policy` entry instead.
 *
 * MANIFEST-REFUSAL-01 (fixes getmaipai/home#166): `manifest_invalid`
 * (a real package whose manifest failed Zod validation - policy.ts's
 * own split from `unknown_tool`) is NOT the honesty line: the
 * conversation isn't missing anything, something on the hub itself is
 * broken, and saying "I won't guess" told the household the wrong
 * thing entirely during the live incident this fixes. `unknown_tool`
 * (no such package, the ordinary case of a model inventing a tool
 * name) keeps the honesty line - GROUND-01's ruling stands. */
export const PARENT_REQUIRED_LINE = "That needs a grown-up at home to decide. Ask one of them, or ask me something else.";
export const HOUSEHOLD_SUBJECT_NEVER_LINE = "I don't search the web for people in our family. I can tell you what I already know, or you can ask a grown-up at home.";

function policyRefusalLine(reason: PolicyRefusedReason): string {
  if (reason === "parent_required") return PARENT_REQUIRED_LINE;
  if (reason === "household_subject_never") return HOUSEHOLD_SUBJECT_NEVER_LINE;
  if (reason === "picture_not_here") return PICTURE_NOT_HERE_LINE;
  if (reason === "picture_refused_minor") return PROMPT_REFUSAL_LINE.minor_sexual;
  if (reason === "item_not_here") return "I can't open that one from here. Open it in its app and ask again from there.";
  if (reason === "music_not_here") return MUSIC_NOT_HERE_LINE;
  if (reason === "music_refused_minor") return MUSIC_REFUSAL_LINE.minor_sexual;
  if (reason === "video_not_here") return VIDEO_NOT_HERE_LINE;
  if (reason === "video_refused_minor") return VIDEO_REFUSAL_LINE.minor_sexual;
  if (reason === "min_role") return "That one needs a grown-up.";
  if (reason === "temporary_mode") return "I can't save anything in a temporary chat.";
  if (reason === "anonymous_speaker") return "I don't know who's talking yet, so I can't use anyone's memories.";
  if (reason === "crisis_state") return "Let's stay with this for now. I'm here.";
  if (reason === "manifest_invalid") return "I can't do that right now. Something on my end isn't working.";
  return "I don't actually have that in this conversation, so I won't guess.";
}

/** The last-resort line when a lookup was missed and the model wrote no words at all. Says what is
 * missing and what to do (STYLE.md); never the raw error, never a made-up fact. */
/** The reply when the picture or video was started but the words about it could not be written. */
export const PICTURE_STARTED_LINE = "Your picture is being made. It will show up right below when it is ready.";
export const VIDEO_STARTED_LINE = "Your video is being made. It takes about two minutes and will show up right below when it is ready.";

export function missedLookupLine(outcomes: readonly ToolExecutionOutcome[]): string {
  const web = outcomes.some((o) => o.packageId === "websearch");
  return web
    ? "Web search isn't answering right now, so I can't check that. Try again in a little while, or ask me something I can answer without it."
    : "I couldn't look that up just now. Try again in a little while, or ask me something else.";
}

export const answerNode: Node<AnswerInput, AnswerOutput> = async (state, input) => {
  switch (input.kind) {
    case "policy_refused":
      return { outcome: { ok: true }, output: { text: policyRefusalLine(input.reason), sources: [] } };
    case "immediate": {
      // COMMAND-FAIL-01: a failed household custom command still
      // returns `matched: true` with its own error text (lib/commands.ts's
      // runCommand, out of this item's own scope - a Home Assistant
      // failure, never a lookup) - tagged here rather than left for a
      // later node to guess at from the text alone.
      const provenance = input.outcome.status === "failed" ? ("outcome_error" as const) : undefined;
      return { outcome: { ok: true }, output: { text: input.text, speech: input.speech, language: input.language, sources: input.outcome.sources ?? [], provenance } };
    }
    case "model_text": {
      // CHAT-AUTO-LEAD-IMAGE-01: only start after the model has chosen a
      // text answer. A show_images call (or an earlier image pipeline) owns
      // this turn's pictures. Starting here keeps a slow picture host beside
      // output release and never delays the first answer text.
      if (state.pendingAutoLeadImage && state.answerImagesAllowed && !state.answerImages && !state.images?.length && state.outcomes.length === 0) {
        const { subject, kind } = state.pendingAutoLeadImage;
        const lead = startAnswerImages(state, subject, kind, "auto-lead-image", undefined, true);
        // The automatic picture is defined as a lead, so make it available
        // to the placer before any answer text is released. The stream placer
        // holds gated text until this bounded lookup resolves. It cannot fail
        // the answer.
        await lead.done;
        if (state.releaseAutoLeadText) state.releaseAutoLeadText(!!lead.block);
        else state.pendingAutoLeadImage = undefined;
      } else if (state.pendingAutoLeadImage && state.releaseAutoLeadText) {
        // A lead can be disqualified by a tool or another image path after
        // context selected it. Never leave the stream placer holding the
        // model's answer when the lead will not run.
        state.releaseAutoLeadText(false);
      }
      // A live acceptance run (U2d) caught this dropping every tool
      // round's own sources on the floor: the state table's own "the
      // outcomes' sources" is listed as this node's input generally,
      // not only for the "from_outcomes" case below. The common
      // budget.rounds >= 1 turn reaches this "model_text" case too
      // (the model returns to `model` for one more round after a
      // tool call, so `step` there is a fresh ModelOutput text kind),
      // so both cases need the same merge - a review caught an
      // earlier draft of this comment claiming "from_outcomes" was
      // near-unreachable, which is wrong.
      // `state.outcomes` already carries every tool this turn ran, in
      // order, across every round, so flatMap-ing it here is safe
      // either way.
      const sources = state.outcomes.flatMap((o) => o.sources ?? []);
      // SEARCH-MIXED-01 / THIN-1D: a failed or empty lookup is never handed
      // to the model (model.ts filters it out of the phrasing round and tells
      // it the failure kind only); the model's own note is part of its text,
      // so nothing is appended here.
      // SEARCH-DOWN-EMPTY-01 (rule 6): a lookup ran and the model still wrote nothing visible (its
      // regeneration came back empty too). The person never gets silence: a short plain line says
      // what is missing and what to do. It stands in only when no model words exist.
      if (input.text.trim().length === 0 && state.outcomes.length > 0) return { outcome: { ok: true }, output: { text: missedLookupLine(state.outcomes), sources } };
      return { outcome: { ok: true }, output: { text: input.text, sources } };
    }
    case "from_outcomes": {
      // COMMAND-FAIL-01: this text is machine.ts's own last-resort
      // fallback (`answerInputFrom`), built from `outcomes.at(-1)?.
      // userMessage`, so a failed last outcome is tagged the identical way
      // "immediate" is. THIN-1D: no failed code has a stored line any more
      // (the old search_unavailable outage line is gone); the answering round
      // tells a failed lookup in the model's own words (model.ts).
      const sources = input.outcomes.flatMap((o) => o.sources ?? []);
      const lastFailed = input.outcomes.at(-1)?.status === "failed";
      const provenance = lastFailed ? ("outcome_error" as const) : undefined;
      // R2: a failed tool run carries no household-facing message (its raw error is
      // the admin-only `detail`), so the text is empty; the shared technical-failure line
      // stands in for it where no model round follows.
      return { outcome: { ok: true }, output: { text: input.text || (lastFailed ? COMPOSE_FAILURE_LINE : ""), sources, provenance } };
    }
    // DEADLINE-01: the same shared line composer.ts's own all-failed
    // batch already uses for a technical failure - the identical
    // "something broke, not a refusal" case, one level up, imported
    // rather than re-typed so the two copies can't drift.
    case "model_failed":
      state.failedGenerationReply = true;
      // A picture or video job was already started when the phrasing round failed (seen live three times: the chat
      // stream ended while the job began). "Something went wrong while writing that" would be false and would make
      // the person ask again, so a second job; the job is real and its card is coming, so say that.
      if (pictureForOutcomes(state.outcomes)) return { outcome: { ok: true }, output: { text: PICTURE_STARTED_LINE, sources: [] } };
      if (musicForOutcomes(state.outcomes)) return { outcome: { ok: true }, output: { text: "Your song is being made. It will show up right below when it is ready.", sources: [] } };
      if (videoForOutcomes(state.outcomes)) return { outcome: { ok: true }, output: { text: VIDEO_STARTED_LINE, sources: [] } };
      // THIN-DL-02: the line follows the failure kind (generationFailure.ts),
      // never the generic apology.
      return { outcome: { ok: true }, output: { text: failureLine(input.failure ?? "other", state.plan?.age_band !== "adult", engineComputerAwayFromHome()), sources: [] } };
  }
};
