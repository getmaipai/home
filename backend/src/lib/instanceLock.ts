import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, isAbsolute, resolve } from "node:path";

// SINGLE-INSTANCE-01 (#194): one hub per data directory. On 2026-09-29 a
// hub started by hand ran for about 8 hours on a stray data directory,
// in place of the real one, and nothing said two hubs existed. The lock
// is a small JSON file in the data directory itself, so "same data
// directory" and "same lock" are the same fact.

export const LOCK_FILE_NAME = "hub.lock";

export type LockInfo = { pid: number; startedAt: number; port: number; cwd: string };

export class HubAlreadyRunningError extends Error {
  constructor(readonly info: LockInfo, readonly lockPath: string) {
    super(
      `Another Home hub is already running on this data directory (PID ${info.pid}, port ${info.port}). ` +
        `This one will not start, and has not touched the database. ` +
        `Stop the running hub first (for example: kill ${info.pid}). ` +
        `Lock file: ${lockPath}`,
    );
  }
}

export class DataDirPlacementError extends Error {}

type ProcessFacts = { command: string; startedAtMs: number | null };

function psField(pid: number, field: string): string | null {
  const out = Bun.spawnSync(["ps", "-p", String(pid), "-o", `${field}=`], { stdout: "pipe", stderr: "ignore" });
  if (out.exitCode !== 0) return null;
  const text = out.stdout.toString().trim();
  return text === "" ? null : text;
}

function readProcessFacts(pid: number): ProcessFacts | null {
  if (process.platform === "win32") return null;
  const command = psField(pid, "command");
  if (command === null) return null;
  // Elapsed time, not `lstart`: lstart is local wall-clock text, and a
  // process with TZ overridden (bun test forces UTC) misreads it.
  const elapsed = psField(pid, "etime");
  const seconds = elapsed === null ? null : parseEtime(elapsed);
  return { command, startedAtMs: seconds === null ? null : Date.now() - seconds * 1000 };
}

/** ps etime: [[dd-]hh:]mm:ss */
export function parseEtime(text: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text.trim());
  if (m === null) return null;
  const [, d, h, mi, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi) * 60 + Number(s);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but is not ours to signal.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * True only when the lock's pid is alive AND still looks like the hub
 * that wrote it: a bun process that started no later than the lock's
 * own start stamp. A crashed hub whose pid was reused by anything else
 * (a shell, a browser, an unrelated bun script started later) must not
 * block the next boot.
 */
export function isLiveHub(info: LockInfo): boolean {
  if (!Number.isInteger(info.pid) || info.pid <= 1) return false;
  if (!pidAlive(info.pid)) return false;
  const facts = readProcessFacts(info.pid);
  if (facts === null) return process.platform === "win32"; // no ps: trust kill(0) there only
  if (!/(^|[\\/\s])bun(\.exe)?(\s|$)/.test(facts.command)) return false;
  // ps lstart has one-second resolution; allow two seconds of slack.
  if (facts.startedAtMs !== null && facts.startedAtMs > info.startedAt + 2000) return false;
  return true;
}

function parseLock(text: string): LockInfo | null {
  try {
    const v = JSON.parse(text) as Partial<LockInfo>;
    if (typeof v.pid !== "number" || typeof v.startedAt !== "number") return null;
    return { pid: v.pid, startedAt: v.startedAt, port: Number(v.port ?? 0), cwd: String(v.cwd ?? "") };
  } catch {
    return null;
  }
}

export type InstanceLock = {
  path: string;
  info: LockInfo;
  /** Record the port the server actually bound (PORT=0 in tests). */
  setPort(port: number): void;
  release(): void;
};

/**
 * Take the data directory's exclusive hub lock or throw
 * HubAlreadyRunningError. A stale lock (dead pid, a pid reused by an
 * unrelated process, or an unreadable file) is reclaimed.
 */
export function acquireInstanceLock(dir: string, port: number, opts: { pid?: number } = {}): InstanceLock {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, LOCK_FILE_NAME);
  const pid = opts.pid ?? process.pid;
  const info: LockInfo = { pid, startedAt: Date.now(), port, cwd: process.cwd() };

  for (let attempt = 0; attempt < 5; attempt++) {
    // Write the whole record to a private temp file, then link() it into
    // place: link fails with EEXIST if a lock exists, and the lock never
    // appears empty or half-written to a second booter (review, 2026-09-29).
    const tmp = `${path}.${pid}.${attempt}.new`;
    try {
      writeFileSync(tmp, JSON.stringify(info), { mode: 0o600 });
      linkSync(tmp, path);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "ENOTSUP" || code === "EXDEV" || code === "ENOSYS") {
        // No hard links here (FAT, some network mounts): plain exclusive create.
        try {
          writeFileSync(path, JSON.stringify(info), { flag: "wx", mode: 0o600 });
          break;
        } catch (err2) {
          if ((err2 as NodeJS.ErrnoException).code !== "EEXIST") throw err2;
        }
      } else if (code !== "EEXIST") {
        throw err;
      }
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        /* never created */
      }
    }
    let existingText: string;
    try {
      existingText = readFileSync(path, "utf8");
    } catch {
      continue; // vanished between the open and the read: try again
    }
    const existing = parseLock(existingText);
    // Our own pid: a `bun --hot` reload re-evaluates the entry in the
    // same process; that is not a second hub.
    if (existing !== null && existing.pid !== pid && isLiveHub(existing)) {
      throw new HubAlreadyRunningError(existing, path);
    }
    // Stale. Remove it only if it is still the file we judged stale.
    try {
      if (readFileSync(path, "utf8") === existingText) unlinkSync(path);
    } catch {
      /* someone else reclaimed it first; loop and re-judge */
    }
    if (attempt === 4) throw new Error(`Could not take the hub lock at ${path}`);
  }

  const write = (next: LockInfo): void => {
    const tmp = `${path}.${pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    renameSync(tmp, path);
  };
  const lock: InstanceLock = {
    path,
    info,
    setPort(p: number) {
      info.port = p;
      write(info);
    },
    release() {
      try {
        const current = parseLock(readFileSync(path, "utf8"));
        if (current !== null && current.pid === pid) unlinkSync(path);
      } catch {
        /* already gone */
      }
    },
  };
  return lock;
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The stray-folder guard: a data directory outside the repo is allowed
 * only when MAIPAI_DATA_DIR was set on purpose, or when it sits under the
 * installed layout's `~/.maipai/<product>/data` (SERVICES.md). With the
 * default now anchored to the repo this is a backstop against the default
 * ever drifting again, not a check the normal boot can trip.
 */
export function assertDataDirPlacement(
  dataDir: string,
  opts: { explicit: boolean; repoRoot: string; home?: string },
): void {
  if (opts.explicit) return;
  const target = resolve(dataDir);
  if (isInside(resolve(opts.repoRoot), target)) return;
  if (isInside(join(opts.home ?? homedir(), ".maipai"), target)) return;
  throw new DataDirPlacementError(
    `Refusing to start: the data directory ${target} is outside the repo (${opts.repoRoot}) ` +
      `and MAIPAI_DATA_DIR was not set. That is how a stray, empty hub gets created. ` +
      `Set MAIPAI_DATA_DIR to the directory you mean, or start the hub with "bun start".`,
  );
}
