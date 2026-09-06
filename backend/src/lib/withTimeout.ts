// COR-2 (code review, 2026-09-06): the "race a promise against a
// setTimeout rejection, clear the timer either way" shape was hand-
// copied three times - routes/host.ts's engine restart wait,
// lib/modelDownload.ts's per-chunk stall detector, and this fix's own
// scheduler.ts per-job budget - each with its own comment about the
// timer-leak bug host.ts's history already found once. One definition
// now; `onTimeout` is a factory (not a fixed message) so each caller's
// own error type/wording survives the extraction unchanged (scheduler.ts
// needs a distinct JobTimeoutError to tell a timeout apart from an
// ordinary job failure; host.ts and modelDownload.ts just want a plain
// Error with their own message).
export async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
