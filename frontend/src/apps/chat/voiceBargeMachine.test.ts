import { describe, expect, test } from "bun:test";
import { BARGE_IDLE, nextBargeState, type BargeEffect, type BargeEvent, type BargeState } from "@/apps/chat/voiceBargeMachine";

// A small seeded generator so a failing walk replays from its seed.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const NO_WORD_EVENTS: BargeEvent[] = [
  { t: "sound_start", live: true }, { t: "sound_start", live: false }, { t: "sound_end" }, { t: "hub_resume" },
  { t: "false_interruption_elapsed" }, { t: "deadline" }, { t: "final_echo" }, { t: "final_reaction", words: 0 }, { t: "final_reaction", words: 2 },
  { t: "interrupted" }, { t: "reply_ended" },
  // Partials that carry no real words: nothing heard, a reaction, or her own voice.
  { t: "partial", heard: false, heardWords: 0, reaction: false, ownVoice: false, stopWord: false },
  { t: "partial", heard: true, heardWords: 3, reaction: true, ownVoice: false, stopWord: false },
  { t: "partial", heard: true, heardWords: 5, reaction: false, ownVoice: true, stopWord: true },
];
const ALL_EVENTS: BargeEvent[] = [
  ...NO_WORD_EVENTS,
  { t: "partial", heard: true, heardWords: 1, reaction: false, ownVoice: false, stopWord: false },
  { t: "partial", heard: true, heardWords: 1, reaction: false, ownVoice: false, stopWord: true },
  { t: "partial", heard: true, heardWords: 4, reaction: false, ownVoice: false, stopWord: false },
  { t: "final_words", words: 3 },
];

const kinds = (effects: BargeEffect[]) => effects.map((e) => e.k);

describe("voice barge-in machine", () => {
  test("a sound with no words never pauses or stops her (any order of non-word events)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const next = rng(seed);
      let state: BargeState = BARGE_IDLE;
      for (let i = 0; i < 60; i++) {
        const event = NO_WORD_EVENTS[Math.floor(next() * NO_WORD_EVENTS.length)]!;
        const step = nextBargeState(state, event);
        expect(kinds(step.effects)).not.toContain("pause");
        expect(kinds(step.effects)).not.toContain("stop_reply");
        expect(step.state.paused).toBe(false);
        state = step.state;
      }
    }
  });

  test("a bare sound start, even a long one, leaves her playing until a partial has two real words", () => {
    let state = nextBargeState(BARGE_IDLE, { t: "sound_start", live: true }).state;
    expect(state.paused).toBe(false);
    const one = nextBargeState(state, { t: "partial", heard: true, heardWords: 1, reaction: false, ownVoice: false, stopWord: false });
    expect(kinds(one.effects)).not.toContain("pause");
    const two = nextBargeState(one.state, { t: "partial", heard: true, heardWords: 2, reaction: false, ownVoice: false, stopWord: false });
    expect(kinds(two.effects)).toContain("pause");
    state = two.state;
    expect(state.paused).toBe(true);
  });

  test("one stop word pauses her, unless it is her own voice", () => {
    const own = nextBargeState(BARGE_IDLE, { t: "partial", heard: true, heardWords: 1, reaction: false, ownVoice: true, stopWord: true });
    expect(own.effects).toEqual([]);
    const real = nextBargeState(BARGE_IDLE, { t: "partial", heard: true, heardWords: 1, reaction: false, ownVoice: false, stopWord: true });
    expect(kinds(real.effects)).toContain("pause");
  });

  test("random walk: never stuck. A paused reply always has an exit, and each exit leaves it unpaused", () => {
    const exits: BargeEvent[] = [{ t: "deadline" }, { t: "hub_resume" }, { t: "final_echo" }, { t: "final_reaction", words: 1 }, { t: "final_words", words: 2 }, { t: "interrupted" }, { t: "false_interruption_elapsed" }];
    for (let seed = 1; seed <= 500; seed++) {
      const next = rng(seed);
      let state: BargeState = BARGE_IDLE;
      for (let i = 0; i < 80; i++) {
        const event = ALL_EVENTS[Math.floor(next() * ALL_EVENTS.length)]!;
        const step = nextBargeState(state, event);
        const e = kinds(step.effects);
        // Pause is only asked for while not already paused, and leaves the state paused.
        if (e.includes("pause")) { expect(state.paused).toBe(false); expect(step.state.paused).toBe(true); expect(step.state.words || event.t === "partial").toBe(true); }
        // Stopping for good only follows real words and leaves nothing paused.
        if (e.includes("stop_reply")) { expect(step.state.words).toBe(true); expect(step.state.paused).toBe(false); expect(step.state.outcome).toBe("stopped"); }
        // A resume only follows a paused state.
        if (e.includes("resume")) { expect(state.paused).toBe(true); expect(step.state.paused).toBe(false); }
        state = step.state;
      }
      // From any reachable state the deadline resolves a pause in one step (no stuck state).
      if (state.paused) expect(nextBargeState(state, { t: "deadline" }).state.paused).toBe(false);
      for (const exit of exits) if (state.paused) expect(nextBargeState(state, exit).state.paused).toBe(false);
    }
  });

  test("the deadline stops her for good only when real words were heard since the pause, else she resumes", () => {
    const paused: BargeState = { paused: true, words: false, outcome: "none" };
    const noWords = nextBargeState(paused, { t: "deadline" });
    expect(kinds(noWords.effects)).toEqual(["trace", "resume"]);
    expect(noWords.state.outcome).toBe("resumed_noise");
    const withWords = nextBargeState({ ...paused, words: true }, { t: "deadline" });
    expect(kinds(withWords.effects)).toContain("stop_reply");
    expect(withWords.state.outcome).toBe("stopped");
  });

  test("a final that is a bare reaction or noise resumes a paused reply and counts a reaction only when words were said", () => {
    const paused: BargeState = { paused: true, words: true, outcome: "none" };
    const reaction = nextBargeState(paused, { t: "final_reaction", words: 1 });
    expect(kinds(reaction.effects)).toContain("resume");
    expect(reaction.effects).toContainEqual({ k: "count", which: "reaction_resume" });
    expect(nextBargeState(paused, { t: "final_reaction", words: 0 }).effects).not.toContainEqual({ k: "count", which: "reaction_resume" });
  });

  test("echo of her own voice resumes a paused reply and is never an interruption", () => {
    const step = nextBargeState({ paused: true, words: false, outcome: "none" }, { t: "final_echo" });
    expect(step.state.outcome).toBe("resumed_echo");
    expect(kinds(step.effects)).not.toContain("stop_reply");
  });

  test("the false-interruption timer starts only after a wordless pause ends its sound", () => {
    expect(kinds(nextBargeState({ paused: true, words: false, outcome: "none" }, { t: "sound_end" }).effects)).toContain("start_false_timer");
    expect(kinds(nextBargeState({ paused: true, words: true, outcome: "none" }, { t: "sound_end" }).effects)).not.toContain("start_false_timer");
    expect(kinds(nextBargeState(BARGE_IDLE, { t: "sound_end" }).effects)).not.toContain("start_false_timer");
  });
});
