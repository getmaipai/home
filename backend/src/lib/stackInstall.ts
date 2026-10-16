// Installing the MaiPai Stack from the setup wizard (INSTALL-SPLIT-01).
//
// scripts/install.sh brings up Home alone. When the household says this
// computer also runs the AI, the wizard calls start() here, which runs the
// installer's `--stack-only` step: build, service, engines. The step needs
// more rights than Home has (macOS: Home is a root LaunchDaemon, so it runs
// the script itself; Linux: Home is an unprivileged service user, so it asks
// systemd to start one fixed root unit, the only command the sudoers rule
// allows). The script writes a small status file; status() reads it.
//
// Only state, stage and a plain-words problem leave this module. The
// script's pid and the account the Stack runs as stay inside it.
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import { installRoot } from "@/lib/localStackService";
import { invalidateScopeCache } from "@/lib/settings";
import { resetInstallStatusCache } from "@/lib/installStatus";

export type EngineInstallState = "none" | "running" | "failed" | "ready";
export type EngineInstallStage = "preflight" | "fetching" | "building" | "starting";

export interface EngineInstallStatus {
  state: EngineInstallState;
  stage: EngineInstallStage | null;
  stageLabel: string | null;
  problem: string | null;
}

export const NO_ENGINE_INSTALL: EngineInstallStatus = { state: "none", stage: null, stageLabel: null, problem: null };

const STAGE_LABELS: Record<EngineInstallStage, string> = {
  preflight: "Checking this computer",
  fetching: "Fetching the AI engine",
  building: "Building the AI engine",
  starting: "Starting the AI engine",
};

/** How long Home waits for the step to write its first status before it
 * calls the start a failure (the unit or process never ran). */
const START_GRACE_MS = 90_000;

export type EngineInstallRunner = (installDir: string) => void;

function logFile(): string { return join(dataDir, "logs", "stack-install.log"); }
function statusFile(): string { return join(dataDir, "stack-install.json"); }

/** macOS: Home is root, so run the step directly and let it outlive Home. */
function runDirect(installDir: string): void {
  mkdirSync(join(dataDir, "logs"), { recursive: true });
  const fd = openSync(logFile(), "a");
  const child = spawn("/bin/bash", [join(installDir, "scripts", "install.sh"), "--stack-only"], {
    detached: true, stdio: ["ignore", fd, fd], env: { ...process.env, MAIPAI_INSTALL_ROOT: installDir },
  });
  child.on("error", () => {});
  child.unref();
}

/** Linux: start the one root unit the sudoers rule allows. */
function runViaSystemd(): void {
  const result = spawnSync("sudo", ["-n", "systemctl", "start", "--no-block", "maipai-stack-install.service"], { encoding: "utf8", timeout: 20_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("systemd refused to start the AI engine install.");
}

const defaultRunner: EngineInstallRunner = (installDir) => {
  if (process.platform === "darwin") runDirect(installDir);
  else runViaSystemd();
};

let runner: EngineInstallRunner = defaultRunner;
let startedAt: number | null = null;
let lastReady = false;

export function __setEngineInstallRunnerForTests(value: EngineInstallRunner | null): void {
  runner = value ?? defaultRunner;
  startedAt = null;
  lastReady = false;
}

interface RawStatus { state: string; stage: string | null; problem: string | null; pid: number | null }

function readRaw(): RawStatus | null {
  try {
    const parsed = JSON.parse(readFileSync(statusFile(), "utf8")) as Partial<RawStatus>;
    if (typeof parsed.state !== "string") return null;
    return {
      state: parsed.state,
      stage: typeof parsed.stage === "string" ? parsed.stage : null,
      problem: typeof parsed.problem === "string" ? parsed.problem : null,
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
    };
  } catch { return null; }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

const STALE_PROBLEM = "The AI engine install stopped before it finished. Press Try again; it picks up where it stopped.";
const NEVER_RAN_PROBLEM = "The AI engine install did not start. Press Try again, or run it at the computer: sudo bash " + "<install folder>/scripts/install.sh --stack-only";

export function engineInstallStatus(): EngineInstallStatus {
  const raw = readRaw();
  if (!raw) {
    if (startedAt !== null) {
      if (Date.now() - startedAt < START_GRACE_MS) return { state: "running", stage: "preflight", stageLabel: STAGE_LABELS.preflight, problem: null };
      return { state: "failed", stage: null, stageLabel: null, problem: NEVER_RAN_PROBLEM.replace("<install folder>", installRoot()) };
    }
    return NO_ENGINE_INSTALL;
  }
  if (raw.state === "ready") {
    if (!lastReady) {
      lastReady = true;
      invalidateScopeCache("household");
      resetInstallStatusCache();
      beginDownloadsAfterEngine();
    }
    return { state: "ready", stage: null, stageLabel: null, problem: null };
  }
  if (raw.state === "failed") {
    return { state: "failed", stage: null, stageLabel: null, problem: raw.problem ?? STALE_PROBLEM };
  }
  if (raw.state === "running") {
    if (raw.pid !== null && !alive(raw.pid)) return { state: "failed", stage: null, stageLabel: null, problem: STALE_PROBLEM };
    const stage = (raw.stage && raw.stage in STAGE_LABELS ? raw.stage : "preflight") as EngineInstallStage;
    return { state: "running", stage, stageLabel: STAGE_LABELS[stage], problem: null };
  }
  return NO_ENGINE_INSTALL;
}

/** The checks step already passed before the engine existed, so its "start
 * the downloads" had nothing to talk to. Do it now, once, when the engine
 * first answers. */
function beginDownloadsAfterEngine(): void {
  void (async () => {
    const [{ getSetupState }, { startSetupDownloads }, { getStackClient }] = await Promise.all([
      import("@/lib/setupState"), import("@/setup/checks/setupDownloads"), import("@/lib/stackEngine"),
    ]);
    const setup = getSetupState();
    const checks = setup.steps.find((step) => step.id === "checks");
    // Only while setup is still going: a later Home restart must not re-pull models.
    if (setup.phase !== "done" && checks?.status === "done") await startSetupDownloads(getStackClient()).catch(() => {});
  })().catch(() => {});
}

export type StartEngineInstall = { ok: true; alreadyRunning: boolean } | { ok: false; error: string; next: string };

/** Idempotent: a run in progress is left alone; a failed or stale run is
 * cleared and started again. Refuses outside an installed copy of Home. */
export function startEngineInstall(): StartEngineInstall {
  const current = engineInstallStatus();
  if (current.state === "running") return { ok: true, alreadyRunning: true };
  const dir = installRoot();
  if (!existsSync(join(dir, "scripts", "install.sh"))) {
    return { ok: false, error: "This copy of Home was not set up by the installer, so it cannot install the AI engine itself.", next: "Install the MaiPai Stack yourself, or run the Home installer on this computer." };
  }
  rmSync(statusFile(), { force: true });
  lastReady = false;
  try { runner(dir); }
  catch {
    return { ok: false, error: "Home could not start the AI engine install.", next: `Run it at the computer: sudo bash ${join(dir, "scripts", "install.sh")} --stack-only` };
  }
  startedAt = Date.now();
  resetInstallStatusCache();
  return { ok: true, alreadyRunning: false };
}
