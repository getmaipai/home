// U2c, the `output_gate` node (turn-machine-state-record-2026-09-22.md's
// state table): "every streamed sentence through gateOutputSafety; the
// honesty invariant...; the malformed repair | done; refused when the
// output floor refuses." Simplest real implementation (U2b's own
// brief): evaluateReply() (safety.ts) runs the SAME evaluateSafety()/
// forOutput() floor the old engine file's own gateOutputSafety() calls per
// sentence, over the whole composed reply at once rather than
// streamed sentence-by-sentence - real safety coverage of the actual
// text a household hears, not yet the per-sentence early-cut behavior
// the streaming gate adds. Malformed repair (wellFormed.ts, kept per
// RULES-AND-LEARNED-COMPONENTS.md) runs first, since a repair can only
// ever remove dangling markup, never change what the safety floor sees
// as a claim.
//
// The honesty invariant, applied structurally rather than by a new
// rule: this path's only two ways to compose a reply that could claim
// an action are `answer`'s "immediate" and "from_outcomes" kinds, and
// both are already built from a real ToolExecutionOutcome (the command
// that ran, or the tool that did) - there is no path here where the
// model's own free text ("model_text"/"context_quote") stands in for
// an action result, so nothing in this node re-parses that text for a
// claim a regex would have to invent (RULES-AND-LEARNED-COMPONENTS.md's
// "No hacky rules": understanding language is the model's job, and a
// text reply here was never granted an action result to misrepresent).
import { assessReply, repairReply, repairTail } from "@/lib/wellFormed";
import { evaluateReply, evaluateSafety, forOutput } from "@/lib/safety";
import type { AgeBand } from "@/lib/ageBand";
import { turnAgeBand } from "../speaker";
import { surfaceClassOf } from "@/lib/surfaceClass";
import { getHouseholdSettingValue } from "@/lib/settings";
import type { Surface } from "@/lib/turnShared";
import { REFUSAL_FIRST } from "@/lib/replyVariation";
import { envelopeToolCall } from "@/lib/llm";
import { COMPOSE_FAILURE_LINE } from "@/lib/composer";
import { notifyOncePerTurn } from "@/lib/turnShared";
import type { PersonRow } from "@/lib/memoryIngestion";
import { nextSentenceBoundary } from "@maipai/spec/safety/ts/sentenceChunker.js";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { Node, TurnState } from "../contract";
import type { AnswerOutput } from "./answer";

export interface StreamGateResult {
  /** Exactly what was released, concatenated - never a second,
   * independently recomputed text, so a streamed turn's logged reply is
   * the concatenation of the released deltas by construction. */
  text: string;
  /** Set the moment a sentence (or the flushed tail) refuses; nothing
   * after it was ever released. */
  refused: SafetyResult | undefined;
  /** The most recent non-refuse flag (e.g. a self_harm mention that
   * never refuses), so finalize() can still derive crisis resources for
   * a turn that never refused at all - the same field gateOutputSafety()
   * (the old engine file) returns for the identical reason. */
  lastFlagged: SafetyResult | undefined;
  /** STREAM-NEXT-01 (b), point 4: this generation's own first non-space
   * character was "{" - held whole, never released sentence by
   * sentence, whatever it turns out to be. output_gate's own node reads
   * this to fall back to its ordinary whole-reply path when true,
   * exactly as an immediate turn already does. */
  heldAsEnvelope: boolean;
  /** True once finish() has run (whether or not it releases anything) -
   * the signal output_gate's own node uses to tell "this reply was
   * actually streamed" apart from every other AnswerInput kind, which
   * never touches this gate at all. */
  done: boolean;
  /** THIN-5B: the reasoning text the gate released live, exactly as sent
   * (empty when none streamed). What is stored is this, never a second
   * independently recomputed text. */
  reasoning: string;
  /** THIN-5B: a reasoning sentence refused. Reasoning stopped there; the
   * answer is unaffected, and what had already been released stays. */
  reasoningRefused: boolean;
}

/** THIN-5B (rules 2 and 10): the reasoning lane of the streaming gate. An
 * adult's reasoning is released as it is generated and checked as it
 * arrives: every delta is checked as part of the sentence it extends
 * before it is released, and each finished sentence is checked again
 * against the reasoning so far (that cross-sentence check follows the
 * release of the sentence that completes it, so at worst one sentence
 * shows before a combined claim is caught; the owner's ruling accepts
 * this for an adult). Released text is never
 * retracted. A refusal ends the reasoning only (the answer carries on
 * and the parent is notified, as for any flagged text). Only ever fed
 * for a turn the context node decided may show reasoning (an adult's
 * written chat); a minor's or a spoken turn's reasoning never reaches
 * it, because the engine client drops it first (llm.ts dropReasoning). */
class ReasoningLane {
  private pending = "";
  private checked = "";
  private released = "";
  private isFirstChunk = true;
  private refused = false;
  private joinNext = false;

  constructor(
    private readonly band: AgeBand,
    private readonly actor: PersonRow,
    private readonly turnId: string,
    private readonly release: (text: string) => void,
  ) {}

  private refuses(text: string): boolean {
    const safety = forOutput(evaluateSafety(text, this.band));
    notifyOncePerTurn(this.actor, safety, this.turnId, "[turn]");
    return safety.action === "refuse";
  }

  push(delta: string): void {
    if (this.refused || !delta) return;
    const candidate = this.pending + delta;
    if (candidate.trim() && this.refuses(candidate.trim())) {
      this.refused = true;
      return;
    }
    this.pending = candidate;
    // A later generation (after a tool round) starts a new paragraph, so
    // the stored reasoning and the wire stay one and the same text.
    const out = this.joinNext && this.released.trim() ? `\n\n${delta}` : delta;
    this.joinNext = false;
    this.released += out;
    this.release(out);
    for (;;) {
      const end = nextSentenceBoundary(this.pending, this.isFirstChunk);
      if (end < 0) break;
      this.isFirstChunk = false;
      const span = this.pending.slice(0, end);
      this.pending = this.pending.slice(end);
      if (span.trim() && this.checked.trim() && this.refuses(`${this.checked}${span}`)) {
        this.refused = true;
        return;
      }
      this.checked += span;
    }
  }

  /** One generation is over: whatever sentence was still open is checked
   * against the reasoning so far, and the next generation starts clean. */
  endGeneration(): void {
    if (!this.refused && this.pending.trim() && this.checked.trim() && this.refuses(`${this.checked}${this.pending}`)) this.refused = true;
    this.checked += this.pending;
    this.pending = "";
    this.isFirstChunk = true;
    this.joinNext = true;
  }

  result(): { text: string; refused: boolean } {
    return { text: this.released, refused: this.refused };
  }
}

/** STREAM-NEXT-01 (b): the streaming twin of this file's own whole-reply
 * evaluateReply() pass - the identical floor (evaluateSafety()/
 * forOutput()), applied one already-complete sentence at a time instead
 * of once over the whole composed reply, so a household never sees
 * content a whole-reply check would have kept from them, and a refusal
 * stops the release instead of hiding it after the fact. Push-driven
 * (nodes/model.ts's own runOneGeneration() calls push() with each raw
 * delta as it arrives, from deep inside the machine's own async node
 * call - nothing above it in that call stack is built to catch a
 * mid-node throw) rather than pull-driven like the old engine file's own
 * gateOutputSafety(): a refusal never throws from inside push() or
 * finish(); it ends the release (no sentence after it is ever handed to
 * `release`) and is read back afterward via result(). The caller
 * (turnNext.ts) is what turns that into the wire's own mid-stream
 * refusal, the same StreamSafetyRefusal shape and behavior
 * the old engine file's own stream already uses. */
/** THIN-5C (rule 10, SAFETY.md): how the gate releases the answer.
 * `sentence`: each sentence is checked, then released (a child, every
 * spoken turn, a teen by default). `arrival`: text is released as it is
 * generated, each piece checked as part of the sentence it extends before
 * it goes out, and each finished sentence checked again against the reply
 * so far (an adult's written chat, a teen if the household says so). In
 * both, released text is never retracted. */
export type GateGrain = "sentence" | "arrival";

/** Who gets which grain. A spoken or glance turn is per sentence whatever
 * the band or any setting; a child is per sentence; an adult's written
 * chat arrives as generated; a teen's written chat follows the household
 * setting and defaults to per sentence. A failed read of the setting is
 * the stricter grain. */
export function gateGrainFor(band: AgeBand, surface: Surface, spoken: boolean): GateGrain {
  if (surfaceClassOf(surface, spoken) !== "written") return "sentence";
  if (band === "adult") return "arrival";
  if (band === "teen") {
    try {
      return getHouseholdSettingValue("chat.teen_gate_grain") === "arrival" ? "arrival" : "sentence";
    } catch {
      return "sentence";
    }
  }
  return "sentence";
}

export interface StreamGateOptions {
  /** THIN-5B: where released reasoning goes (the `reasoning` wire event).
   * Absent for a gate that never carries reasoning. */
  releaseReasoning?: (text: string) => void;
  /** THIN-5C: defaults to the strict per-sentence grain. */
  grain?: GateGrain;
}

export class StreamGate {
  private pending = "";
  /** THIN-5C: how much of `pending` has already gone out (arrival grain
   * only; per sentence, nothing in `pending` is ever released). */
  private pendingReleased = 0;
  private isFirstChunk = true;
  /** Everything released, exactly as sent. */
  private delivered = "";
  /** Everything released AND checked as a finished sentence: what a new
   * sentence is read against. Equals `delivered` per sentence. */
  private checked = "";
  private readonly grain: GateGrain;
  /** Arrival grain: an abandoned round's text was shown and stays shown,
   * so the next round's text starts a new paragraph. */
  private joinNext = false;
  private refused: SafetyResult | undefined;
  private lastFlagged: SafetyResult | undefined;
  private envelopeDecided = false;
  private heldAsEnvelope = false;
  private done = false;
  private readonly reasoningLane: ReasoningLane | undefined;

  constructor(
    private readonly band: AgeBand,
    // SAFETY-NOTIFY-NEXT-01: the actor/turnId the old engine file's own
    // gateOutputSafety() closes over from its own outer scope - this
    // class has none of its own, so both arrive here instead, used only
    // for the identical `notifyOncePerTurn()` calls below.
    private readonly actor: PersonRow,
    private readonly turnId: string,
    private readonly release: (sentence: string) => void,
    private readonly onRefuse: (safety: SafetyResult) => void,
    /** Fires exactly once, at the end of finish() (refused or not) -
     * the caller's own signal that no more content is ever coming, so a
     * consumer built from `release`'s own pushes (turnNext.ts's delivery
     * queue) knows when to stop waiting. Never fires from push() or
     * reset(), only from the one place a generation is genuinely over. */
    private readonly onDone: () => void,
    opts: StreamGateOptions = {},
  ) {
    if (opts.releaseReasoning) this.reasoningLane = new ReasoningLane(band, actor, turnId, opts.releaseReasoning);
    this.grain = opts.grain ?? "sentence";
  }

  /** THIN-5B: one reasoning delta from the engine, released live under
   * the check-as-it-arrives rule. Called only for a turn that may show
   * reasoning. */
  pushReasoning(delta: string): void {
    this.reasoningLane?.push(delta);
  }

  /** THIN-5B: the generation's reasoning is complete. */
  endReasoning(): void {
    this.reasoningLane?.endGeneration();
  }

  /** Starts a fresh attempt: clears whatever a PRIOR, now-abandoned
   * generation (an offered/auto round that turned out to call a tool
   * instead of answering, or a retried empty attempt) left pending or
   * already released - a turn's real reply is always its LAST eligible
   * generation's own text, never a blend of two. A no-op once refused
   * or finished, so a stray call after the turn's own real reply can
   * never resurrect or corrupt it. */
  reset(): void {
    if (this.refused || this.done) return;
    this.pending = "";
    this.pendingReleased = 0;
    this.isFirstChunk = true;
    this.envelopeDecided = false;
    this.heldAsEnvelope = false;
    // Per sentence, an abandoned round released nothing, so the record
    // starts clean. As it arrives, what the round showed stays shown and
    // stays in the record; the next round continues after it.
    if (this.grain === "arrival") {
      this.joinNext = this.delivered.trim().length > 0;
    } else {
      this.delivered = "";
      this.checked = "";
    }
  }

  /** Whether a generation's own leading, trimmed text looks like a tool-
   * call envelope written as prose rather than through the engine's
   * real tool-call field - llm.ts's own envelopeToolCall() recognizes
   * either a bare `{name, arguments}` object or exactly one `<tag>...
   * </tag>` wrapping it (never prose around it either way), so a bare
   * leading "{" or "<" is the same structural signal that function
   * checks for, checked here before a real parse is even possible (the
   * whole generation hasn't arrived yet). ENGINE-CONTRACT-03's own live
   * miss was the tag-wrapped form (Qwen3's `<function_call>`) - a first
   * cut of this check only caught the bare form, which would have let
   * exactly that miss stream its wire-shape prose onto the wire before
   * envelopeToolCall() recognized it too late to matter. */
  private looksLikeEnvelope(firstChar: string): boolean {
    return firstChar === "{" || firstChar === "<";
  }

  /** the old engine file's own gateOutputSafety()/checkAndNotify(): the per-
   * sentence check plus the identical notify call, so a flagged
   * sentence on the streamed path reaches a parent exactly as it would
   * on the old path - never a second, silent check. */
  private checkAndNotify(chunk: string): SafetyResult {
    const safety = forOutput(evaluateSafety(chunk, this.band));
    notifyOncePerTurn(this.actor, safety, this.turnId, "[turn]");
    return safety;
  }

  /** the old engine file's own gateOutputSafety()/wholeRefusal(): a sentence
   * that passes its OWN check can still make the REPLY SO FAR unsafe
   * read as a whole (a claim split across two sentences, each benign
   * alone) - checked on `delivered + next`, the identical floor, every
   * time, whether or not the new span's own check already passed. Never
   * called with nothing delivered yet (whitespace alone is nothing
   * delivered, the identical guard the old engine file's own version has).
   * Notifies only on an actual refusal, the same as the old engine file's own
   * version - the non-refusing case is already covered by
   * checkAndNotify()'s own unconditional call above it. */
  private wholeRefusal(next: string): SafetyResult | undefined {
    if (!this.checked.trim()) return undefined;
    const whole = forOutput(evaluateSafety(`${this.checked}${next}`, this.band));
    if (whole.action !== "refuse") return undefined;
    notifyOncePerTurn(this.actor, whole, this.turnId, "[turn]");
    return whole;
  }

  push(delta: string): void {
    if (this.refused || this.done || !delta) return;
    this.pending += delta;
    if (!this.envelopeDecided) {
      const trimmedStart = this.pending.trimStart();
      if (trimmedStart.length === 0) return; // still nothing but whitespace so far
      this.envelopeDecided = true;
      this.heldAsEnvelope = this.looksLikeEnvelope(trimmedStart[0]!);
    }
    if (this.heldAsEnvelope) return; // held whole - see the class doc
    if (this.grain === "arrival") {
      this.pushArriving();
      return;
    }
    for (;;) {
      const end = nextSentenceBoundary(this.pending, this.isFirstChunk);
      if (end < 0) break;
      this.isFirstChunk = false;
      const rawSpan = this.pending.slice(0, end);
      this.pending = this.pending.slice(end);
      const trimmed = rawSpan.trim();
      if (!trimmed) {
        // Whitespace alone between two sentences: nothing to classify,
        // still the reply's own whitespace (the old engine file's identical
        // #99 fix - dropping it here would reproduce that bug).
        this.delivered += rawSpan;
        this.checked += rawSpan;
        this.release(rawSpan);
        continue;
      }
      const safety = this.checkAndNotify(trimmed);
      if (safety.flagged) this.lastFlagged = safety;
      // A refusal carries the WHOLE reply's own result when something
      // was already delivered, so an earlier sentence's self-harm
      // category (and its crisis text) rides on the refusal - the
      // identical precedence the old engine file's own gateOutputSafety() uses
      // (`wholeRefusal(rawSpan) ?? safety`).
      if (safety.action === "refuse") {
        this.refused = this.wholeRefusal(rawSpan) ?? safety;
        this.onRefuse(this.refused);
        return;
      }
      const whole = this.wholeRefusal(rawSpan);
      if (whole) {
        this.refused = whole;
        this.onRefuse(whole);
        return;
      }
      this.delivered += rawSpan;
      this.checked += rawSpan;
      this.release(rawSpan);
    }
  }

  /** THIN-5C, arrival grain: the unreleased part of `pending` is checked
   * as one more piece of the sentence it extends BEFORE it goes out, so
   * text is shown as it is generated and never ahead of its own check. A
   * refusal stops the release there; what already went out stays. Each
   * finished sentence is then read against the reply so far, which can
   * catch a claim split across sentences (that check follows the release
   * of the sentence that completes it, as the owner's ruling accepts for
   * an adult). */
  private pushArriving(): void {
    const prefix = this.pending.trim();
    if (prefix) {
      const safety = this.checkAndNotify(prefix);
      if (safety.flagged) this.lastFlagged = safety;
      if (safety.action === "refuse") {
        this.refused = this.wholeRefusal(this.pending) ?? safety;
        this.onRefuse(this.refused);
        return;
      }
    }
    const fresh = this.pending.slice(this.pendingReleased);
    if (fresh) {
      const out = this.joinNext && fresh.trim() ? `\n\n${fresh}` : fresh;
      if (fresh.trim()) this.joinNext = false;
      // The checked text carries the same paragraph break the reader sees,
      // so a later whole-reply check never reads two rounds glued together.
      if (out !== fresh) this.checked += "\n\n";
      this.delivered += out;
      this.pendingReleased = this.pending.length;
      this.release(out);
    }
    for (;;) {
      const end = nextSentenceBoundary(this.pending, this.isFirstChunk);
      if (end < 0) break;
      this.isFirstChunk = false;
      const span = this.pending.slice(0, end);
      this.pending = this.pending.slice(end);
      this.pendingReleased -= end;
      if (span.trim()) {
        const whole = this.wholeRefusal(span);
        if (whole) {
          this.refused = whole;
          this.onRefuse(whole);
          return;
        }
      }
      this.checked += span;
    }
  }

  /** Called once the generation itself is fully done (whether it ends
   * normally or a caller's own failure path never sent another delta).
   * Repairs and releases whatever's left - the chunker's own tail is
   * the only fragment that can still be dangling markup; every earlier
   * span released above was already a complete sentence. A no-op once
   * refused, held as an envelope (the caller's own envelope-to-call
   * parse, or output_gate's ordinary fallback, handles that text
   * instead - never released here), or already finished.
   *
   * A code review caught the first cut repairing with `repairReply`
   * (this fragment alone) before checking safety on the REPAIRED text -
   * two real bugs, both fixed by matching the old engine file's own
   * gateOutputSafety() exactly instead: (1) `repairReply` judges quote/
   * bracket balance only over the isolated tail, so a quote legitimately
   * OPENED in an earlier, already-released sentence and correctly
   * closed here reads as a stray trailing quote and gets silently
   * stripped - `repairTail(delivered, tail)` (wellFormed.ts, built for
   * exactly this) judges balance over the whole reply instead, the
   * identical function and the identical fix `gateOutputSafety()`'s own
   * final `yield repairTail(delivered, pending)` already uses; (2) the
   * safety floor now checks the RAW remainder, same as
   * `gateOutputSafety()`'s own `checkAndNotify(remainder)`, and only
   * the REPAIRED text is ever released - repairing before checking
   * risked the floor judging text the household never actually saw. */
  finish(): void {
    if (this.done) return;
    this.done = true;
    try {
      this.reasoningLane?.endGeneration();
      if (this.refused || this.heldAsEnvelope) return;
      const remainder = this.pending.trim();
      if (!remainder) return;
      const safety = this.checkAndNotify(remainder);
      if (safety.flagged) this.lastFlagged = safety;
      if (safety.action === "refuse") {
        this.refused = this.wholeRefusal(remainder) ?? safety;
        this.onRefuse(this.refused);
        return;
      }
      const whole = this.wholeRefusal(remainder);
      if (whole) {
        this.refused = whole;
        this.onRefuse(whole);
        return;
      }
      if (this.grain === "arrival") {
        // The tail already went out as it arrived; only what repair
        // would ADD (a closing stop) can still be released. Anything the
        // repair would take away cannot be taken back.
        const repairedTail = repairTail(this.checked, this.pending);
        if (repairedTail.startsWith(this.pending) && repairedTail.length > this.pending.length) {
          const suffix = repairedTail.slice(this.pending.length);
          this.delivered += suffix;
          this.release(suffix);
        }
        this.checked += this.pending;
        return;
      }
      const repaired = repairTail(this.delivered, this.pending);
      this.delivered += repaired;
      this.checked += repaired;
      this.release(repaired);
    } finally {
      this.onDone();
    }
  }

  result(): StreamGateResult {
    const lane = this.reasoningLane?.result();
    return { text: this.delivered, refused: this.refused, lastFlagged: this.lastFlagged, heldAsEnvelope: this.heldAsEnvelope, done: this.done, reasoning: lane?.text ?? "", reasoningRefused: lane?.refused ?? false };
  }
}

export interface OutputGateInput {
  reply: AnswerOutput;
  /** "Reasoning is a second output": the model node's own extracted
   * span, undefined whenever `context` already decided not to emit
   * (the model node drops it before this input is even built -
   * machine.ts's own `answerInputFrom`/output_gate wiring) or the
   * generation simply carried no think block this turn. */
  reasoningIn: string | undefined;
  reasoningEmit: boolean;
  reasoningWithheldFor: TurnState["reasoning"]["withheld_for"];
}

export type OutputGateOutput =
  // THIN-0M: `safety` is the whole-reply check that refused, so a refusal
  // whose text mentioned self-harm still carries the crisis resources.
  | { refused: true; text: string; safety?: SafetyResult; reasoning: { emitted: boolean; withheld_for: TurnState["reasoning"]["withheld_for"] } }
  | { refused: false; text: string; speech?: string; sources: AnswerOutput["sources"]; reasoningOut?: string; reasoning: { emitted: boolean; withheld_for: TurnState["reasoning"]["withheld_for"] } };

/** The reasoning span's own safety pass ("Reasoning passes the output
 * gate ... before an adult sees it") - identical whether the reply
 * itself streamed or not (STREAM-NEXT-01 (b), ruling point 5: "Reasoning
 * isn't streamed. It stays gated whole at the end, as now"), so both of
 * this node's branches share the one implementation. */
function gateReasoning(input: OutputGateInput, band: AgeBand, actor: PersonRow, turnId: string): { reasoningOut: string | undefined; withheldFor: TurnState["reasoning"]["withheld_for"] } {
  if (input.reasoningEmit && input.reasoningIn !== undefined) {
    const reasoningEvaluation = evaluateReply({ text: input.reasoningIn }, band);
    // SAFETY-NOTIFY-NEXT-01: no old-path equivalent (reasoning emission,
    // REASONING-02, is new-path-only - the old path never streamed or
    // exposed a chain-of-thought span at all), but the same category of
    // risk (a self-harm mention inside the model's own reasoning, say)
    // needs the same parent notification a flagged answer already gets.
    notifyOncePerTurn(actor, reasoningEvaluation.effective, turnId, "[turn]");
    if (reasoningEvaluation.effective.action === "refuse") return { reasoningOut: undefined, withheldFor: "gate" };
    return { reasoningOut: input.reasoningIn, withheldFor: null };
  }
  if (input.reasoningEmit) return { reasoningOut: undefined, withheldFor: null }; // allowed to emit, nothing to emit
  return { reasoningOut: undefined, withheldFor: input.reasoningWithheldFor };
}

export const outputGateNode: Node<OutputGateInput, OutputGateOutput> = async (state, input) => {
  // ENGINE-CONTRACT-03 (dev.md "U6 rerun ruling" (a)): checked on the
  // ORIGINAL text, before repairReply() below ever runs - that repair
  // assumes prose (a sentence terminator, balanced quotes) and reshapes
  // anything that doesn't look like one, which would mangle a raw
  // {name, arguments} envelope (found live: repairReply() appending a
  // terminator broke the exact-match this check needs) before this ever
  // got a chance to recognize it. The model node's own runOneGeneration()
  // already turns a whole-reply envelope into a real call before it ever
  // reaches `answer` - this is the floor for whatever text still arrives
  // here as one anyway (a second model round's own text, a package
  // reply). A wire-shape miss, not a safety call, so this never delivers
  // as REFUSAL_FIRST does: the same honest, still-"refused: false" line
  // DEADLINE-01's own model_failed already uses one node up (answer.ts's
  // COMPOSE_FAILURE_LINE), not the "refused" branch machine.ts reserves
  // for a real safety decision.
  if (envelopeToolCall(input.reply.text) !== undefined) {
    // A review caught the first cut hardcoding `withheld_for: null` here,
    // exactly the bug the safety-refusal branch below is already careful
    // to avoid (its own comment: a benign span's real reason must never
    // read back as "nothing to withhold"). This branch never evaluates
    // reasoning at all, so `input.reasoningWithheldFor` - context's own
    // decision (`"minor"`, `"surface"`, `"presence"`, or null) - passes
    // through unchanged, never overwritten by this unrelated catch.
    return { outcome: { ok: true }, output: { refused: false, text: COMPOSE_FAILURE_LINE, sources: input.reply.sources, reasoning: { emitted: false, withheld_for: input.reasoningWithheldFor } } };
  }

  // COMMAND-FAIL-01 (dev.md "The knowledge hijack" (b)): the same
  // place and shape as the envelope catch above - a provenance check,
  // not a safety call, so it never routes through REFUSAL_FIRST
  // either. `answer.ts` tags `provenance: "outcome_error"` exactly
  // when its own text came straight from a failed outcome's `error`/
  // `userMessage` field; this is the one place that tag is ever read,
  // so text sourced from an engine's own raw error string (an MCP
  // error, an HTTP status) never reaches a household member, whatever
  // node produced it.
  if (input.reply.provenance === "outcome_error") {
    return { outcome: { ok: true }, output: { refused: false, text: COMPOSE_FAILURE_LINE, sources: input.reply.sources, reasoning: { emitted: false, withheld_for: input.reasoningWithheldFor } } };
  }

  // THIN-0N: the speaker's effective band, as the old path's prepareTurn().
  const band = turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date());

  // STREAM-NEXT-01 (b), ruling point 1: on a streamed turn output_gate
  // IS the per-sentence gate - nodes/model.ts's own runOneGeneration()
  // already drove state.streamGate through the identical evaluateSafety()/
  // forOutput() floor evaluateReply() below applies to the whole reply,
  // one already-complete sentence at a time, as the generation ran. This
  // node never re-evaluates that text; it assembles its output from the
  // verdicts the gate already made, so logged equals streamed by
  // construction. `done` is unset for every other AnswerInput kind
  // (immediate/from_outcomes/context_quote/policy_refused/model_failed
  // never touch this gate at all) and `heldAsEnvelope` falls through to
  // the ordinary whole-reply path below - the same one a generation
  // whose envelope parse actually succeeded already takes, since
  // `input.reply.text` in that case is never this gate's concern.
  const streamed = state.streamGate?.result();
  if (streamed?.done && !streamed.heldAsEnvelope) {
    if (streamed.refused) {
      // THIN-5B: reasoning already shown live is not retracted, and the
      // trace says so rather than claiming none was emitted.
      const shown = streamed.reasoning.length > 0;
      const refusedWithheldFor = shown ? null : input.reasoningEmit ? "gate" : input.reasoningWithheldFor;
      return { outcome: { ok: true }, output: { refused: true, text: REFUSAL_FIRST[0]!, reasoning: { emitted: shown, withheld_for: refusedWithheldFor } } };
    }
    // THIN-5B: reasoning the gate already released live is what is stored
    // and reported, never re-evaluated here (logged equals streamed). A
    // reasoning refusal ended the stream of it and reads "gate". Reasoning
    // that never went through the gate (a think block an engine leaked
    // into `content`) still gets the whole-span pass below.
    if (input.reasoningEmit && (streamed.reasoning || streamed.reasoningRefused)) {
      const reasoningOut = streamed.reasoning || undefined;
      return { outcome: { ok: true }, output: { refused: false, text: streamed.text, speech: input.reply.speech, sources: input.reply.sources, reasoningOut, reasoning: { emitted: reasoningOut !== undefined, withheld_for: streamed.reasoningRefused ? "gate" : null } } };
    }
    const { reasoningOut, withheldFor } = gateReasoning(input, band, state.actor, state.turnId);
    return { outcome: { ok: true }, output: { refused: false, text: streamed.text, speech: input.reply.speech, sources: input.reply.sources, reasoningOut, reasoning: { emitted: reasoningOut !== undefined, withheld_for: withheldFor } } };
  }

  const repaired = assessReply(input.reply.text) ? repairReply(input.reply.text) : input.reply.text;
  const evaluation = evaluateReply({ text: repaired, speech: input.reply.speech }, band);
  // SAFETY-NOTIFY-NEXT-01: the immediate (non-streamed) path's own whole-
  // reply boundary - the identical call the old engine file's own
  // applyOutputBoundary() makes right after its own equivalent
  // evaluateReply(), unconditionally, before the refuse check below.
  notifyOncePerTurn(state.actor, evaluation.effective, state.turnId, "[turn]");

  // The same safety pass the answer itself gets, over the reasoning
  // span too ("Reasoning passes the output gate ... before an adult
  // sees it"). Only ever runs when `context` already said this turn
  // may emit one AND the model actually produced a span - the false
  // branches (never asked to emit, or nothing to gate) pass the
  // context-decided reason straight through, never re-evaluated here.
  const { reasoningOut, withheldFor } = gateReasoning(input, band, state.actor, state.turnId);
  if (evaluation.effective.action === "refuse") {
    // A code review caught this reusing the reasoning span's own
    // withheldFor (from the check above, independent of the ANSWER's
    // own refusal) verbatim here: a benign span that had already
    // passed its own gate (withheldFor still null, meaning "nothing
    // wrong with it") would then be recorded as `withheld_for: null`
    // on a turn where it was never actually sent - indistinguishable
    // from "this turn had nothing to withhold" on the trace. The
    // ANSWER's own refusal is itself an output_gate decision that
    // drops the reasoning span too (a refused turn never emits one),
    // so it gets the same "gate" reason whenever there was something
    // to withhold in the first place (reasoningEmit true) - the
    // context-decided reason (minor/surface) still wins when emit was
    // already false, never overwritten by an unrelated answer refusal.
    const refusedWithheldFor = input.reasoningEmit ? "gate" : withheldFor;
    return { outcome: { ok: true }, output: { refused: true, text: REFUSAL_FIRST[0]!, safety: evaluation.effective, reasoning: { emitted: false, withheld_for: refusedWithheldFor } } };
  }

  const reasoning ={ emitted: reasoningOut !== undefined, withheld_for: withheldFor };
  return { outcome: { ok: true }, output: { refused: false, text: repaired, speech: input.reply.speech, sources: input.reply.sources, reasoningOut, reasoning } };
};
