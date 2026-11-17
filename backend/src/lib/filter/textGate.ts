/**
 * CONTENT-POLICY-02: the reply and News text callers reach the filter door through here. One synchronous call per sentence (the stream gate
 * and the news gate cannot await), returning what each caller already worked with: whether the text is held, and the floor's own
 * `SafetyResult` (so the crisis signal, the parent notice and the refusal shape are what they were before the door). Nothing here decides:
 * the door runs `minor-line` (today's floor) and, below X, `rules-check`; an adult's reply runs `minor-line` only.
 */
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { AgeBand } from "@/lib/audience";
import type { PersonRow } from "@/types";
import { releaseSync } from "./door";
import type { Surface } from "./raters";

export interface TextCheck {
  /** The door held the text (the floor refused it, or the content rules did, or the door could not rate it for a viewer below X). */
  held: boolean;
  /** The floor's result, with `action: "refuse"` when the door held the text for any reason. */
  safety: SafetyResult;
}

const CLEAN = (): SafetyResult => ({ flagged: false, categories: [], matched_signals: [], action: "allow", notify_parent: false, checked_at: new Date().toISOString() });

/** A News gate that has no person in hand (a story is gated once per band): the band's own role defaults decide, as they do for the shelf. */
export function surfaceActor(band: AgeBand): PersonRow {
  return { id: `surface:${band}`, role: band } as PersonRow;
}

export function checkText(input: { surface: Extract<Surface, "reply" | "news">; actor: PersonRow; band: AgeBand; text: string; field?: "title" | "transcript"; whole?: true }): TextCheck {
  const verdict = releaseSync({
    surface: input.surface,
    audience: { actor: input.actor, band: input.band },
    item: { kind: "text", text: input.text, field: input.field ?? "transcript", point: "release", surface: input.surface, ...(input.whole ? { whole: true as const } : {}) },
  });
  const held = verdict.verdict === "held";
  const found = verdict.safety ?? CLEAN();
  return { held, safety: held && found.action !== "refuse" ? { ...found, flagged: true, action: "refuse" } : found };
}

const ACTION_RANK: Record<SafetyResult["action"], number> = { allow: 0, allow_with_resources: 1, refuse: 2 };

export interface ReplyCheck { text: SafetyResult; speech?: SafetyResult; effective: SafetyResult }

/** The whole-reply read (`evaluateReply`'s twin through the door): the text and, when it differs, the speech, merged the same way. */
export function checkReply(actor: PersonRow, band: AgeBand, reply: { text: string; speech?: string }): ReplyCheck {
  const text = checkText({ surface: "reply", actor, band, text: reply.text }).safety;
  const speech = reply.speech !== undefined && reply.speech !== reply.text ? checkText({ surface: "reply", actor, band, text: reply.speech }).safety : undefined;
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
