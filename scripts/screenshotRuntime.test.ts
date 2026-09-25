import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createOwnedDemoDataDir,
  processStartTime,
  removeOwnedDemoDataDir,
  STALE_DEMO_DATA_MS,
  sweepStaleDemoDataDirs,
  waitForBackendPort,
  withScreenshotBuildLock,
  type RunOwner,
} from "./screenshotRuntime";

const tempRoots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "home-screenshot-runtime-"));
  tempRoots.push(root);
  return root;
}
const owner = (token: string, pid = process.pid, startedAt = processStartTime(process.pid) ?? null): RunOwner => ({ pid, startedAt, token });

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("screenshot runtime ownership", () => {
  test("simultaneous runs get distinct data directories and cannot remove each other's directory", () => {
    const root = tempRoot();
    const a = createOwnedDemoDataDir(root, owner("same-process"));
    const b = createOwnedDemoDataDir(root, owner("same-process"));
    expect(a).not.toBe(b);
    expect(removeOwnedDemoDataDir(a, "same-process")).toBe(true);
    expect(removeOwnedDemoDataDir(b, "other-run")).toBe(false);
    expect(readFileSync(join(b, "owner-pid"), "utf8")).toContain("same-process");
  });

  test("a PID-reused marker is stale when process start times differ", () => {
    const root = tempRoot();
    const directory = createOwnedDemoDataDir(root, { pid: 1234, startedAt: "old-process", token: "old" });
    sweepStaleDemoDataDirs(root, Date.now(), () => "new-process");
    expect(() => readFileSync(join(directory, "owner-pid"))).toThrow();
  });

  test("a live owner with unknown recorded start time is retained when a later probe succeeds", () => {
    const root = tempRoot();
    const directory = createOwnedDemoDataDir(root, { pid: 1234, startedAt: null, token: "unknown-start" });
    sweepStaleDemoDataDirs(root, Date.now() + STALE_DEMO_DATA_MS * 2, () => "now-visible-start");
    expect(readFileSync(join(directory, "owner-pid"), "utf8")).toContain("unknown-start");
  });

  test("a corrupt or empty owner marker receives the stale-age grace period", () => {
    const root = tempRoot();
    const recent = join(root, ".demo-data-run-recent");
    mkdirSync(recent);
    writeFileSync(join(recent, "owner-pid"), "");
    sweepStaleDemoDataDirs(root, Date.now(), () => undefined);
    expect(readFileSync(join(recent, "owner-pid"), "utf8")).toBe("");
    sweepStaleDemoDataDirs(root, Date.now() + STALE_DEMO_DATA_MS + 1, () => undefined);
    expect(() => readFileSync(join(recent, "owner-pid"))).toThrow();
  });

  test("a partially written owner marker is treated as corrupt, not as a live PID", () => {
    const root = tempRoot();
    const directory = join(root, ".demo-data-run-partial");
    mkdirSync(directory);
    writeFileSync(join(directory, "owner-pid"), "{\"pid\":");
    sweepStaleDemoDataDirs(root, Date.now(), () => undefined);
    expect(readFileSync(join(directory, "owner-pid"), "utf8")).toBe("{\"pid\":");
  });

  test("concurrent builds sharing frontend/dist run under one lock", async () => {
    const lock = join(tempRoot(), "build.lock");
    let active = 0;
    let maximum = 0;
    const run = (token: string) => withScreenshotBuildLock(lock, owner(token), async () => {
      active++;
      maximum = Math.max(maximum, active);
      await Bun.sleep(30);
      active--;
    });
    await Promise.all([run("first"), run("second")]);
    expect(maximum).toBe(1);
  });

  test("backend binding port zero is read from its startup URL, not a released reservation", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("booting\nHome URL: http://localhost:43217\n"));
        controller.close();
      },
    });
    expect(await waitForBackendPort(stream)).toBe(43217);
  });
});
