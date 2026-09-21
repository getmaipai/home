import { describe, expect, test } from "bun:test";

// getmaipai/home#90: sw.ts's own header comment claims Firefox gets "no
// fetch interception at all", but a code review found `precacheAndRoute()`
// registered its own 'fetch' listener unconditionally - only the navigate
// listener's registration was gated on `PASSTHROUGH`. Fixed by moving both
// under the one `if (!PASSTHROUGH)` block in sw.ts. Verified here against
// the REAL built module (not a reimplementation of its logic) rather than
// in an actual browser:
// Playwright's own Firefox build cannot start in this environment
// ("Could not find profile folder" in headless mode, on the one retry a
// standing rule now allows - see docs/dev/session-b.md for the record
// and the two-step check Jesse can run in his own Firefox instead).
//
// `self` is a plain worker global, not a DOM window - safe to fully
// replace on `globalThis` for the module's own lifetime, and every test
// below restores it. `sw.ts` runs its `self.addEventListener(...)` calls
// as top-level side effects on import, so each scenario needs a genuinely
// fresh module evaluation: a cache-busting query string on the import
// specifier (the same trick a browser or bundler would use) gives each
// call its own module instance instead of bun's normal per-specifier
// cache returning the first run's already-executed module.
function fakeServiceWorkerGlobal(userAgent: string) {
  const listenersByType = new Map<string, unknown[]>();
  const skipWaitingCalls = { count: 0 };
  const fakeSelf = {
    navigator: { userAgent },
    // Empty, not the real build's manifest: this test proves how many
    // listeners get registered, not what they precache - workbox's own
    // `addToCacheList()` accepts an empty array as a normal, valid case.
    __WB_MANIFEST: [] as unknown[],
    addEventListener(type: string, fn: unknown) {
      listenersByType.set(type, [...(listenersByType.get(type) ?? []), fn]);
    },
    skipWaiting() {
      skipWaitingCalls.count += 1;
    },
    clients: { claim: async () => undefined },
  };
  return { fakeSelf, listenersByType, skipWaitingCalls };
}

async function loadSwWithUserAgent(
  userAgent: string,
  cacheBuster: string,
): Promise<{ fakeSelf: ReturnType<typeof fakeServiceWorkerGlobal>["fakeSelf"]; listenersByType: Map<string, unknown[]>; skipWaitingCalls: { count: number } }> {
  const { fakeSelf, listenersByType, skipWaitingCalls } = fakeServiceWorkerGlobal(userAgent);
  const previousSelf = (globalThis as { self?: unknown }).self;
  (globalThis as { self?: unknown }).self = fakeSelf;
  try {
    await import(`./sw.ts?${cacheBuster}`);
  } finally {
    (globalThis as { self?: unknown }).self = previousSelf;
  }
  return { fakeSelf, listenersByType, skipWaitingCalls };
}

describe("sw.ts (getmaipai/home#90): Firefox gets zero 'fetch' listeners, not one that always declines", () => {
  // One test, not two, and Firefox always runs first: workbox-precaching/
  // workbox-routing keep their OWN module-level singletons (the shared
  // router `precacheAndRoute()` registers its route on) across both
  // `import("./sw.ts?...")` calls below, since only the `sw.ts` specifier
  // itself is cache-busted, not its imports - a code review, 2026-09-13,
  // pointed out that two separate `test()` blocks make that ordering an
  // accident of declaration order rather than something this file
  // guarantees, so a reordering or an added third scenario could silently
  // change what the "Chromium" case actually measures. Firefox's own run
  // never touches that router at all (its whole `if (!PASSTHROUGH)` block
  // is skipped), so running it first and asserting zero is safe regardless;
  // Chromium's count is asserted as "at least one" rather than a specific
  // number for the same reason - the exact composition of workbox's
  // internal registrations isn't this file's contract to pin down, only
  // that some real interception is still happening for non-Firefox.
  test("Firefox: zero; Chromium: some (real interception still happens elsewhere)", async () => {
    const firefoxListeners = await loadSwWithUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0",
      "ua=firefox",
    );
    expect(firefoxListeners.listenersByType.get("fetch") ?? []).toHaveLength(0);

    const chromiumListeners = await loadSwWithUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "ua=chromium",
    );
    expect((chromiumListeners.listenersByType.get("fetch") ?? []).length).toBeGreaterThan(0);
  });

  test("a new worker skips waiting on install (home#128)", async () => {
    const { fakeSelf, listenersByType, skipWaitingCalls } = await loadSwWithUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "ua=chromium-install",
    );
    const installListeners = listenersByType.get("install") ?? [];
    expect(installListeners).toHaveLength(1);
    expect(skipWaitingCalls.count).toBe(0);
    const previousSelf = (globalThis as { self?: unknown }).self;
    (globalThis as { self?: unknown }).self = fakeSelf;
    try {
      (installListeners[0] as (event: unknown) => void)({});
    } finally {
      (globalThis as { self?: unknown }).self = previousSelf;
    }
    expect(skipWaitingCalls.count).toBe(1);
  });
});
