import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EngineLink, fullJitterDelay, getEngineLink, LINK_BACKOFF_CAP_MS, LINK_OFFLINE_AFTER_MS, LINK_PROBE_INTERVAL_MS, LINK_PROBE_TIMEOUT_MS, LINK_READY_RESET_MS, mapSshFailure, startEngineLink, stopEngineLink, __setEngineLinkForTests, type LinkDependencies } from "@/lib/stack/link";
import { StackError } from "@/lib/stack/errors";
import { __setLinkKeyCommandForTests, confirmHostKey, derivePairingLookup, getPairingPublicKey, issuePairingCode, revokeLinkKey, scanHostKey } from "@/lib/stack/linkKeys";

type Timer = { at: number; fn: () => void; cancelled: boolean };
type FakeChild = { exit?: (code: number | null, signal: NodeJS.Signals | null) => void; error?: (error: Error & { code?: string }) => void; killed: number; once: (event: string, cb: (...args: any[]) => void) => void; kill: () => void };
let now: number;
let timers: Timer[];
let children: FakeChild[];
let processArgs: string[][];
let logs: Array<{ event: string; fields: Record<string, unknown> }>;
let responses: Array<() => Promise<Response>>;
let randomValue: number;
let allowedAddresses: Set<string>;
let deps: Partial<LinkDependencies>;

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function tick(ms: number): Promise<void> {
  const end = now + ms;
  while (true) {
    const timer = timers.filter((item) => !item.cancelled && item.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!timer) break;
    timer.cancelled = true; now = timer.at; timer.fn(); await flush();
  }
  now = end; await flush();
}
function setup(fetcher?: () => Promise<Response>): void {
  now = 0; timers = []; children = []; processArgs = []; logs = []; responses = fetcher ? [fetcher] : []; randomValue = 0.5;
  allowedAddresses = new Set(["192.168.1.22"]);
  deps = {
    now: () => now,
    random: () => randomValue,
    setTimeout: (fn, ms) => { const timer = { at: now + ms, fn, cancelled: false }; timers.push(timer); return timer as unknown as ReturnType<typeof setTimeout>; },
    clearTimeout: (timer) => { (timer as unknown as Timer).cancelled = true; },
    resolveHost: async () => ["192.168.1.22"],
    hostAllowed: async (host) => allowedAddresses.has(host),
    hostKeyMatches: async () => "match",
    spawn: (_command, args, options) => {
      expect(options.stdio).toEqual(["ignore", "ignore", "ignore"]);
      expect(options.env).toBeDefined();
      expect(args.some((arg) => arg.startsWith("maipai-stack@"))).toBe(true);
      expect(args.join(" ")).not.toContain("BEGIN OPENSSH PRIVATE KEY");
      processArgs.push(args);
      const child: FakeChild = { killed: 0, once: (event, cb) => { if (event === "exit") child.exit = cb as FakeChild["exit"]; else if (event === "error") child.error = cb as FakeChild["error"]; }, kill: () => { child.killed++; } };
      children.push(child); return child as any;
    },
    fetch: async () => responses.shift()?.() ?? Response.json({ ok: true, contract: 1 }),
    log: (event, fields) => logs.push({ event, fields }),
  };
}
const config = (allowTailnet = false) => ({ host: "engine.local", privateKeyPath: "/private/id_ed25519", knownHostsPath: "/private/known_hosts", allowTailnet });
async function startReady(link = new EngineLink(config(), deps)): Promise<EngineLink> { link.start(); await flush(); expect(link.snapshot().state).toBe("ready"); return link; }

beforeEach(() => { stopEngineLink(); revokeLinkKey(); setup(); });
afterEach(() => { stopEngineLink(); revokeLinkKey(); __setLinkKeyCommandForTests(null); timers = []; });

async function pairCredentialsForTest(): Promise<void> {
  const issued = issuePairingCode();
  expect(getPairingPublicKey(derivePairingLookup(issued.code), "test-home")).not.toBeNull();
  __setLinkKeyCommandForTests(async () => ({ code: 0, stdout: "engine.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPoISQD6sKkxbk5FD8YL6LuvYzhXACmFp4cr8oleBk1h test\n" }));
  const scanned = await scanHostKey("engine.local", 22);
  confirmHostKey(scanned.check_code);
  __setLinkKeyCommandForTests(null);
}

describe("engine link state machine", () => {
  test("status details report only a remote contract after a successful probe", async () => {
    const link = new EngineLink(config(), deps);
    expect(link.statusDetails()).toEqual({ path: null, lastProbeAt: null, contract: null });
    await startReady(link);
    expect(link.statusDetails()).toEqual({ path: "home", lastProbeAt: new Date(now).toISOString(), contract: "1" });
    link.stop();
  });

  test("follows connecting -> ready -> reconnecting after two failed probes -> ready", async () => {
    const link = await startReady();
    responses.push(() => Promise.resolve(new Response("", { status: 503 })), () => Promise.resolve(new Response("", { status: 503 })));
    await tick(LINK_PROBE_INTERVAL_MS);
    expect(link.snapshot().state).toBe("degraded");
    await tick(LINK_PROBE_INTERVAL_MS);
    expect(link.snapshot().state).toBe("reconnecting");
    await tick(2_000);
    expect(link.snapshot().state).toBe("ready");
    link.stop(); expect(link.snapshot().state).toBe("offline");
  });

  test("persistent failures become offline after two minutes", async () => {
    setup(() => Promise.resolve(new Response("", { status: 503 })));
    deps.fetch = async () => new Response("", { status: 503 });
    const link = new EngineLink(config(), deps); link.start(); await flush();
    expect(link.snapshot().state).toBe("connecting");
    await tick(LINK_OFFLINE_AFTER_MS - 1);
    expect(link.snapshot().state).not.toBe("offline");
    await tick(1);
    expect(link.snapshot()).toMatchObject({ state: "offline", reason: "link_stack_down" });
    link.stop();
  });

  test("races an actual 3 second deadline against fetch that ignores abort", async () => {
    setup(() => new Promise<Response>(() => {}));
    const link = new EngineLink(config(), deps); link.start(); await flush();
    await tick(LINK_PROBE_TIMEOUT_MS);
    expect(link.snapshot().reason).toBe("link_timeout");
    expect(link.snapshot().state).toBe("connecting");
    link.stop();
  });

  test("jitter schedule grows exponentially, caps at a minute and resets after 60 seconds continuously ready", async () => {
    const link = await startReady();
    children[0]!.exit?.(1, null); await flush();
    expect(link.snapshot().state).toBe("reconnecting");
    expect(timers.some((timer) => timer.at === 500)).toBe(true);
    await tick(500); expect(link.snapshot().state).toBe("ready");
    await tick(LINK_READY_RESET_MS);
    children.at(-1)!.exit?.(1, null); await flush();
    expect(timers.some((timer) => timer.at === now + 500)).toBe(true);
    link.stop();
    expect(fullJitterDelay(20, () => 0.5)).toBe(30_000);
    expect(fullJitterDelay(20, () => 1)).toBeLessThanOrEqual(LINK_BACKOFF_CAP_MS);
  });

  test("uses resolved address category for path and allow_tailnet flip disconnects immediately", async () => {
    setup();
    allowedAddresses = new Set(["100.70.1.2"]);
    deps.resolveHost = async () => ["100.70.1.2"];
    const link = await startReady(new EngineLink(config(true), deps));
    expect(link.snapshot().path).toBe("tailnet");
    expect(link.pathInUse()).toBe("tailnet");
    link.updateSettings({ allowTailnet: false });
    expect(link.snapshot()).toMatchObject({ state: "offline", reason: "link_outside_home" });
    expect(children[0]!.killed).toBe(1);
    link.stop();
  });

  test("retains the last verified path after a tunnel drop for failure wording", async () => {
    allowedAddresses = new Set(["100.70.1.2"]);
    deps.resolveHost = async () => ["100.70.1.2"];
    const link = await startReady(new EngineLink(config(true), deps));
    children[0]!.exit?.(1, null); await flush();
    expect(link.pathInUse()).toBe("tailnet");
    link.stop();
  });

  test("marks slow median and offline role results degraded", async () => {
    let rtts = 600;
    deps.fetch = async () => { now += rtts; return Response.json({ ok: true, contract: 1 }); };
    const link = new EngineLink(config(), { ...deps, onRoles: async () => false }); link.start(); await flush();
    for (let i = 0; i < 5; i++) await tick(LINK_PROBE_INTERVAL_MS);
    expect(link.snapshot().state).toBe("degraded");
    rtts = 10; link.stop();
  });

  test("rejects incompatible contract and addresses without retry", async () => {
    setup(() => Promise.resolve(Response.json({ ok: true, contract: 999 })));
    const link = new EngineLink(config(), deps); link.start(); await flush();
    expect(link.snapshot()).toMatchObject({ state: "offline", reason: "link_needs_update", contract: "999" });
    link.stop();
    setup(); allowedAddresses.clear();
    const outside = new EngineLink(config(), deps); outside.start(); await flush();
    expect(outside.snapshot()).toMatchObject({ state: "offline", reason: "link_outside_home" });
    outside.stop();
  });

  test("uses structured SSH error codes for terminal reason classification", async () => {
    const link = await startReady();
    children[0]!.error?.(Object.assign(new Error("private stderr text"), { code: "SSH_HOST_KEY_CHANGED" }));
    expect(link.snapshot()).toMatchObject({ state: "offline", reason: "link_host_key_changed" });
    expect(JSON.stringify(logs)).not.toContain("private stderr text");
    link.stop();
  });

  test("host key mismatch fails closed before ssh starts", async () => {
    deps.hostKeyMatches = async () => "mismatch";
    const link = new EngineLink(config(), deps); link.start(); await flush();
    expect(link.snapshot()).toMatchObject({ state: "offline", reason: "link_host_key_changed" });
    expect(children).toHaveLength(0);
    expect(JSON.stringify(logs)).not.toContain("BEGIN OPENSSH PRIVATE KEY");
    link.stop();
  });

  test("an unreachable host key check retries with backoff instead of declaring a changed key", async () => {
    deps.hostKeyMatches = async () => "unreachable";
    const link = new EngineLink(config(), deps); link.start(); await flush();
    expect(link.snapshot()).toMatchObject({ state: "connecting", reason: "link_timeout" });
    expect(children).toHaveLength(0); expect(timers.some((timer) => timer.at === 500)).toBe(true);
    link.stop();
  });

  test("keeps the askpass secret out of the SSH process arguments and logs", async () => {
    const marker = "test-only-link-passphrase-marker";
    const link = await startReady(new EngineLink({ ...config(), env: { MAIPAI_LINK_ASKPASS: marker } }, deps));
    expect(processArgs.flat().join(" ")).not.toContain(marker);
    expect(JSON.stringify(logs)).not.toContain(marker);
    link.stop();
  });

  test("assertReady throws StackError unreachable immediately", async () => {
    const link = new EngineLink(config(), deps);
    try { link.assertReady(); throw new Error("expected throw"); }
    catch (error) { expect(error).toBeInstanceOf(StackError); expect((error as StackError).kind).toBe("unreachable"); }
    await startReady(link); expect(() => link.assertReady()).not.toThrow(); link.stop();
  });

  test("start is idempotent for the active link and stop clears its timers and instance", async () => {
    await pairCredentialsForTest();
    const link = startEngineLink(config(), deps);
    startEngineLink(config(), deps);
    await flush();
    expect(getEngineLink()).toBe(link);
    expect(children).toHaveLength(1);
    stopEngineLink();
    expect(getEngineLink()).toBeNull();
    expect(timers.filter((timer) => !timer.cancelled).length).toBe(0);
  });

  test("does not spawn SSH before credentials exist", () => {
    revokeLinkKey();
    const link = startEngineLink(config(), deps);
    expect(link.snapshot()).toMatchObject({ state: "offline", reason: "link_not_paired" });
    expect(children).toHaveLength(0);
    expect(getEngineLink()).toBe(link);
    stopEngineLink();
  });

  test("a missing host pin is not paired and never spawns SSH", async () => {
    deps.hostKeyMatches = async () => "not_paired";
    const link = new EngineLink(config(), deps);
    link.start(); await flush();
    expect(link.snapshot()).toMatchObject({ state: "offline", reason: "link_not_paired" });
    expect(children).toHaveLength(0);
    link.stop();
    // This direct state-machine path proves the host-pin status is terminal
    // before ssh; the public start path checks the full credential set first.
  });

  test("replacing the injected singleton stops its existing timers", async () => {
    const first = new EngineLink(config(), deps); first.start(); await flush();
    __setEngineLinkForTests(first);
    const second = new EngineLink(config(), deps);
    __setEngineLinkForTests(second);
    expect(first.snapshot().state).toBe("offline");
    expect(timers.filter((timer) => !timer.cancelled && timer.at > now).length).toBe(0);
    stopEngineLink();
  });

  test("ignores late probes and exits after stop/replacement", async () => {
    let resolveFetch!: (response: Response) => void;
    setup(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const link = new EngineLink(config(), deps); link.start(); await flush();
    link.stop(); resolveFetch(Response.json({ ok: true, contract: 1 })); await flush();
    expect(link.snapshot().state).toBe("offline");
    expect(timers.filter((timer) => !timer.cancelled && timer.at > now).length).toBe(0);
  });

  test("does not expose address or stderr in state, logs, or safe classifications", async () => {
    setup(); const link = await startReady();
    children[0]!.exit?.(255, null); await flush();
    const output = JSON.stringify({ state: link.snapshot(), logs });
    expect(output).not.toContain("192.168.1.22");
    expect(output).not.toContain("stderr-secret");
    expect(mapSshFailure(255, null)).toBe("link_refused");
    link.stop();
  });
});

test("full jitter remains in [0, min(60 seconds, 1 second * 2^attempt))", () => {
  for (let attempt = 0; attempt < 15; attempt++) {
    const ceiling = Math.min(LINK_BACKOFF_CAP_MS, 1_000 * 2 ** attempt);
    expect(fullJitterDelay(attempt, () => 0)).toBe(0);
    expect(fullJitterDelay(attempt, () => 0.99999)).toBeLessThan(ceiling);
  }
});
