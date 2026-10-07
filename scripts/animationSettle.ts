export interface AnimationSettleOptions {
  timeoutMs?: number;
  stableMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Wait until no animation is running for a short stable window. */
export async function waitForAnimationSettle(
  sampleRunning: () => Promise<number>,
  {
    timeoutMs = 5000,
    stableMs = 150,
    pollMs = 25,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: AnimationSettleOptions = {},
): Promise<void> {
  const startedAt = now();
  let quietSince: number | null = null;
  let lastRunning = 0;

  while (true) {
    lastRunning = await sampleRunning();
    const elapsed = now() - startedAt;
    if (lastRunning === 0) {
      quietSince ??= now();
      if (now() - quietSince >= stableMs) return;
    } else {
      quietSince = null;
    }

    if (elapsed >= timeoutMs) {
      throw new Error(`animations did not settle within ${timeoutMs}ms (${lastRunning} still running)`);
    }
    await sleep(Math.min(pollMs, timeoutMs - elapsed));
  }
}
