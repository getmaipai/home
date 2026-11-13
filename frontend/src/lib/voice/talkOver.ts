// TALK-OVER-01 (docs/design/talk-over-2026-11-12.md section 2 items 3 to 6): the client side of "Talk before I finish", as a pure
// state machine the voice session drives. It knows nothing about audio or sockets: the session tells it what the hub sent and when,
// and it answers with what to do (play the clip, cut it, discard the held run, confirm) and keeps the per-conversation back-off.
// Rule 6a: it holds counts and times, never words.
import type { TalkOverGrant, TalkOverLevel, TurnEndLevel } from "@/lib/voice/sttContract";

export type Level = "off" | TalkOverLevel;
export type Decision = "none" | "confirmed" | "continued";

const ORDER: Record<Level, number> = { off: 0, gentle: 1, natural: 2 };
/** The window never ends sooner than this after the clip ends, so the "still speaking" check never looks at the clip's own echo. */
export const CLIP_TAIL_MS = 250;
/** A resume that fits inside the clip's playback plus this margin is read as the clip's echo, not the person (design item 5). */
export const ECHO_MARGIN_MS = 100;
/** Each wrong start widens the window by this much (design item 6). */
export const WINDOW_STEP_MS = 100;
export const WINDOW_MAX_MS = 1200;
/** Two wrong starts in one conversation drop the level one step for the rest of it. */
export const WRONG_STARTS_PER_STEP = 2;

export function stepDown(level: Level): Level {
  return level === "natural" ? "gentle" : "off";
}

export function firesAt(level: Level, end: TurnEndLevel): boolean {
  if (level === "off" || end === "none") return false;
  return ORDER[level] >= ORDER[end as Level];
}

export interface ConversationBackoff { level: Level; windowMs: number; wrongStarts: number }

export interface Overlap {
  /** When the clip started (ms, the session's clock). */
  startedAt: number;
  /** When the clip's audio ends (ms). */
  clipEndsAt: number;
  /** When the one decision is made (ms). */
  windowEndsAt: number;
  windowMs: number;
  /** The hub reported the person's voice back after the edge partial, at this time (ms), lasting at least 200 ms. */
  resumedAt: number | null;
  /** A later partial carried more words than the held text (the person went on). */
  moreWords: boolean;
  decision: Decision;
  /** The hard-stop latency when the clip was cut (ms from the decision to the gain reaching zero). */
  yieldMs: number | null;
}

export class TalkOverController {
  private readonly byConversation = new Map<string, ConversationBackoff>();
  constructor(private readonly grant: TalkOverGrant) {}

  /** The level and window in force for a conversation, after its back-off. */
  state(conversationId: string): ConversationBackoff {
    const current = this.byConversation.get(conversationId);
    if (current) return current;
    const fresh = { level: this.grant.level, windowMs: this.grant.window_ms, wrongStarts: 0 };
    this.byConversation.set(conversationId, fresh);
    return fresh;
  }

  /** Whether an edge partial at `end` earns the clip in this conversation. */
  shouldPlay(conversationId: string, end: TurnEndLevel | undefined): boolean {
    if (!end) return false;
    return firesAt(this.state(conversationId).level, end);
  }

  /** The clip just started: the protected overlap window opens (never shorter than the clip plus its tail). */
  open(conversationId: string, startedAt: number, clipDurationMs: number): Overlap {
    const windowMs = Math.max(this.state(conversationId).windowMs, clipDurationMs + CLIP_TAIL_MS);
    return { startedAt, clipEndsAt: startedAt + clipDurationMs, windowEndsAt: startedAt + windowMs, windowMs, resumedAt: null, moreWords: false, decision: "none", yieldMs: null };
  }

  /** The hub says the person's voice came back and lasted 200 ms. Inside the clip's playback (plus a margin) it is the clip's echo. */
  noteResumed(overlap: Overlap, at: number): void {
    if (overlap.decision !== "none") return;
    if (at <= overlap.clipEndsAt + ECHO_MARGIN_MS) return;
    overlap.resumedAt = at;
  }

  /** A later partial has more words than the held text: the person went on, echo or not. */
  noteMoreWords(overlap: Overlap): void {
    if (overlap.decision === "none") overlap.moreWords = true;
  }

  /** The final matched the held text before the window ended: the clip was right. */
  confirm(overlap: Overlap): Decision {
    if (overlap.decision === "none") overlap.decision = "confirmed";
    return overlap.decision;
  }

  /** The one decision at the window's end (design item 4). `continued` means: cut the clip if it still plays, discard the held run,
   * say nothing, let the final carry the whole utterance. `none` means: wait for the final. */
  decide(conversationId: string, overlap: Overlap, now: number): Decision {
    if (overlap.decision !== "none") return overlap.decision;
    if (now < overlap.windowEndsAt) return "none";
    if (overlap.resumedAt !== null || overlap.moreWords) {
      overlap.decision = "continued";
      this.noteWrongStart(conversationId);
      return "continued";
    }
    return "none";
  }

  /** The final differed from the held text after a clip played: a wrong start, counted the same way. */
  continuedAtFinal(conversationId: string, overlap: Overlap): Decision {
    if (overlap.decision === "none") { overlap.decision = "continued"; this.noteWrongStart(conversationId); }
    return overlap.decision;
  }

  private noteWrongStart(conversationId: string): void {
    const state = this.state(conversationId);
    state.wrongStarts += 1;
    state.windowMs = Math.min(WINDOW_MAX_MS, state.windowMs + WINDOW_STEP_MS);
    if (state.wrongStarts % WRONG_STARTS_PER_STEP === 0) state.level = stepDown(state.level);
  }
}
