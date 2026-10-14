import { readFileSync } from "node:fs";
import { homedir, freemem, totalmem } from "node:os";
import { createConnection } from "node:net";
import { hubLockPath } from "./instanceLock";

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
  freeBytes?: () => number | null;
  memoryBytes?: () => { free: number; total: number };
  systemVersion?: () => string;
  lockInfo?: () => { pid: number; port?: number } | null;
  portBusy?: (port: number) => Promise<boolean>;
  reachReleaseHost?: (host: string) => Promise<boolean>;
  now?: () => Date;
};

const RELEASE_HOST = "github.com";
const GB = 1_000_000_000;
const since = (opts: InstallPreflightOptions) => (opts.now ?? (() => new Date()))().toISOString();

function row(opts: InstallPreflightOptions, code: string, severity: PreflightSeverity | null, title: string, text: string, cause: string, fix: string): InstallPreflightRow {
  return { id: `install.${code}`, code: `install.${code}`, severity, message: text, title, text, since: since(opts), cause, ...(severity ? { fix: { label: fix, action: "retry_download" as const } } : {}) };
}

function defaultFreeBytes(): number | null {
  try {
    const output = Bun.spawnSync(["df", "-Pk", homedir()], { stdout: "pipe", stderr: "ignore" });
    const lines = output.stdout.toString().trim().split(/\r?\n/);
    const fields = lines.at(-1)?.trim().split(/\s+/);
    return fields?.[3] ? Number(fields[3]) * 1024 : null;
  } catch { return null; }
}

function defaultLockInfo(path: string): { pid: number; port?: number } | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown; port?: unknown };
    return typeof value.pid === "number" ? { pid: value.pid, port: typeof value.port === "number" ? value.port : undefined } : null;
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
  const lock = (opts.lockInfo ?? (() => defaultLockInfo(opts.lockPath ?? hubLockPath())))();
  const port = opts.port ?? Number(process.env.PORT ?? 3000);
  const [busy, reachable] = await Promise.all([
    (opts.portBusy ?? tcpBusy)(port),
    (opts.reachReleaseHost ?? plainHostReach)(releaseHost),
  ]);
  const disk = (opts.freeBytes ?? defaultFreeBytes)();
  return [
    disk === null
      ? row(opts, "disk.unknown", "warning", "Free disk space is unknown", "Home could not read the free space on this computer.", "The operating system did not report free disk space.", "Check storage in system settings.")
      : disk < 2 * GB
        ? row(opts, "disk.low", "error", "This computer is low on disk space", "Free at least 2 GB before installing Home.", `Only ${(disk / GB).toFixed(1)} GB is free.`, "Free at least 2 GB, then try again.")
        : row(opts, "disk.ok", null, "Disk space", `${(disk / GB).toFixed(1)} GB is free; this check passed.`, "The home volume has at least 2 GB free.", ""),
    mem.total < 4 * GB
      ? row(opts, "memory.low", "error", "This computer has too little memory", "Home needs at least 4 GB of memory to install.", `${(mem.total / GB).toFixed(1)} GB of memory is available in total.`, "Use a computer with at least 4 GB of memory.")
      : mem.free < 512 * 1024 * 1024
        ? row(opts, "memory.pressure", "warning", "Memory is almost full", "Close some apps before installing Home.", `Only ${(mem.free / 1024 / 1024).toFixed(0)} MB of memory is free.`, "Close apps, then try again.")
        : row(opts, "memory.ok", null, "Memory", `${(mem.free / GB).toFixed(1)} GB is currently free; this check passed.`, "The computer has enough memory for installation.", ""),
    (["darwin", "linux", "win32"].includes(platform) && !(platform === "darwin" && architecture === "x64"))
      ? row(opts, "system.ok", null, "System version", `${version} is supported for installation.`, `Installer platform is ${platform}.`, "")
      : row(opts, "system.unsupported", "error", "This system is not supported", `${version} is not supported by the Home installer.`, `Installer platform is ${platform}${platform === "darwin" ? ` ${architecture}` : ""}.`, "Use a supported Apple silicon Mac, Linux, or Windows computer."),
    lock
      ? row(opts, "instance.running", "error", "Home is already running", `Another Home instance is recorded in the lock file (PID ${lock.pid}).`, "The Home instance lock file is present.", "Stop that Home instance, then try again.")
      : row(opts, "instance.ok", null, "Running instance", "No Home instance is recorded in the lock file.", "No active lock file was found.", ""),
    busy
      ? row(opts, "port.busy", "warning", "The Home port is busy", `Port ${port} is already in use. The installer can select another port.`, `A process accepted a connection on port ${port}.`, "Stop the program using this port or let the installer choose another port.")
      : row(opts, "port.ok", null, "Home port", `Port ${port} is available.`, `No listener accepted a connection on port ${port}.`, ""),
    reachable
      ? row(opts, "release.reachable", null, "Release host", `The public release host ${releaseHost} can be reached.`, `A plain TCP connection to ${releaseHost}:443 succeeded.`, "")
      : row(opts, "release.unreachable", "warning", "Release host is unreachable", `Home could not reach the public release host ${releaseHost}.`, `A plain TCP connection to ${releaseHost}:443 failed or timed out.`, "Check the internet connection, then try again."),
  ];
}

export function installPreflightBlockers(rows: readonly InstallPreflightRow[]): InstallPreflightRow[] {
  return rows.filter((item) => item.severity === "critical" || item.severity === "error");
}
