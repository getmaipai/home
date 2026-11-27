// VOICE-MACHINE-01: the barge-in half of the live voice session as a plain state and one pure next-state function. It decides only
// what to do when a sound, a partial transcript or a final arrives while Home is speaking (pause, resume, stop for good, or nothing).
// It reads no clock, timer, scheduler or socket: liveVoiceSession.tsx runs the effects it returns, and the tests walk it with seeded
// random events. Reference only: LocalAI's turn coordinator; its "barge in on any sound" is NOT copied. Here a sound with no words
// never pauses her (ECHO-GUARD-01, 2026-11-12; Jesse, 2026-10-30: she pauses only once the sound is clearly speech).

export type BargeOutcome = "stopped" | "resumed_noise" | "resumed_reaction" | "resumed_echo" | "none";

export interface BargeState {
  /** Her reply is paused because of an overlap. */
  paused: boolean;
  /** Real words (not her own voice, not a bare reaction) were heard since the overlap began. */
  words: boolean;
  outcome: BargeOutcome;
}

export const BARGE_IDLE: BargeState = { paused: false, words: false, outcome: "none" };

export type BargeEvent =
  /** The voice detector heard a sound start. `live`: barge-in is on, the mic is not muted and a reply is playing. */
  | { t: "sound_start"; live: boolean }
  /** A partial transcript while `live` and past the arm delay. `heardWords` counts the words after normalising. */
  | { t: "partial"; heard: boolean; heardWords: number; reaction: boolean; ownVoice: boolean; stopWord: boolean }
  | { t: "sound_end" }
  | { t: "hub_resume" }
  | { t: "false_interruption_elapsed" }
  | { t: "deadline" }
  | { t: "final_echo" }
  /** A final while `live` that is noise, empty or a bare reaction; `words` is 0 for noise. */
  | { t: "final_reaction"; words: number }
  /** A final while `live` with real words. */
  | { t: "final_words"; words: number }
  /** interrupt() ran (a stop or a tap): nothing is paused any more. */
  | { t: "interrupted" }
  /** The reply ended: the measurement outcome starts over. */
  | { t: "reply_ended" };

export type BargeEffect =
  | { k: "pause" }
  | { k: "resume" }
  /** Stop her for good (interrupt("voice")). */
  | { k: "stop_reply" }
  | { k: "clear_duck" }
  | { k: "clear_overlap_timer" }
  | { k: "clear_false_timer" }
  | { k: "start_false_timer" }
  | { k: "mark_pause_ms" }
  | { k: "count"; which: "interruption" | "reaction_resume" }
  /** `played`: the runner adds how much of the reply had played. */
  | { k: "trace"; event: string; extra?: Record<string, unknown>; played?: boolean };

export interface BargeStep { state: BargeState; effects: BargeEffect[] }

const same = (state: BargeState): BargeStep => ({ state, effects: [] });
const resolved = (reason: string): BargeEffect => ({ k: "trace", event: "pause_resolved", extra: { reason } });

export function nextBargeState(state: BargeState, event: BargeEvent): BargeStep {
  switch (event.t) {
    case "sound_start":
      // A sound with no words never pauses her: the transcript, not the sound, decides.
      return event.live ? same({ ...state, words: false }) : same(state);
    case "partial": {
      if (!event.heard || event.reaction || event.ownVoice) return same(state);
      const next: BargeState = { ...state, words: true };
      // One explicit stop word is enough; ordinary speech needs two real words.
      if (!(event.stopWord || event.heardWords >= 2)) return same(next);
      const effects: BargeEffect[] = [{ k: "clear_duck" }];
      if (!state.paused) {
        effects.push({ k: "trace", event: event.stopWord ? "pause_stop_word" : "pause", extra: { words: event.heardWords } }, { k: "pause" });
        next.paused = true;
      }
      return { state: next, effects };
    }
    case "sound_end": {
      const effects: BargeEffect[] = [{ k: "clear_overlap_timer" }];
      if (state.paused && !state.words) effects.push({ k: "clear_false_timer" }, { k: "start_false_timer" });
      return { state, effects };
    }
    case "hub_resume": {
      const effects: BargeEffect[] = [{ k: "trace", event: "reply_resume", extra: { paused: state.paused } }];
      if (!state.paused) return { state, effects };
      effects.push(resolved("hub_resume"), { k: "clear_overlap_timer" }, { k: "resume" });
      return { state: { ...state, paused: false }, effects };
    }
    case "false_interruption_elapsed":
      return state.paused
        ? { state: { ...state, paused: false, outcome: "resumed_noise" }, effects: [{ k: "resume" }] }
        : same({ ...state, paused: false });
    case "deadline": {
      if (!state.paused) return same(state);
      if (state.words) {
        return { state: { ...state, paused: false, outcome: "stopped" }, effects: [{ k: "trace", event: "pause_resolved", extra: { reason: "deadline_interrupt" }, played: true }, { k: "mark_pause_ms" }, { k: "count", which: "interruption" }, { k: "stop_reply" }] };
      }
      return { state: { ...state, paused: false, outcome: "resumed_noise" }, effects: [resolved("deadline_resume"), { k: "resume" }] };
    }
    case "final_echo": {
      const effects: BargeEffect[] = [];
      if (state.paused) effects.push(resolved("final_echo"));
      effects.push({ k: "clear_overlap_timer" }, { k: "clear_false_timer" });
      if (state.paused) { effects.push({ k: "resume" }); return { state: { ...state, paused: false, outcome: "resumed_echo" }, effects }; }
      return { state, effects };
    }
    case "final_reaction": {
      const effects: BargeEffect[] = [{ k: "clear_overlap_timer" }, { k: "clear_false_timer" }, { k: "trace", event: "reaction", extra: { words: event.words, paused: state.paused } }];
      if (state.paused) effects.push(resolved("final_reaction"));
      if (event.words > 0) effects.push({ k: "count", which: "reaction_resume" });
      if (state.paused) { effects.push({ k: "resume" }); return { state: { ...state, paused: false, outcome: "resumed_reaction" }, effects }; }
      return { state, effects };
    }
    case "final_words": {
      const effects: BargeEffect[] = [{ k: "clear_overlap_timer" }, { k: "clear_false_timer" }, { k: "count", which: "interruption" }];
      if (state.paused) effects.push(resolved("final_interrupt"));
      effects.push({ k: "trace", event: "interrupt", extra: { words: event.words }, played: true }, { k: "stop_reply" });
      return { state: { ...state, paused: false, words: true, outcome: "stopped" }, effects };
    }
    case "interrupted":
      return same({ ...state, paused: false });
    case "reply_ended":
      return same({ ...state, outcome: "none" });
  }
}
