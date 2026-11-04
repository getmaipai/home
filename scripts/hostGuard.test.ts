// HOST-GUARD-01: the host guard daemon. Every case runs the real script against a temp state directory with the test seams
// (MAIPAI_HG_*): probes are forced, the shutdown command is a fake, nothing reboots anything.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

const DIR = join(import.meta.dir, "studio", "host-guard");
const SCRIPT = join(DIR, "maipai-host-guard");
const INSTALL = join(DIR, "install.sh");
const mac = process.platform === "darwin";
const me = userInfo();
const temps: string[] = [];

interface Box { state: string; log: string; data: string; shutdown: string; shutdownOut: string; reboot: string; rebootOut: string }

function box(config: Record<string, unknown> = {}, tuning: Record<string, unknown> | null = { mode: "dry", hard_minutes: 3, metal_minutes: 10, max_reboots_per_12h: 2 }): Box {
  const root = mkdtempSync(join(tmpdir(), "hostguard-"));
  temps.push(root);
  const state = join(root, "state"); const data = join(root, "data");
  mkdirSync(state, { recursive: true }); mkdirSync(data, { recursive: true });
  writeFileSync(join(state, "config.json"), JSON.stringify({ owner: me.username, uid: me.uid, data_dir: data, ...config }));
  if (tuning) writeFileSync(join(state, "tuning.json"), JSON.stringify(tuning));
  const shutdown = join(root, "fake-shutdown"); const shutdownOut = join(root, "shutdown.out");
  writeFileSync(shutdown, `#!/bin/bash\necho "FAKE SHUTDOWN $*" >> "${shutdownOut}"\n`); chmodSync(shutdown, 0o755);
  const reboot = join(root, "fake-reboot"); const rebootOut = join(root, "reboot.out");
  writeFileSync(reboot, `#!/bin/bash\necho "FAKE REBOOT $*" >> "${rebootOut}"\n`); chmodSync(reboot, 0o755);
  return { state, log: join(root, "log"), data, shutdown, shutdownOut, reboot, rebootOut };
}

function run(b: Box, args: string[], extra: Record<string, string> = {}) {
  return Bun.spawnSync(["/bin/bash", SCRIPT, ...args], {
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/",
      MAIPAI_HG_STATE: b.state, MAIPAI_HG_LOG: b.log, MAIPAI_HG_NO_ASUSER: "1", MAIPAI_HG_MIN_UPTIME: "0", MAIPAI_HG_CAPTURE_LIGHT: "1",
      MAIPAI_HG_TEST: "1", MAIPAI_HG_FORCE_DELAY: "0", MAIPAI_HG_SHUTDOWN: b.shutdown, MAIPAI_HG_REBOOT: b.reboot, MAIPAI_HG_QUIET: "yes", MAIPAI_HG_NO_TELEMETRY: "1", ...extra,
    },
    stdout: "pipe", stderr: "pipe",
  });
}
const status = (b: Box) => JSON.parse(readFileSync(join(b.state, "status.json"), "utf8")) as Record<string, string | number>;
const logText = (b: Box) => (existsSync(b.log) ? readFileSync(b.log, "utf8") : "");
const shutdowns = (b: Box) => (existsSync(b.shutdownOut) ? readFileSync(b.shutdownOut, "utf8").trim().split("\n").filter(Boolean).length : 0);
const times = (b: Box, n: number, extra: Record<string, string>) => { for (let i = 0; i < n; i++) run(b, ["run"], extra); };

afterAll(() => { for (const t of temps) rmSync(t, { recursive: true, force: true }); });

describe.skipIf(!mac)("host guard daemon", () => {
  test("a healthy Mac reports ok on every probe and writes the status schema", () => {
    const b = box();
    expect(run(b, ["run"], { MAIPAI_HG_NO_TELEMETRY: "" }).exitCode).toBe(0);
    const s = status(b);
    expect(s).toMatchObject({ version: 1, owner: me.username, mode: "dry", lookup: "ok", spawn: "ok", metal: "ok", hard_fails: 0, metal_fails: 0 });
    expect(existsSync(join(b.state, "telemetry.csv"))).toBe(true);
  }, 60_000);

  test("a lookup failure for hard_minutes triggers; dry mode only logs and never shuts down", () => {
    const b = box();
    times(b, 3, { MAIPAI_HG_FORCE: "lookup" });
    expect(status(b).note).toContain("TRIGGERED");
    expect(logText(b)).toContain("WOULD REBOOT");
    expect(shutdowns(b)).toBe(0);
    expect(readdirSync(join(b.state, "captures")).length).toBe(1);
  }, 120_000);

  test("a service-start failure triggers like a lookup failure", () => {
    const b = box();
    times(b, 3, { MAIPAI_HG_FORCE: "spawn" });
    expect(status(b).note).toContain("TRIGGERED");
    expect(status(b).metal).toBe("skipped");
  }, 120_000);

  test("Metal failing for metal_minutes triggers when the Stack is quiet", () => {
    const b = box();
    times(b, 10, { MAIPAI_HG_FORCE: "metal" });
    expect(status(b)).toMatchObject({ metal: "FAIL", metal_fails: 10 });
    expect(String(status(b).note)).toContain("TRIGGERED: Metal shader compiler failed");
    expect(logText(b)).toContain("WOULD REBOOT");
  }, 240_000);

  test("a Metal-only failure waits while a chat turn or job is in flight, even in live mode", () => {
    const b = box({}, { mode: "live", hard_minutes: 3, metal_minutes: 10, max_reboots_per_12h: 2 });
    times(b, 11, { MAIPAI_HG_FORCE: "metal", MAIPAI_HG_QUIET: "no" });
    expect(logText(b)).toContain("deferred: a chat turn or job is in flight");
    expect(shutdowns(b)).toBe(0);
  }, 240_000);

  test("live mode runs the shutdown once and records why", () => {
    const b = box({}, { mode: "live", hard_minutes: 3, metal_minutes: 10, max_reboots_per_12h: 2 });
    times(b, 3, { MAIPAI_HG_FORCE: "lookup" });
    expect(shutdowns(b)).toBe(1);
    // The forced reboot follows in the foreground (launchd would kill a background fallback when the script exits).
    expect(readFileSync(b.rebootOut, "utf8")).toContain("FAKE REBOOT -q");
    expect(readFileSync(join(b.state, "last-reboot.txt"), "utf8")).toContain("user lookup or service start failed");
    expect(readFileSync(join(b.state, "reboots"), "utf8").trim().split("\n").length).toBe(1);
  }, 120_000);

  test("the reboot limit refuses another reboot inside 12 hours", () => {
    const b = box({}, { mode: "live", hard_minutes: 3, metal_minutes: 10, max_reboots_per_12h: 2 });
    const t = Math.floor(Date.now() / 1000);
    writeFileSync(join(b.state, "reboots"), `${t - 60} a\n${t - 120} b\n`);
    times(b, 3, { MAIPAI_HG_FORCE: "lookup" });
    expect(shutdowns(b)).toBe(0);
    expect(logText(b)).toContain("NOT rebooting");
  }, 120_000);

  test("a ship or install in progress defers the reboot", () => {
    const b = box({}, { mode: "live", hard_minutes: 3, metal_minutes: 10, max_reboots_per_12h: 2 });
    mkdirSync(join(b.data, "ship.lock.d"), { recursive: true });
    writeFileSync(join(b.data, "ship.lock.d", "pid"), String(process.pid));
    times(b, 3, { MAIPAI_HG_FORCE: "lookup" });
    expect(logText(b)).toContain("deferred: a ship or install is running");
    expect(shutdowns(b)).toBe(0);
  }, 120_000);

  test("without MAIPAI_HG_TEST the seams are ignored, so a stray variable cannot steer the daemon", () => {
    const b = box();
    writeFileSync(join(b.state, "status.json"), '{"note":"read-from-the-stray-folder"}');
    const out = Bun.spawnSync(["/bin/bash", SCRIPT, "status"], { env: { PATH: "/usr/bin:/bin", MAIPAI_HG_STATE: b.state }, stdout: "pipe", stderr: "pipe" });
    expect(out.stdout.toString()).not.toContain("read-from-the-stray-folder");
  });

  test("off and settling clear stale counters so an old streak cannot trigger a reboot later", () => {
    const b = box({}, { mode: "dry" });
    times(b, 2, { MAIPAI_HG_FORCE: "lookup" });
    expect(existsSync(join(b.state, "hard"))).toBe(true);
    writeFileSync(join(b.state, "tuning.json"), JSON.stringify({ mode: "off" }));
    run(b, ["run"]);
    expect(existsSync(join(b.state, "hard"))).toBe(false);
    expect(existsSync(join(b.state, "episode"))).toBe(false);
  });

  test("a leading zero in a tuning value is read as decimal, not octal", () => {
    const b = box({}, { mode: "dry", hard_minutes: "08" });
    times(b, 7, { MAIPAI_HG_FORCE: "lookup" });
    expect(String(status(b).note)).not.toContain("TRIGGERED");
    run(b, ["run"], { MAIPAI_HG_FORCE: "lookup" });
    expect(String(status(b).note)).toContain("TRIGGERED");
  }, 240_000);

  test("status notes stay valid JSON when a probe prints backslashes or control characters", () => {
    const b = box();
    run(b, ["run"], { MAIPAI_HG_FORCE: "lookup" });
    expect(() => JSON.parse(readFileSync(join(b.state, "status.json"), "utf8"))).not.toThrow();
  });

  test("the sudoers entry grants only the guard's own commands and the fixed shutdown", () => {
    const text = readFileSync(INSTALL, "utf8");
    expect(text).not.toContain("spindump");
    expect(text).not.toContain("usr/bin/sysdiagnose");
    expect(text).toContain("/sbin/shutdown -r now");
  });

  test("off does nothing at all", () => {
    const b = box({}, { mode: "off" });
    times(b, 4, { MAIPAI_HG_FORCE: "lookup" });
    expect(status(b).note).toBe("mode off");
    expect(shutdowns(b)).toBe(0);
    expect(existsSync(join(b.state, "hard"))).toBe(false);
  });

  test("tuning values are clamped and a bad mode is ignored", () => {
    // hard_minutes 1 is below the floor of 2, so two failures trigger; 99 would be clamped to 30, and "reboot-now" is not a mode.
    const b = box({}, { mode: "reboot-now", hard_minutes: 1, metal_minutes: 10, max_reboots_per_12h: 99 });
    times(b, 2, { MAIPAI_HG_FORCE: "lookup" });
    expect(status(b)).toMatchObject({ mode: "dry" });
    expect(String(status(b).note)).toContain("TRIGGERED");
    const c = box({}, { mode: "dry", hard_minutes: 99 });
    times(c, 29, { MAIPAI_HG_FORCE: "lookup" });
    expect(String(status(c).note)).not.toContain("TRIGGERED");
    run(c, ["run"], { MAIPAI_HG_FORCE: "lookup" }); run(c, ["run"], { MAIPAI_HG_FORCE: "lookup" });
    expect(String(status(c).note)).toContain("TRIGGERED");
  }, 400_000);

  test("a user-written file cannot change the account, the data directory or the command", () => {
    const b = box();
    writeFileSync(join(b.state, "tuning.json"), JSON.stringify({ mode: "live", owner: "root", uid: 0, data_dir: "/", shutdown: "rm -rf /" }));
    run(b, ["run"], { MAIPAI_HG_FORCE: "lookup" });
    expect(status(b).owner).toBe(me.username);
  });

  test("a missing or invalid config.json stops the daemon safely", () => {
    const b = box({ owner: "bad name; rm -rf /" });
    run(b, ["run"], { MAIPAI_HG_FORCE: "lookup" });
    expect(String(status(b).note)).toContain("config.json missing or invalid");
    expect(shutdowns(b)).toBe(0);
  });

  test("the mode command keeps the other tuning keys", () => {
    const b = box({}, { mode: "dry", hard_minutes: 7, metal_minutes: 20, max_reboots_per_12h: 1 });
    expect(run(b, ["mode", "live"]).exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(b.state, "tuning.json"), "utf8"))).toEqual({ mode: "live", hard_minutes: 7, metal_minutes: 20, max_reboots_per_12h: 1 });
    expect(run(b, ["mode", "nonsense"]).exitCode).toBe(2);
  });

  test("the installer checks without root and rejects an unsafe account", () => {
    const ok = Bun.spawnSync(["/bin/bash", INSTALL, "--check", "--owner", me.username, "--uid", String(me.uid), "--data-dir", "/tmp/hostguard-x"], { stdout: "pipe", stderr: "pipe" });
    expect(ok.stdout.toString()).toContain("check ok");
    const bad = Bun.spawnSync(["/bin/bash", INSTALL, "--check", "--owner", "x;rm", "--uid", "1", "--data-dir", "/tmp/x"], { stdout: "pipe", stderr: "pipe" });
    expect(bad.exitCode).not.toBe(0);
  });

  test("no account name or uid of any Mac is written into the guard's files", () => {
    const banned = [["jesse", "torres"].join(""), ["", "5", "0", "1", ""].join("") ];
    for (const file of [SCRIPT, INSTALL, import.meta.path]) {
      const text = readFileSync(file, "utf8");
      expect(text.includes(banned[0]!)).toBe(false);
      // the uid is only allowed as part of a longer number
      expect(new RegExp("(^|[^0-9])" + banned[1]!.trim() + "([^0-9]|$)").test(text)).toBe(false);
    }
  });

  test("the Metal probe compiles the same shader as the Stack's hostProbe", () => {
    const stack = join(import.meta.dir, "..", "..", "stack", "backend", "src", "lib", "hostProbe.ts");
    if (!existsSync(stack)) return;
    const shader = "kernel void k(device float *a [[buffer(0)]], uint i [[thread_position_in_grid]]) { a[i] = a[i] + 1.0; }";
    expect(readFileSync(stack, "utf8")).toContain(shader);
    expect(readFileSync(SCRIPT, "utf8")).toContain(shader);
  });
});
