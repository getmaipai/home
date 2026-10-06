import { describe, expect, test } from "bun:test";
import {
  MAX_BOOT_RETRIES,
  getRetryCount,
  installHiddenReloadOnNewServiceWorker,
  installStaleChunkRetry,
  runBootWatchdog,
} from "@/lib/pwaBoot";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("installStaleChunkRetry", () => {
  test("reloads once on a stale-chunk preload error", () => {
    const storage = fakeStorage();
    const listeners = new Map<string, EventListener[]>();
    let reloads = 0;
    const win = {
      addEventListener: (type: string, fn: EventListener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      location: { reload: () => reloads++ },
    } as unknown as Window;

    installStaleChunkRetry(win, storage);
    for (const fn of listeners.get("vite:preloadError") ?? []) fn(new Event("vite:preloadError"));

    expect(reloads).toBe(1);
    expect(getRetryCount(storage, "maipai:reload-retry-count")).toBe(1);
  });

  // Found by review (lane 10 item 2, 2026-09-13, reading Vite's own
  // source): `handlePreloadError` re-throws the original rejection
  // whenever nothing calls `preventDefault()` on this cancelable event,
  // so a stale-chunk import still crashed to the nearest ErrorBoundary
  // on its way to the reload this listener already schedules.
  test("suppresses the original rejection so it never reaches an ErrorBoundary", () => {
    const storage = fakeStorage();
    const listeners = new Map<string, EventListener[]>();
    const win = {
      addEventListener: (type: string, fn: EventListener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      location: { reload: () => {} },
    } as unknown as Window;

    installStaleChunkRetry(win, storage);
    const event = new Event("vite:preloadError", { cancelable: true });
    for (const fn of listeners.get("vite:preloadError") ?? []) fn(event);

    expect(event.defaultPrevented).toBe(true);
  });

  test("stops retrying past the cap instead of reloading forever", () => {
    const storage = fakeStorage();
    storage.setItem("maipai:reload-retry-count", "3");
    const listeners = new Map<string, EventListener[]>();
    let reloads = 0;
    const win = {
      addEventListener: (type: string, fn: EventListener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      location: { reload: () => reloads++ },
    } as unknown as Window;

    installStaleChunkRetry(win, storage);
    for (const fn of listeners.get("vite:preloadError") ?? []) fn(new Event("vite:preloadError"));

    expect(reloads).toBe(0);
  });
});

// Owner's report, 2026-10-06: "the site reloads twice when I force
// refresh". The first load after every hub restart found a new worker,
// which took control and fired `controllerchange`, and the boot code
// reloaded the page on the spot: two document loads (measured by
// `scripts/screenshot.ts --shell-nav-review`, "reload-after-deploy").
function fakeWorkerPage(controlled: boolean, visibility: DocumentVisibilityState) {
  const listeners = new Map<string, EventListener[]>();
  const on = (type: string, fn: EventListener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  const fire = (type: string) => { for (const fn of listeners.get(type) ?? []) fn(new Event(type)); };
  const state = { reloads: 0, visibility };
  const container = { controller: controlled ? ({} as ServiceWorker) : null, addEventListener: on } as unknown as ServiceWorkerContainer;
  const doc = { get visibilityState() { return state.visibility; }, addEventListener: on } as unknown as Document;
  const win = { location: { reload: () => state.reloads++ } } as unknown as Window;
  installHiddenReloadOnNewServiceWorker(container, doc, win);
  return { state, fire };
}

describe("a new service worker taking control", () => {
  test("never reloads a page the person is looking at", () => {
    const { state, fire } = fakeWorkerPage(true, "visible");
    fire("controllerchange");
    expect(state.reloads).toBe(0);
  });

  test("reloads a tab left open across the update once, when it is hidden", () => {
    const { state, fire } = fakeWorkerPage(true, "visible");
    fire("controllerchange");
    state.visibility = "hidden";
    fire("visibilitychange");
    fire("visibilitychange");
    fire("controllerchange");
    expect(state.reloads).toBe(1);
  });

  test("reloads at once when the update lands while the tab is already hidden", () => {
    const { state, fire } = fakeWorkerPage(true, "hidden");
    fire("controllerchange");
    expect(state.reloads).toBe(1);
  });

  test("does nothing without an update, or on a first-ever load with no prior controller", () => {
    const idle = fakeWorkerPage(true, "visible");
    idle.state.visibility = "hidden";
    idle.fire("visibilitychange");
    expect(idle.state.reloads).toBe(0);
    const first = fakeWorkerPage(false, "hidden");
    first.fire("controllerchange");
    expect(first.state.reloads).toBe(0);
  });
});

describe("the shared reload budget", () => {
  test("a stale-chunk reload and a boot-watchdog reload draw from the same cap, not one each", () => {
    const storage = fakeStorage();
    let reloads = 0;
    const listeners = new Map<string, EventListener[]>();
    const win = {
      addEventListener: (type: string, fn: EventListener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      setTimeout: () => 1,
      clearTimeout: () => {},
      location: { reload: () => reloads++ },
    } as unknown as Window;

    installStaleChunkRetry(win, storage);
    for (let i = 0; i < MAX_BOOT_RETRIES; i++) {
      for (const fn of listeners.get("vite:preloadError") ?? []) fn(new Event("vite:preloadError"));
    }
    expect(reloads).toBe(MAX_BOOT_RETRIES);

    // The cap is already spent; a completely separate failure mode (the
    // boot watchdog) must not get its own fresh three attempts.
    let gaveUp = false;
    runBootWatchdog(
      win,
      storage,
      () => {
        throw new Error("boot failed too");
      },
      () => {
        gaveUp = true;
      },
    );

    expect(reloads).toBe(MAX_BOOT_RETRIES);
    expect(gaveUp).toBe(true);
  });
});

describe("runBootWatchdog", () => {
  test("clears the retry count once the app confirms it booted", () => {
    const storage = fakeStorage();
    storage.setItem("maipai:reload-retry-count", "1");
    const win = { setTimeout: () => 1, clearTimeout: () => {}, location: { reload: () => {} } } as unknown as Window;

    runBootWatchdog(
      win,
      storage,
      (confirmBooted) => confirmBooted(),
      () => {
        throw new Error("should not give up when boot succeeds");
      },
    );

    expect(getRetryCount(storage, "maipai:reload-retry-count")).toBe(0);
  });

  test("a synchronous throw during boot reloads and bumps the retry count", () => {
    const storage = fakeStorage();
    let reloads = 0;
    const win = {
      setTimeout: () => 1,
      clearTimeout: () => {},
      location: { reload: () => reloads++ },
    } as unknown as Window;

    runBootWatchdog(
      win,
      storage,
      () => {
        throw new Error("boot failed");
      },
      () => {
        throw new Error("should retry before giving up");
      },
    );

    expect(reloads).toBe(1);
    expect(getRetryCount(storage, "maipai:reload-retry-count")).toBe(1);
  });

  test("gives up instead of reloading once the cap is already reached", () => {
    const storage = fakeStorage();
    storage.setItem("maipai:reload-retry-count", String(MAX_BOOT_RETRIES));
    let reloads = 0;
    let gaveUp = false;
    const win = {
      setTimeout: () => 1,
      clearTimeout: () => {},
      location: { reload: () => reloads++ },
    } as unknown as Window;

    runBootWatchdog(
      win,
      storage,
      () => {
        throw new Error("boot failed again");
      },
      () => {
        gaveUp = true;
      },
    );

    expect(reloads).toBe(0);
    expect(gaveUp).toBe(true);
    // Giving up resets the counter: the next real navigation to this page
    // (not a reload from this watchdog) gets a fresh set of attempts.
    expect(getRetryCount(storage, "maipai:reload-retry-count")).toBe(0);
  });

  test("a watchdog timeout firing before boot confirms also reloads", () => {
    const storage = fakeStorage();
    let firedTimer: (() => void) | undefined;
    const win = {
      setTimeout: (fn: () => void) => {
        firedTimer = fn;
        return 1;
      },
      clearTimeout: () => {},
      location: { reload: () => {} },
    } as unknown as Window;
    let reloads = 0;
    (win.location as { reload: () => void }).reload = () => reloads++;

    runBootWatchdog(
      win,
      storage,
      () => {
        // Never calls confirmBooted - simulating a hang past the
        // synchronous render call (e.g. a stuck lazy import).
      },
      () => {},
    );
    firedTimer?.();

    expect(reloads).toBe(1);
  });
});
