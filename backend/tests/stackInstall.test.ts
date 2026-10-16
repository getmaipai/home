// INSTALL-SPLIT-01: the setup wizard installs the MaiPai Stack on "this computer" and never on "another computer".
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { getInstallStatus, resetInstallStatusCache } from "@/lib/installStatus";
import { __setEngineInstallRunnerForTests, engineInstallStatus, startEngineInstall } from "@/lib/stackInstall";
import { beginInstall } from "@/lib/installActions";
import { replaceSetupStep } from "@/lib/setupState";
import { TestClient } from "./client";
import { owner } from "./support/testAuth";
import { resetDb } from "./reset-db";

const statusPath = () => join(dataDir, "stack-install.json");
function writeStatus(value: Record<string, unknown>) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(statusPath(), JSON.stringify({ pid: null, updatedAt: new Date().toISOString(), ...value }));
}

describe("engine install from the setup wizard", () => {
  let root: string;
  let runs: string[];
  const previousRoot = process.env.MAIPAI_INSTALL_ROOT;

  beforeEach(() => {
    resetDb(); resetInstallStatusCache(); __setStackClientForTests(null);
    rmSync(statusPath(), { force: true });
    root = mkdtempSync(join(tmpdir(), "install-root-"));
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts", "install.sh"), "#!/bin/bash\n");
    process.env.MAIPAI_INSTALL_ROOT = root;
    runs = [];
    __setEngineInstallRunnerForTests((dir) => { runs.push(dir); });
  });
  afterEach(() => {
    __setEngineInstallRunnerForTests(null);
    __resetStackEngineForTests();
    rmSync(statusPath(), { force: true });
    rmSync(root, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.MAIPAI_INSTALL_ROOT; else process.env.MAIPAI_INSTALL_ROOT = previousRoot;
  });

  test("nothing has started: status is none", () => {
    expect(engineInstallStatus().state).toBe("none");
  });

  test("start runs the step once and a second start joins the run in progress", () => {
    expect(startEngineInstall()).toEqual({ ok: true, alreadyRunning: false });
    expect(engineInstallStatus().state).toBe("running");
    expect(startEngineInstall()).toEqual({ ok: true, alreadyRunning: true });
    expect(runs).toEqual([root]);
  });

  test("a copy of Home that was not set up by the installer refuses in plain words", () => {
    rmSync(join(root, "scripts"), { recursive: true });
    const result = startEngineInstall();
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.error).toContain("not set up by the installer"); expect(result.next.length).toBeGreaterThan(10); }
    expect(runs).toEqual([]);
  });

  test("a runner that throws reports how to run the step by hand", () => {
    __setEngineInstallRunnerForTests(() => { throw new Error("boom"); });
    const result = startEngineInstall();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.next).toContain("--stack-only");
  });

  test("status reads the script's stage and label, and leaks no pid", () => {
    writeStatus({ state: "running", stage: "building", problem: null, pid: process.pid });
    const status = engineInstallStatus();
    expect(status).toEqual({ state: "running", stage: "building", stageLabel: "Building the AI engine", problem: null });
    expect(JSON.stringify(status)).not.toContain(String(process.pid));
  });

  test("a failed run carries the script's plain-words problem, and Try again clears it and starts again", () => {
    writeStatus({ state: "failed", stage: null, problem: "Out of room. Free space, then press Try again." });
    expect(engineInstallStatus()).toMatchObject({ state: "failed", problem: "Out of room. Free space, then press Try again." });
    expect(startEngineInstall()).toEqual({ ok: true, alreadyRunning: false });
    expect(runs.length).toBe(1);
  });

  test("a running status whose process is gone reads as failed", () => {
    writeStatus({ state: "running", stage: "building", problem: null, pid: 2 ** 22 + 12345 });
    const status = engineInstallStatus();
    expect(status.state).toBe("failed");
    expect(status.problem).toContain("Try again");
  });

  test("a start that never writes a status reads as running at first", () => {
    startEngineInstall();
    expect(engineInstallStatus()).toMatchObject({ state: "running", stage: "preflight" });
  });

  test("the install summary shows the engine install before any model exists", async () => {
    writeStatus({ state: "running", stage: "fetching", problem: null });
    resetInstallStatusCache();
    expect(await getInstallStatus()).toMatchObject({ state: "installing_engine", stage: "fetching", stageLabel: "Fetching the AI engine" });
    writeStatus({ state: "failed", stage: null, problem: "No network. Check the connection, then press Try again." });
    resetInstallStatusCache();
    expect(await getInstallStatus()).toMatchObject({ state: "engine_failed", problem: "No network. Check the connection, then press Try again." });
  });

  test("beginInstall with no Stack on this computer starts the engine install and says to wait", async () => {
    const result = await beginInstall(undefined, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("still installing");
    expect(runs.length).toBe(1);
  });

  test("beginInstall with another computer chosen never installs a Stack here", async () => {
    replaceSetupStep("engine_location", { status: "done", engine: { where: "another_computer", hardware: {} } });
    await beginInstall(undefined, true);
    expect(runs).toEqual([]);
  });

  test("Continue on 'this computer' starts the engine install; 'another computer' installs nothing", async () => {
    const client = new TestClient();
    expect((await client.post("/api/setup/engine_location", { status: "done", engine: { where: "this_computer", hardware: {} } })).status).toBe(200);
    expect(runs.length).toBe(1);
    __setEngineInstallRunnerForTests((dir) => { runs.push(dir); });
    rmSync(statusPath(), { force: true });
    expect((await client.post("/api/setup/engine_location", { status: "done", engine: { where: "another_computer", hardware: {} } })).status).toBe(200);
    expect(runs.length).toBe(1);
  });

  test("POST /api/install/retry restarts the engine install when there is no Stack", async () => {
    const { client } = await owner();
    const response = await client.post("/api/install/retry", {});
    expect(response.status).toBe(202);
    expect(runs.length).toBe(1);
  });
});

describe("POST /api/setup/engine-install", () => {
  const previousRoot = process.env.MAIPAI_INSTALL_ROOT;
  let root: string;
  let runs = 0;
  beforeEach(() => {
    resetDb(); resetInstallStatusCache(); __setStackClientForTests(null);
    rmSync(statusPath(), { force: true });
    root = mkdtempSync(join(tmpdir(), "install-root-"));
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts", "install.sh"), "#!/bin/bash\n");
    process.env.MAIPAI_INSTALL_ROOT = root;
    runs = 0;
    __setEngineInstallRunnerForTests(() => { runs += 1; });
  });
  afterEach(() => {
    __setEngineInstallRunnerForTests(null); __resetStackEngineForTests();
    rmSync(statusPath(), { force: true }); rmSync(root, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.MAIPAI_INSTALL_ROOT; else process.env.MAIPAI_INSTALL_ROOT = previousRoot;
  });

  test("restarts a failed install", async () => {
    writeStatus({ state: "failed", stage: null, problem: "x" });
    const response = await new TestClient().post("/api/setup/engine-install", {});
    expect(response.status).toBe(202);
    expect(runs).toBe(1);
  });

  test("does nothing when the AI runs on another computer", async () => {
    replaceSetupStep("engine_location", { status: "done", engine: { where: "another_computer", hardware: {} } });
    expect((await new TestClient().post("/api/setup/engine-install", {})).status).toBe(202);
    expect(runs).toBe(0);
  });

  test("says what to do outside an installed copy", async () => {
    rmSync(join(root, "scripts"), { recursive: true });
    const response = await new TestClient().post("/api/setup/engine-install", {});
    expect(response.status).toBe(409);
    expect(Object.keys(await response.json() as object).sort()).toEqual(["error", "next"]);
  });

  test("is closed once Home has an owner", async () => {
    await owner();
    expect((await new TestClient().post("/api/setup/engine-install", {})).status).toBe(409);
  });
});
