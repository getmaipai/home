export interface AnimationSettleOptions {
  timeoutMs?: number;
  quietMs?: number;
  pollMs?: number;
  now?: () => number;
}

/** Wait until no animation is active for a continuous quiet window. */
export async function waitForAnimationSettle(
  readActiveCount: () => Promise<number>,
  wait: (ms: number) => Promise<unknown>,
  options: AnimationSettleOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const quietMs = options.quietMs ?? 100;
  const pollMs = options.pollMs ?? 25;
  const now = options.now ?? (() => performance.now());
  const deadline = now() + timeoutMs;
  let quietSince: number | undefined;
  let activeCount: number | undefined;
  const timeoutMessage = () => activeCount === undefined
    ? `timed out after ${timeoutMs}ms before animation state could be read`
    : `timed out after ${timeoutMs}ms with ${activeCount} animation(s) still running or pending`;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const boundedTimeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage()));
    }, timeoutMs);
  });

  const pollUntilQuiet = async () => {
    while (true) {
      activeCount = await readActiveCount();
      const sampledAt = now();
      if (sampledAt >= deadline) {
        throw new Error(`timed out after ${timeoutMs}ms with ${activeCount} animation(s) still running or pending`);
      }

      if (activeCount === 0) {
        quietSince ??= sampledAt;
        if (sampledAt - quietSince >= quietMs) return;
      } else {
        quietSince = undefined;
      }

      const remainingMs = deadline - now();
      if (remainingMs <= 0) break;
      await wait(Math.min(pollMs, remainingMs));
    }
  };

  try {
    await Promise.race([pollUntilQuiet(), boundedTimeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
