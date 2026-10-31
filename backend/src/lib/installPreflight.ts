import { readFileSync, unlinkSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { createConnection } from "node:net";
import { hubLockPath } from "./instanceLock";
import { homePort } from "./ports";
import { defaultDiskPaths, planVolumes, recordedLevel, setupDiskVerdict, shippedPlanForLevel, type DiskIo, type DiskLevel, type DiskPaths } from "./diskPlan";
import { needGb } from "../../../shared/diskPlanMath";

export type PreflightSeverity = "critical" | "error" | "warning";
export type InstallPreflightRow = {
  id: string;
  code: string;
  severity: PreflightSeverity | null;
  message: string;
  title: string;
  text: string;
  since: string;
  cause: string;
  fix?: { label: string; action: "retry_download" };
};

export type InstallPreflightOptions = {
  platform?: string;
  architecture?: string;
  releaseHost?: string;
  lockPath?: string;
  port?: number;
  /** Free bytes on the disk that holds a folder (the real reading is statfs of the nearest folder that exists). */
  freeBytes?: (path: string) => number | null;
  /** The disk a folder is on, to tell which folders share one. */
  device?: DiskIo["device"];
  /** The plan level whose size is checked; defaults to the level the installer recorded, then Recommended. */
  level?: DiskLevel;
  /** Where the program, Home's data and the AI's files will be; defaults to this install. */
  paths?: DiskPaths;
  /** Memory in bytes and platform, to pick the plan the computer can run. */
  machine?: { platform?: string; totalMemoryBytes?: number; graphicsGb?: () => number | null };
  memoryBytes?: () => { free: number; total: number };
  systemVersion?: () => string;
  lockInfo?: () => { pid: number; port?: number } | null;
  portBusy?: (port: number) => Promise<boolean>;
  reachReleaseHost?: (host: string) => Promise<boolean>;
  now?: () => Date;
};

/** The installer and setup Checks must agree on the supported Home hosts. */
export function isSupportedInstallPlatform(platform: string, architecture: string): boolean {
  return ["darwin", "linux", "win32"].includes(platform) && !(platform === "darwin" && architecture === "x64");
}

const RELEASE_HOST = "github.com";
const GB = 1_000_000_000;
const since = (opts: InstallPreflightOptions) => (opts.now ?? (() => new Date()))().toISOString();

function row(opts: InstallPreflightOptions, code: string, severity: PreflightSeverity | null, title: string, text: string, cause: string, fix: string): InstallPreflightRow {
  return { id: `install.${code}`, code: `install.${code}`, severity, message: text, title, text, since: since(opts), cause, ...(severity ? { fix: { label: fix, action: "retry_download" as const } } : {}) };
}

/** The disk row: what the chosen plan level needs (its installed size, 20 percent more, and the peak temporary space), against the
 * free space of every disk that holds Home's program, Home's data folder or the AI's files. */
function diskRow(opts: InstallPreflightOptions): InstallPreflightRow {
  const level = opts.level ?? recordedLevel();
  const plan = shippedPlanForLevel(level, opts.machine);
  const volumes = planVolumes(opts.paths ?? defaultDiskPaths(), { freeBytes: opts.freeBytes, device: opts.device });
  const verdict = setupDiskVerdict(plan, plan.default_selected, volumes);
  const cause = `The ${level} plan on this computer is the ${plan.tier} plan: ${needGb(verdict.requiredBytes)} GB asked for (installed size, 20 percent more, and the space an install needs while it runs); ${verdict.freeBytes === null ? "free space unknown" : `${needGb(verdict.freeBytes)} GB free`}.`;
  if (volumes.every((volume) => volume.freeBytes === null)) return row(opts, "disk.unknown", "warning", "Free disk space is unknown", verdict.text, cause, "Check storage in system settings.");
  if (verdict.state === "red") return row(opts, "disk.low", "error", "This computer is low on disk space", verdict.text, cause, `${verdict.fix}. To install less, run the installer with --plan moderate or --plan minimal.`);
  if (verdict.state === "amber") return row(opts, "disk.tight", "warning", "Disk space is tight", verdict.text, cause, verdict.fix);
  return row(opts, "disk.ok", null, "Disk space", verdict.text, cause, "");
}

function defaultLockInfo(path: string): { pid: number; port?: number } | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown; port?: unknown };
    if (typeof value.pid !== "number") return null;
    try { process.kill(value.pid, 0); return { pid: value.pid, port: typeof value.port === "number" ? value.port : undefined }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") return { pid: value.pid, port: typeof value.port === "number" ? value.port : undefined };
      const port = typeof value.port === "number" ? value.port : undefined;
      if (port === undefined) { try { unlinkSync(path); } catch { /* already gone */ } return null; }
      // The port check is performed by the caller; a dead pid lock remains
      // harmless only when no process is listening on its recorded port.
      return { pid: -value.pid, port };
    }
  } catch { return null; }
}

function tcpBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
  });
}

function plainHostReach(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port: 443 });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.setTimeout(2000, () => { socket.destroy(); resolve(false); });
  });
}

/** Read-only preflight shared by installer entry points and the setup wizard. */
export async function checkInstallPreflight(opts: InstallPreflightOptions = {}): Promise<InstallPreflightRow[]> {
  const platform = opts.platform ?? process.platform;
  const architecture = opts.architecture ?? process.arch;
  const releaseHost = opts.releaseHost ?? RELEASE_HOST;
  const mem = (opts.memoryBytes ?? (() => ({ free: freemem(), total: totalmem() })))();
  const version = (opts.systemVersion ?? (() => `${platform} ${process.arch}`))();
  const lockPath = opts.lockPath ?? hubLockPath();
  let lock = (opts.lockInfo ?? (() => defaultLockInfo(lockPath)))();
  const port = opts.port ?? homePort();
  const [portBusy, reachable] = await Promise.all([
    (opts.portBusy ?? tcpBusy)(port),
    (opts.reachReleaseHost ?? plainHostReach)(releaseHost),
  ]);
  const staleLockBusy = lock?.pid !== undefined && lock.pid < 0 && portBusy;
  const busy = portBusy || staleLockBusy;
  if (lock && lock.pid < 0 && !portBusy) {
    try { unlinkSync(lockPath); } catch { /* already gone */ }
    lock = null;
  }
  return [
    diskRow(opts),
    mem.total < 4 * GB
      ? row(opts, "memory.low", "error", "This computer has too little memory", "Home needs at least 4 GB of memory to install.", `${(mem.total / GB).toFixed(1)} GB of memory is available in total.`, "Use a computer with at least 4 GB of memory.")
      : mem.free < 512 * 1024 * 1024
        ? row(opts, "memory.pressure", "warning", "Memory is almost full", "Close some apps before installing Home.", `Only ${(mem.free / 1024 / 1024).toFixed(0)} MB of memory is free.`, "Close apps, then try again.")
        : row(opts, "memory.ok", null, "Memory", `${(mem.free / GB).toFixed(1)} GB is currently free; this check passed.`, "The computer has enough memory for installation.", ""),
    (isSupportedInstallPlatform(platform, architecture))
      ? row(opts, "system.ok", null, "System version", `${version} is supported for installation.`, `Installer platform is ${platform}.`, "")
      : row(opts, "system.unsupported", "error", "This system is not supported", `${version} is not supported by the Home installer.`, `Installer platform is ${platform}${platform === "darwin" ? ` ${architecture}` : ""}.`, "Use a supported Apple silicon Mac, Linux, or Windows computer."),
    lock
      ? row(opts, "instance.running", "error", "Home is already running", `Another Home instance is recorded in the lock file (PID ${lock.pid}).`, "The Home instance lock file is present.", "Stop that Home instance, then try again.")
      : row(opts, "instance.ok", null, "Running instance", "No Home instance is recorded in the lock file; a stale lock was removed.", "No active lock file was found.", ""),
    busy
      ? row(opts, "port.busy", "warning", "The Home port is busy", `Port ${port} is already in use. The installer can select another port.`, `A process accepted a connection on port ${port}.`, "Stop the program using this port or let the installer choose another port.")
      : row(opts, "port.ok", null, "Home port", `Port ${port} is available.`, `No listener accepted a connection on port ${port}.`, ""),
    reachable
      ? row(opts, "release.reachable", null, "Release host", `The public release host ${releaseHost} can be reached.`, `A plain TCP connection to ${releaseHost}:443 succeeded.`, "")
      : row(opts, "release.unreachable", "warning", "Release host is unreachable", `Home could not reach the public release host ${releaseHost}.`, `A plain TCP connection to ${releaseHost}:443 failed or timed out.`, "Check the internet connection, then try again."),
  ];
}
