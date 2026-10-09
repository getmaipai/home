import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EngineLink, fullJitterDelay, LINK_BACKOFF_CAP_MS, LINK_PROBE_INTERVAL_MS, LINK_PROBE_TIMEOUT_MS, type LinkDependencies } from "@/lib/stack/link";

type Timer = { at: number; fn: () => void; cancelled: boolean };
let now = 0;
let timers: Timer[];
let spawnCount: number;
let fetchQueue: Array<() => Promise<Response>>;
let logs: Array<{ event: string; fields: Record<string, unknown> }>;
let children: Array<{ once: (event: string, cb: (...args: any[]) => void) => void; kill: () => void }>;
let deps: Partial<LinkDependencies>;

function flushMicrotasks(): Promise<void> { return new Promise((resolve) => setTimeout(resolve, 0)); }
async function tick(ms: number): Promise<void> {
  const target = now + ms;
  while (true) {
    const next = timers.filter((timer) => !timer.cancelled && timer.at <= target).sort((a, b) => a.at - b.at)[0];
    if (!next) break;
    next.cancelled = true;
    now = next.at;
    next.fn();
    await flushMicrotasks();
  }
  now = target;
  await flushMicrotasks();
}
function setup(fetcher?: () => Promise<Response>): void {
  now = 0; timers = []; spawnCount = 0; logs = []; children = [];
  fetchQueue = fetcher ? [fetcher] : [];
  deps = {
    now: () => now,
    random: () => 0.5,
    setTimeout: (fn, delay) => { const timer = { at: now + delay, fn, cancelled: false }; timers.push(timer); return timer as unknown as ReturnType<typeof setTimeout>; },
    clearTimeout: (timer) => { (timer as unknown as Timer).cancelled = true; },
    spawn: (_command, _args, options) => {
      expect(options.stdio).toEqual(["ignore", "ignore", "ignore"]);
      spawnCount++;
      const child = { __exit: null as ((code: number | null, signal: NodeJS.Signals | null) => void) | null, once: (_event: string, cb: (...args: any[]) => void) => { child.__exit = cb as typeof child.__exit; }, kill: () => {} };
      children.push(child);
      return child as any;
    },
    fetch: Object.assign(async (_input: string | Request | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new Error("aborted");
      const response = fetchQueue.shift()?.();
      return response ?? Response.json({ ok: true, contract: 1 });
    }, { preconnect: undefined }),
    hostAllowed: async () => true,
    log: (event, fields) => logs.push({ event, fields }),
  };
}
function config(host = "192.0.2.10") {
  return { host, privateKeyPath: "/private/key", knownHostsPath: "/private/known_hosts" };
}

beforeEach(() => setup());
afterEach(() => { timers = []; });

describe("engine link state machine", () => {
  test.each([
    ["initial", (link: EngineLink) => link.snapshot().state, "offline"],
    ["connecting", (link: EngineLink) => { link.start(); return link.snapshot().state; }, "connecting"],
  ])("reports %s", (_name, read, expected) => {
    const link = new EngineLink(config(), deps);
    expect((read as (link: EngineLink) => string)(link)).toBe(expected);
    link.stop();
  });

  test("moves connecting to ready after a healthy contract probe, then probes every 10 seconds", async () => {
    const link = new EngineLink(config(), deps);
    link.start(); await flushMicrotasks();
    expect(link.snapshot().state).toBe("ready");
    expect(link.snapshot().path).toBe("home");
    expect(timers.some((timer) => timer.at === LINK_PROBE_INTERVAL_MS)).toBe(true);
    await tick(LINK_PROBE_INTERVAL_MS);
    expect(link.snapshot().state).toBe("ready");
    link.stop();
  });

  test("records a failed probe then reconnects after backoff", async () => {
    setup(() => Promise.resolve(new Response("", { status: 503 })));
    const link = new EngineLink(config(), deps);
    link.start(); await flushMicrotasks();
    expect(link.snapshot().state).toBe("connecting");
    expect(link.snapshot().reason).toBe("link_stack_down");
    expect(timers.some((timer) => timer.at === 500)).toBe(true);
    await tick(500);
    expect(spawnCount).toBe(2);
    link.stop();
  });

  test("takes a non-retryable outside-home failure straight offline", async () => {
    deps.hostAllowed = async () => false;
    const link = new EngineLink(config(), deps);
    link.start(); await flushMicrotasks();
    expect(link.snapshot()).toMatchObject({ state: "offline", reason: "link_outside_home" });
    expect(spawnCount).toBe(0);
    link.stop();
  });

  test("calls fail immediately while connecting or offline", async () => {
    const link = new EngineLink(config(), deps);
    expect(() => link.assertReady()).toThrow("unreachable");
    link.start();
    expect(() => link.assertReady()).toThrow("unreachable");
    await flushMicrotasks();
    expect(() => link.assertReady()).not.toThrow();
    link.stop();
    expect(() => link.assertReady()).toThrow("unreachable");
  });

  test("fails the contract range offline with needs-update", async () => {
    setup(() => Promise.resolve(Response.json({ ok: true, contract: 999 })));
    const link = new EngineLink(config(), deps);
    link.start(); await flushMicrotasks();
    expect(link.snapshot()).toMatchObject({ state: "offline", reason: "link_needs_update", contract: "999" });
    link.stop();
  });

  test("never logs host addresses, including when SSH fails", async () => {
    const link = new EngineLink(config(), deps);
    link.start(); await flushMicrotasks();
    (children[0] as any).__exit?.(255, null);
    await flushMicrotasks();
    expect(JSON.stringify(logs)).not.toContain("192.0.2.10");
    link.stop();
  });

  test("probes carry the bounded 3 second timeout", () => {
    expect(LINK_PROBE_TIMEOUT_MS).toBe(3_000);
  });
});

describe("full jitter backoff", () => {
  test("stays inside every exponential window and caps at 60 seconds", () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const ceiling = Math.min(LINK_BACKOFF_CAP_MS, 1_000 * 2 ** attempt);
      expect(fullJitterDelay(attempt, () => 0)).toBe(0);
      expect(fullJitterDelay(attempt, () => 0.99999)).toBeLessThan(ceiling);
      expect(fullJitterDelay(attempt, () => 0.99999)).toBeGreaterThanOrEqual(0);
    }
    expect(fullJitterDelay(20, () => 0.5)).toBe(30_000);
  });
});
