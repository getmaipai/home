import { describe, expect, test } from "bun:test";
import {
  CHIME,
  CUES,
  MIN_DWELL_MS,
  cueForRing,
  createFaceCaptureSounds,
} from "@/lib/vision/faceCaptureSounds";
import { FakeContext } from "../../../tests/fakeSoundContext";

// FACE-02M: the four enrollment cues, driven with a fake AudioContext
// that records every oscillator the module starts, and a fake clock, so
// the cue mapping, edge-triggering, dwell and cleanup are proven without
// any audio hardware. What the cues SOUND like is Jesse's judgment.

class FakeClock {
  t = 0;
  private timers: Array<{ at: number; fn: () => void; id: number; live: boolean }> = [];
  private n = 0;
  now = () => this.t;
  schedule = (fn: () => void, ms: number) => {
    const timer = { at: this.t + ms, fn, id: (this.n += 1), live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  };
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.live && x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      due.live = false;
      this.t = due.at;
      due.fn();
    }
    this.t = end;
  }
  pending() {
    return this.timers.filter((x) => x.live).length;
  }
}

function setup(state: "suspended" | "running" = "running", stubborn = false) {
  const clock = new FakeClock();
  const ctx = new FakeContext(state, stubborn);
  let factoryCalls = 0;
  const sounds = createFaceCaptureSounds({
    createContext: () => {
      factoryCalls += 1;
      return ctx;
    },
    now: clock.now,
    schedule: clock.schedule,
  });
  return { clock, ctx, sounds, factoryCalls: () => factoryCalls };
}

const freqs = (ctx: FakeContext) => ctx.started.map((s) => s.freq);

describe("cueForRing", () => {
  test("none is scanning, yellow is soft, green is ready", () => {
    expect(cueForRing("none")).toBe("scanning");
    expect(cueForRing("yellow")).toBe("soft");
    expect(cueForRing("green")).toBe("ready");
  });
});

describe("the four cues are a progression a person can learn", () => {
  test("pitch and loudness rise from scanning to soft to ready to the chime", () => {
    expect(CUES.scanning.freq).toBeLessThan(CUES.soft.freq);
    expect(CUES.scanning.gain).toBeLessThan(CUES.soft.gain);
    expect(CUES.soft.gain).toBeLessThanOrEqual(CUES.ready.gain);
    expect(CUES.soft.freq).toBeLessThan(CUES.ready.freq);
    expect(CUES.ready.freq).toBeLessThan(CHIME.partials[0]!.freq);
    expect(CHIME.partials[0]!.gain).toBeGreaterThan(CUES.ready.gain);
    // modest volume: nothing above a third of full scale
    for (const g of [CUES.scanning.gain, CUES.soft.gain, CUES.ready.gain, ...CHIME.partials.map((p) => p.gain)]) expect(g).toBeLessThanOrEqual(0.33);
  });
});

describe("each ring state starts its own cue", () => {
  test("scanning is a quiet repeating tick at its own frequency", async () => {
    const { clock, ctx, sounds } = setup();
    await sounds.unlock();
    sounds.setCue("scanning");
    expect(freqs(ctx)).toEqual([CUES.scanning.freq]);
    expect(ctx.started[0]!.peak).toBeCloseTo(CUES.scanning.gain);
    clock.advance(CUES.scanning.everyMs * 3);
    expect(ctx.started.length).toBe(4);
    expect(new Set(freqs(ctx))).toEqual(new Set([CUES.scanning.freq]));
    sounds.stop();
  });

  test("soft (yellow) is a clearer, steadier pulse than scanning", async () => {
    const { clock, ctx, sounds } = setup();
    await sounds.unlock();
    sounds.setCue("soft");
    expect(freqs(ctx)).toEqual([CUES.soft.freq]);
    expect(ctx.started[0]!.type).toBe(CUES.soft.wave);
    expect(CUES.soft.everyMs).toBeLessThan(CUES.scanning.everyMs);
    clock.advance(CUES.soft.everyMs * 2);
    expect(ctx.started.length).toBe(3);
    sounds.stop();
  });

  test("ready (green) is one continuous higher tone, not a repeating blip", async () => {
    const { clock, ctx, sounds } = setup();
    await sounds.unlock();
    sounds.setCue("ready");
    expect(freqs(ctx)).toEqual([CUES.ready.freq]);
    expect(ctx.started[0]!.stop).toBeNull();
    clock.advance(5000);
    expect(ctx.started.length).toBe(1);
    expect(clock.pending()).toBe(0);
    sounds.stop();
  });

  test("captured is one chime with its own partials", async () => {
    const { ctx, sounds } = setup();
    await sounds.unlock();
    sounds.captured();
    expect(freqs(ctx)).toEqual(CHIME.partials.map((p) => p.freq));
    expect(ctx.started.every((s) => s.stop !== null)).toBe(true);
    sounds.stop();
  });
});

describe("edge-triggering and dwell", () => {
  test("a steady state plays no extra cue beyond its own loop", async () => {
    const { ctx, sounds } = setup();
    await sounds.unlock();
    sounds.setCue("ready");
    sounds.setCue("ready");
    sounds.setCue("ready");
    expect(ctx.started.length).toBe(1);
    sounds.stop();
  });

  test("a flicker inside the dwell does not start a burst of cues", async () => {
    const { clock, ctx, sounds } = setup();
    await sounds.unlock();
    sounds.setCue("scanning");
    const before = ctx.started.length;
    clock.advance(50);
    sounds.setCue("soft");
    clock.advance(50);
    sounds.setCue("ready");
    clock.advance(50);
    sounds.setCue("soft");
    clock.advance(50);
    sounds.setCue("scanning");
    // ended back where it started: nothing new, and no switch pending
    expect(ctx.started.length).toBe(before);
    clock.advance(MIN_DWELL_MS * 2);
    expect(ctx.started.length).toBe(before);
    sounds.stop();
  });

  test("a change requested inside the dwell lands when the dwell ends", async () => {
    const { clock, ctx, sounds } = setup();
    await sounds.unlock();
    sounds.setCue("scanning");
    clock.advance(100);
    sounds.setCue("ready");
    expect(freqs(ctx)).toEqual([CUES.scanning.freq]);
    clock.advance(MIN_DWELL_MS);
    expect(freqs(ctx)).toEqual([CUES.scanning.freq, CUES.ready.freq]);
    sounds.stop();
  });

  test("the scanning tick stops the moment a face is found", async () => {
    const { clock, ctx, sounds } = setup();
    await sounds.unlock();
    sounds.setCue("scanning");
    clock.advance(MIN_DWELL_MS);
    sounds.setCue("soft");
    const n = ctx.started.filter((s) => s.freq === CUES.scanning.freq).length;
    clock.advance(CUES.scanning.everyMs * 5);
    expect(ctx.started.filter((s) => s.freq === CUES.scanning.freq).length).toBe(n);
    sounds.stop();
  });

  test("leaving ready fades the held tone out and releases its nodes", async () => {
    const { clock, ctx, sounds } = setup();
    await sounds.unlock();
    sounds.setCue("ready");
    clock.advance(MIN_DWELL_MS);
    sounds.setCue("soft");
    expect(ctx.started[0]!.stop).not.toBeNull();
    ctx.finishAll();
    expect(ctx.started[0]!.disconnected).toBe(true);
    sounds.stop();
  });
});

describe("the chime", () => {
  // FACE-02P: Jesse found the 700 ms chime too long. Short and crisp:
  // a quick attack and a quick decay, the same two-note pitch.
  test("is short and crisp: about a quarter second, every voice stopped by then", async () => {
    expect(CHIME.durationMs).toBeGreaterThanOrEqual(250);
    expect(CHIME.durationMs).toBeLessThanOrEqual(300);
    expect(CHIME.attackMs).toBeLessThanOrEqual(10);
    expect(CHIME.partials.map((p) => p.freq)).toEqual([1568, 2349]);
    const { ctx, sounds } = setup();
    await sounds.unlock();
    sounds.captured();
    for (const voice of ctx.started) {
      expect(voice.stop! - voice.start).toBeLessThanOrEqual(0.32);
      expect(voice.stop! - voice.start).toBeGreaterThanOrEqual(CHIME.durationMs / 1000);
    }
    sounds.stop();
  });

  test("never overlaps itself, then plays again once it has finished", async () => {
    const { clock, ctx, sounds } = setup();
    await sounds.unlock();
    sounds.captured();
    clock.advance(100);
    sounds.captured();
    expect(ctx.started.length).toBe(CHIME.partials.length);
    clock.advance(CHIME.durationMs);
    sounds.captured();
    expect(ctx.started.length).toBe(CHIME.partials.length * 2);
    sounds.stop();
  });
});

describe("autoplay: a suspended context", () => {
  test("nothing is queued while suspended, so a later resume is not a burst", async () => {
    const { clock, ctx, sounds } = setup("suspended", true);
    await sounds.unlock();
    expect(ctx.state).toBe("suspended");
    sounds.setCue("scanning");
    sounds.captured();
    clock.advance(10_000);
    expect(ctx.started.length).toBe(0);
    sounds.stop();
  });

  test("once a gesture lets it run, the current cue starts", async () => {
    const { ctx, sounds } = setup("suspended");
    sounds.setCue("ready");
    expect(ctx.started.length).toBe(0);
    await sounds.unlock();
    expect(freqs(ctx)).toEqual([CUES.ready.freq]);
    sounds.stop();
  });

  test("a context factory that throws leaves the page silent, not broken", async () => {
    const sounds = createFaceCaptureSounds({
      createContext: () => {
        throw new Error("no audio");
      },
    });
    await sounds.unlock();
    sounds.setCue("scanning");
    sounds.captured();
    sounds.stop();
  });
});

describe("everything stops", () => {
  test("stop silences the tick loop, the held tone and pending timers, and closes the context", async () => {
    const { clock, ctx, sounds } = setup();
    await sounds.unlock();
    sounds.setCue("scanning");
    clock.advance(100);
    sounds.setCue("ready");
    sounds.stop();
    expect(clock.pending()).toBe(0);
    const n = ctx.started.length;
    clock.advance(20_000);
    expect(ctx.started.length).toBe(n);
    expect(ctx.closed).toBe(true);
    sounds.setCue("soft");
    sounds.captured();
    expect(ctx.started.length).toBe(n);
  });

  test("stop while the ready tone is held ends that tone", async () => {
    const { ctx, sounds } = setup();
    await sounds.unlock();
    sounds.setCue("ready");
    sounds.stop();
    expect(ctx.started[0]!.stop).not.toBeNull();
  });

  test("a hidden tab silences everything and a visible tab brings the current cue back", async () => {
    const { clock, ctx, sounds } = setup();
    await sounds.unlock();
    sounds.setCue("soft");
    sounds.setMuted(true);
    const n = ctx.started.length;
    clock.advance(10_000);
    sounds.setCue("ready");
    sounds.captured();
    expect(ctx.started.length).toBe(n);
    expect(clock.pending()).toBe(0);
    sounds.setMuted(false);
    expect(ctx.started.at(-1)!.freq).toBe(CUES.ready.freq);
    sounds.stop();
  });
});
