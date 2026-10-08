// KIWIX-STARTING-DIAG-01. A library that shows "Starting" must say which
// step it is on and for how long, and say so plainly once the step runs
// longer than a normal install or start. Offline and deterministic: the
// download and extraction are scripted, time is passed in, and the spawn
// uses a plain `sleep` process.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureKiwixInstalled } from "@/lib/kiwixSidecar";
import { selectKiwixBinary } from "@/lib/kiwixCatalog";
import { kiwixToolsDir } from "@/lib/paths";
import {
  registerSidecar, startSidecar, stopSidecar, listSidecars, markSidecarStartPhase, clearSidecarStart,
  checkStalledSidecarStarts, __resetSidecarsForTests, SIDECAR_START_STUCK_MS,
} from "@/lib/sidecars";
import { __resetFixHandlersForTests, listIssues } from "@/lib/issues";
import { resetDb } from "./reset-db";

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
  __resetSidecarsForTests();
});
afterEach(() => {
  __resetSidecarsForTests();
});

const startOf = (id: string, now?: number) => listSidecars(now).find((s) => s.id === id)?.start;
const openSlowRows = () => listIssues().filter((i) => i.source === "sidecar:kiwix-serve" && i.key === "slow_start" && !i.resolved_at);

describe("start phase diagnostic", () => {
  test("a phase in progress reports its label and elapsed time, not stuck yet", () => {
    markSidecarStartPhase("kiwix-serve", "installing", 1_000);
    const start = startOf("kiwix-serve", 31_000);
    expect(start?.phase).toBe("installing");
    expect(start?.elapsed_seconds).toBe(30);
    expect(start?.stuck).toBe(false);
    expect(start?.message).toContain("first time");
    expect(listSidecars(31_000).find((s) => s.id === "kiwix-serve")?.status).toBe("starting");
  });

  test("a start past its threshold is stuck and the message says how long, in plain words", () => {
    markSidecarStartPhase("kiwix-serve", "starting", 0);
    const start = startOf("kiwix-serve", SIDECAR_START_STUCK_MS.starting + 61_000);
    expect(start?.stuck).toBe(true);
    expect(start?.message).toMatch(/longer than usual/);
    expect(start?.message).toMatch(/\d+ minutes?/);
    expect(start?.message).not.toContain("—");
  });

  test("a stuck start raises one Repairs row and clearing the start resolves it", async () => {
    markSidecarStartPhase("kiwix-serve", "starting", 0);
    await checkStalledSidecarStarts(SIDECAR_START_STUCK_MS.starting - 1);
    expect(openSlowRows()).toHaveLength(0);
    await checkStalledSidecarStarts(SIDECAR_START_STUCK_MS.starting + 1);
    await checkStalledSidecarStarts(SIDECAR_START_STUCK_MS.starting + 2);
    const rows = openSlowRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.severity).toBe("warning");
    clearSidecarStart("kiwix-serve");
    expect(openSlowRows()).toHaveLength(0);
    expect(startOf("kiwix-serve")).toBeUndefined();
  });
});

const hw = { platform: "darwin", arch: "arm64" } as never;
const installDeps = (onDownload: () => void = () => {}) => ({
  detectHardware: async () => hw,
  download: async () => { onDownload(); },
  extract: async (_archive: string, dest: string) => {
    writeFileSync(join(dest, "kiwix-serve"), "");
    writeFileSync(join(dest, "kiwix-manage"), "");
  },
});

describe("install download", () => {
  test("ensureKiwixInstalled marks installing while it downloads", async () => {
    const destDir = join(kiwixToolsDir, selectKiwixBinary(hw)!.id);
    rmSync(destDir, { recursive: true, force: true });
    let seen: ReturnType<typeof startOf>;
    await ensureKiwixInstalled(installDeps(() => { seen = startOf("kiwix-serve"); }));
    expect(seen!?.phase).toBe("installing");
    expect(existsSync(join(destDir, "kiwix-serve"))).toBe(true);
    rmSync(destDir, { recursive: true, force: true });
  });

  test("an already installed binary does not mark an install phase", async () => {
    const destDir = join(kiwixToolsDir, selectKiwixBinary(hw)!.id);
    rmSync(destDir, { recursive: true, force: true });
    await ensureKiwixInstalled(installDeps());
    clearSidecarStart("kiwix-serve");
    await ensureKiwixInstalled({ ...installDeps(), download: async () => { throw new Error("should not download"); } });
    expect(startOf("kiwix-serve")).toBeUndefined();
    rmSync(destDir, { recursive: true, force: true });
  });
});

describe("spawn", () => {
  test("startSidecar marks the starting phase while spawning and clears it once running", async () => {
    registerSidecar({ id: "diag-spawn", command: ["sleep", "30"], startupOrder: 1 });
    const starting = startSidecar("diag-spawn");
    await Bun.sleep(100);
    const during = listSidecars().find((s) => s.id === "diag-spawn");
    expect(during?.status).toBe("starting");
    expect(during?.start?.phase).toBe("starting");
    expect(during?.start?.stuck).toBe(false);
    await starting;
    const after = listSidecars().find((s) => s.id === "diag-spawn");
    expect(after?.status).toBe("running");
    expect(after?.start).toBeUndefined();
    await stopSidecar("diag-spawn");
  });

  test("a failed spawn clears the start phase", async () => {
    registerSidecar({ id: "diag-fail", command: ["/nonexistent/binary-for-test"] });
    await startSidecar("diag-fail");
    const entry = listSidecars().find((s) => s.id === "diag-fail");
    expect(entry?.status).toBe("crashed");
    expect(entry?.start).toBeUndefined();
  });
});
