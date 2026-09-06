import { describe, expect, test } from "bun:test";
import {
  MAX_BOOT_RETRIES,
  getRetryCount,
  installReloadOnceOnNewServiceWorker,
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

describe("installReloadOnceOnNewServiceWorker", () => {
  test("reloads on controllerchange when a worker was already controlling this page, but never a second time in the same page life", () => {
    const listeners = new Map<string, EventListener[]>();
    let reloads = 0;
    const container = {
      controller: {} as ServiceWorker,
      addEventListener: (type: string, fn: EventListener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
    } as unknown as ServiceWorkerContainer;
    const win = { location: { reload: () => reloads++ } } as unknown as Window;

    installReloadOnceOnNewServiceWorker(container, win);
    const fire = () => {
      for (const fn of listeners.get("controllerchange") ?? []) fn(new Event("controllerchange"));
    };
    fire();
    fire();

    expect(reloads).toBe(1);
  });

  test("does nothing on a page's first-ever load, with no prior controller (the false-positive a code review found: axe's own scan destroyed mid-navigation on route 1 of every fresh browser context)", () => {
    const listeners = new Map<string, EventListener[]>();
    let reloads = 0;
    const container = {
      controller: null,
      addEventListener: (type: string, fn: EventListener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
    } as unknown as ServiceWorkerContainer;
    const win = { location: { reload: () => reloads++ } } as unknown as Window;

    installReloadOnceOnNewServiceWorker(container, win);
    for (const fn of listeners.get("controllerchange") ?? []) fn(new Event("controllerchange"));

    expect(reloads).toBe(0);
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
