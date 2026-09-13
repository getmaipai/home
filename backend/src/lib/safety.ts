import { checkSafety, REFUSE_CATEGORIES } from "@maipai/spec/safety/ts/classifier.js";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { REFUSAL_FIRST } from "@/lib/replyVariation";
import { notifyIfFlagged } from "@/lib/notifications";
import type { PersonRow } from "@/types";
import type { PluginResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";

// Session C step 7 (session-c-brain-and-voice.md): evaluateSafety() below
// used to derive its own `isMinor` boolean straight from `actor.role`
// (a MINOR_ROLES set, since removed) - a real, less accurate proxy than
// the birthdate-derived AgeBand turnEngine.ts's own prompt already
// computes for the identical actor on the identical turn ("the safety
// layer reads the ceiling through the band instead of the role proxy").
// A code review found notifications.ts's own "adults" audience filter
// used the same role proxy this file's old isMinorRole() exported - the
// two agreed by construction while both used role, but would have
// silently diverged the moment only this file switched to band, so that
// filter now shares this same AgeBand computation too
// (lib/notifications.ts's resolveRecipients()). isMinorRole()/MINOR_ROLES
// had no other caller left, so they're removed rather than kept as
// exported dead code.
function isMinorBand(band: AgeBand): boolean {
  return band !== "adult";
}

/** The one, real caller in a running conversation turn (turnEngine.ts's
 * prepareTurn(), runTurn(), and runTurnStream()'s gateOutputSafety() all
 * pass the actor's real AgeBand, computed once via lib/ageBand.ts's
 * speakerAgeBand()) - also exercised directly (routes/safety.ts,
 * tests/safety.test.ts) so the wiring is proven independent of any one
 * turn-engine caller. */
export function evaluateSafety(text: string, speakerBand: AgeBand): SafetyResult {
  const result = checkSafety(text, { isMinor: isMinorBand(speakerBand) });
  if (result.flagged) {
    // 4.3: "logged with the fact, never the transcript." No structured
    // host.log exists yet (that's 4.9's package host); this is a
    // fact-only line, never the checked text itself.
    console.log(
      `[safety] flagged categories=${result.categories.join(",")} action=${result.action} notify_parent=${result.notify_parent}`,
    );
  }
  return result;
}

/** CHAT-02 (docs/dev/session-a.md): the OUTPUT reading of a classifier
 * result. The classifier's own action is the input policy: a person
 * showing self-harm intent is never blocked, even when the same message
 * trips another detector ("offer, never block"). For what the assistant
 * is about to SAY the combination is different: a reply carrying a
 * refuse category is refused whatever else it carries, and the crisis
 * resources still ride along when self_harm is among its categories (a
 * code review on CHAT-02 found the input action letting harmful
 * instructions through when the same reply mentioned self-harm). Same
 * detectors, same categories, same age band; only the action differs. */
export function forOutput(result: SafetyResult): SafetyResult {
  const refuses = result.categories.some((c) => REFUSE_CATEGORIES.has(c)); // the classifier's own set, not a second list
  return refuses && result.action !== "refuse" ? { ...result, action: "refuse" } : result;
}

/** True when a result carries the self-harm category, whatever its
 * action: the crisis text follows the category, so a refused reply that
 * also mentioned self-harm keeps its resources. */
export function carriesCrisisSignal(result: SafetyResult): boolean {
  return result.action === "allow_with_resources" || result.categories.includes("self_harm");
}

/** The one output evaluation every reply passes before the household
 * sees, hears or keeps it. `text` and, when it is present and differs,
 * `speech` are evaluated independently with the identical
 * evaluateSafety() read through forOutput(); `effective` merges the two
 * (the categories and signals of both, the stricter action, notify when
 * either would), so a refusal on one side never drops the other side's
 * crisis resources or its notification categories. */
export interface ReplyEvaluation {
  text: SafetyResult;
  speech?: SafetyResult;
  /** The merged result the boundary acts on. */
  effective: SafetyResult;
}

const ACTION_RANK: Record<SafetyResult["action"], number> = { allow: 0, allow_with_resources: 1, refuse: 2 };

export function evaluateReply(reply: { text: string; speech?: string }, speakerBand: AgeBand): ReplyEvaluation {
  const text = forOutput(evaluateSafety(reply.text, speakerBand));
  const speech = reply.speech !== undefined && reply.speech !== reply.text ? forOutput(evaluateSafety(reply.speech, speakerBand)) : undefined;
  if (!speech) return { text, effective: text };
  const stricter = ACTION_RANK[speech.action] > ACTION_RANK[text.action] ? speech : text;
  const effective: SafetyResult = {
    ...stricter,
    flagged: text.flagged || speech.flagged,
    categories: [...new Set([...text.categories, ...speech.categories])],
    matched_signals: [...new Set([...text.matched_signals, ...speech.matched_signals])],
    notify_parent: text.notify_parent || speech.notify_parent,
  };
  return { text, speech, effective };
}

/** CHAT-02: the boundary for a package answer that reaches a person
 * outside a chat turn (`POST /api/plugins/:id/run`, a dashboard
 * widget). Evaluates the reply (text and speech) for the actor's own
 * age band, tells a minor's parent the same way a chat turn does, and
 * returns a replacement result carrying one fixed refusal line and
 * nothing else (no `data`, no `ask`, no actions) when the reply is
 * refused, or null when it passes. A fixed line, not the chat's
 * rotating variant: a widget is re-fetched on every dashboard refresh,
 * and "as I said" phrasing in a tile is wrong (a code review). These
 * result shapes carry no crisis_resources field, so an
 * allow_with_resources package reply passes without the crisis text
 * here; the chat turn is where that is offered. A code review on
 * CHAT-02 found these two outlets returning raw package text
 * unevaluated. */
export function refusePackageReplyIfUnsafe(actor: PersonRow, result: PluginResult): PluginResult | null {
  if (!result.reply) return null;
  const evaluation = evaluateReply(result.reply, speakerAgeBand(actor, new Date()));
  notifyIfFlagged(actor, evaluation.effective, "[package]");
  if (evaluation.effective.action !== "refuse") return null;
  return { reply: { text: REFUSAL_FIRST[0]! }, actions: [] };
}
