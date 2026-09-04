import { describe, expect, test, afterEach } from "bun:test";
import { WakeWordLoop } from "@/lib/voice/wake-word-loop";
import { setSessionFactory, type SessionFactory, type WakeWordInferenceSession, type WakeWordTensor } from "@/lib/voice/wake-word-runtime";
import { WAKE_WORD_FRAME_SAMPLES, EMBEDDING_DIM, MEL_FEATURE_DIM, MEL_BUFFER_SEED_FRAMES } from "@/lib/voice/wake-word-pipeline";
import { onWakeDetected } from "@/lib/voice/wake-word-events";

// Fakes onnxruntime-web entirely (no real WASM in happy-dom) so the
// LOOP's own logic - hysteresis, score smoothing, threshold, warmup,
// post-wake suppression, buffer reset on enable - can be driven
// deterministically. The mel/embedding sessions just need to return
// correctly-shaped output for inferOnce()'s real DSP math (windowing,
// the x/10+2 transform, buffer slicing) to run without throwing; only
// the detector session's score is what each test actually controls.
class FakeSessionFactory implements SessionFactory {
  nextScores: number[] = [];

  async create(modelPath: string): Promise<WakeWordInferenceSession> {
    if (modelPath.includes("melspectrogram")) {
      return {
        run: async () => ({
          output: { data: new Float32Array(MEL_BUFFER_SEED_FRAMES * MEL_FEATURE_DIM), dims: [] },
        }),
      };
    }
    if (modelPath.includes("embedding")) {
      return {
        run: async () => ({ output: { data: new Float32Array(EMBEDDING_DIM), dims: [] } }),
      };
    }
    // The detector: pops the next programmed score (0 once the queue is
    // empty, matching "nothing happening").
    return {
      run: async () => {
        const score = this.nextScores.shift() ?? 0;
        return { output: { data: new Float32Array([score]), dims: [] } };
      },
    };
  }

  tensor(data: Float32Array, dims: readonly number[]): WakeWordTensor {
    return { data, dims };
  }
}

let factory: FakeSessionFactory;

afterEach(() => {
  setSessionFactory(null);
});

function makeFrame(): Float32Array {
  return new Float32Array(WAKE_WORD_FRAME_SAMPLES);
}

async function pushFrames(loop: WakeWordLoop, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    loop.pushFrame(makeFrame());
    await loop.flush();
  }
}

function setUp(): FakeSessionFactory {
  factory = new FakeSessionFactory();
  setSessionFactory(factory);
  return factory;
}

describe("WakeWordLoop", () => {
  test("never runs inference while disabled", async () => {
    setUp();
    const loop = new WakeWordLoop();
    // enabled defaults to false; pushFrame() should no-op entirely.
    loop.pushFrame(makeFrame());
    await loop.flush();
    // No pipeline was ever created if inference never ran - inferring
    // stays null and flush() resolves immediately either way, so the
    // real proof is that no wake event fires even with a maximal score
    // queued.
    factory.nextScores = [1, 1, 1, 1, 1];
    let fired = false;
    const unsub = onWakeDetected(() => {
      fired = true;
    });
    loop.setEnabled(false); // still disabled
    await pushFrames(loop, 10);
    unsub();
    expect(fired).toBe(false);
  });

  test("a single high-score frame does not fire (hysteresis requires 2 consecutive)", async () => {
    setUp();
    const loop = new WakeWordLoop({ thresholdOverride: 0.5 });
    loop.setEnabled(true);
    // Warmup frames (WARMUP_ZERO_FRAMES) always score 0 regardless of the
    // queue, so push extra harmless frames first to get past warmup.
    await pushFrames(loop, 5);
    factory.nextScores = [0.9];
    let fired = false;
    const unsub = onWakeDetected(() => {
      fired = true;
    });
    await pushFrames(loop, 1);
    unsub();
    expect(fired).toBe(false);
  });

  test("a sustained run of high-score frames fires a wake event", async () => {
    setUp();
    const loop = new WakeWordLoop({ thresholdOverride: 0.5 });
    loop.setEnabled(true);
    await pushFrames(loop, 5); // clear warmup
    // The 4-frame trailing smoothing window still holds the warmup
    // period's zeros right after warmup ends, so the smoothed score only
    // clears 0.5 once the window is saturated with real high scores -
    // fewer raw high frames than the 2-frame hysteresis check alone would
    // suggest. Four is enough to fully displace the warmup zeros AND
    // satisfy hysteresis.
    factory.nextScores = [0.9, 0.9, 0.9, 0.9];
    let event: { modelId: string; score: number } | null = null;
    const unsub = onWakeDetected((e) => {
      event = e;
    });
    await pushFrames(loop, 4);
    unsub();
    expect(event).not.toBeNull();
    expect(event!.modelId).toBe("hey_jarvis");
  });

  test("a score below threshold never fires, no matter how many frames", async () => {
    setUp();
    const loop = new WakeWordLoop({ thresholdOverride: 0.5 });
    loop.setEnabled(true);
    await pushFrames(loop, 5);
    factory.nextScores = new Array(10).fill(0.3);
    let fired = false;
    const unsub = onWakeDetected(() => {
      fired = true;
    });
    await pushFrames(loop, 10);
    unsub();
    expect(fired).toBe(false);
  });

  test("post-wake suppression: a second fire within 1s of the first is swallowed", async () => {
    setUp();
    let now = 0;
    const loop = new WakeWordLoop({ thresholdOverride: 0.5, now: () => now });
    loop.setEnabled(true);
    await pushFrames(loop, 5);
    factory.nextScores = [0.9, 0.9, 0.9, 0.9];
    const events: unknown[] = [];
    const unsub = onWakeDetected((e) => events.push(e));
    await pushFrames(loop, 4); // fires once, once the smoothing window saturates
    now += 500; // still within the 1000ms suppression window
    // The smoothing window is already saturated with 0.9s from the first
    // fire, so hysteresis alone (2 consecutive) would be satisfied here -
    // queuing two more high scores means this genuinely exercises
    // suppression, not just "no more high scores were queued."
    factory.nextScores = [0.9, 0.9];
    await pushFrames(loop, 2); // would fire again if not suppressed
    unsub();
    expect(events.length).toBe(1);
  });

  test("a fire after the suppression window elapses is allowed", async () => {
    setUp();
    let now = 0;
    const loop = new WakeWordLoop({ thresholdOverride: 0.5, now: () => now });
    loop.setEnabled(true);
    await pushFrames(loop, 5);
    factory.nextScores = [0.9, 0.9, 0.9, 0.9];
    const events: unknown[] = [];
    const unsub = onWakeDetected((e) => events.push(e));
    await pushFrames(loop, 4); // fires once, once the smoothing window saturates
    now += 1500; // past the 1000ms suppression window
    // The smoothing window is already saturated with 0.9s from the first
    // fire, so only 2 more (hysteresis's own minimum) are needed this time.
    factory.nextScores = [0.9, 0.9];
    await pushFrames(loop, 2);
    unsub();
    expect(events.length).toBe(2);
  });

  test("the first WARMUP_ZERO_FRAMES frames never fire even at a maximal score", async () => {
    setUp();
    const loop = new WakeWordLoop({ thresholdOverride: 0.5 });
    loop.setEnabled(true);
    // No warmup skip this time - drive a high score from frame 0.
    factory.nextScores = new Array(6).fill(1);
    let fired = false;
    const unsub = onWakeDetected(() => {
      fired = true;
    });
    await pushFrames(loop, 5); // still inside the warmup window
    unsub();
    expect(fired).toBe(false);
  });

  test("disabling and re-enabling resets state so old scores can't carry over", async () => {
    setUp();
    const loop = new WakeWordLoop({ thresholdOverride: 0.5 });
    loop.setEnabled(true);
    await pushFrames(loop, 5);
    factory.nextScores = [0.9]; // one high frame - not enough to fire alone
    await pushFrames(loop, 1);
    loop.setEnabled(false);
    loop.setEnabled(true);
    // Re-armed: warmup restarts, so this next high frame must NOT combine
    // with the pre-disable one to fire immediately.
    factory.nextScores = [0.9];
    let fired = false;
    const unsub = onWakeDetected(() => {
      fired = true;
    });
    await pushFrames(loop, 1);
    unsub();
    expect(fired).toBe(false);
  });

  test("threshold() falls back to 0.5 for a non-finite override", async () => {
    setUp();
    const loop = new WakeWordLoop({ thresholdOverride: Number.NaN });
    expect(loop.threshold()).toBe(0.5);
  });
});
