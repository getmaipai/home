// COR-3 (code review, 2026-09-06): index.ts's onLeafRenewed() listener
// used to run `server.stop(true); server = Bun.serve(...)` with no
// try/catch, called synchronously from inside ensureHouseholdLeaf()'s own
// listener loop - a bind failure (port briefly held, EADDRINUSE, or a bad
// PEM) threw straight out of that loop, through ensureHouseholdLeaf(),
// and out of whichever caller awaited it (GET /api/setup/ca, an
// unauthenticated first-run route), leaving the hub with no listener at
// all until someone manually restarted the process. Pulled out as its
// own small, pure-ish retry helper (index.ts itself is never imported by
// the test suite - app.ts/routes stay import-only precisely so booting
// the app under test never starts a real listener, per
// tests/tlsHotSwap.test.ts's own header) so the retry/failure behavior is
// directly testable without needing a real leaf-renewal event.
export interface RebindResult<T> {
  server: T;
  attempts: number;
}

/** Retries `attempt` (a synchronous `Bun.serve()` call, or anything else
 * that can throw) up to `maxAttempts` times with a short delay between
 * tries - long enough for a port the just-stopped server briefly still
 * held to actually free up, not long enough to matter for a genuinely
 * bad certificate (which will just fail every attempt identically).
 * Throws the LAST attempt's own error if every attempt fails, so the
 * caller's real failure handling (logging, raising a Repairs issue) sees
 * the actual cause, not a generic "gave up" wrapper. */
export async function rebindWithRetry<T>(attempt: () => T, maxAttempts = 3, delayMs = 200): Promise<RebindResult<T>> {
  let lastErr: unknown;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return { server: attempt(), attempts: i };
    } catch (err) {
      lastErr = err;
      if (i < maxAttempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}
