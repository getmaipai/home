import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OWNER_PID_FILE = "owner-pid";
export const STALE_DEMO_DATA_MS = 2 * 60 * 60 * 1000;

export interface RunOwner {
  pid: number;
  startedAt: string | null;
  token: string;
}

type OwnerMarker = { kind: "current"; owner: RunOwner } | { kind: "legacy"; pid: number } | { kind: "invalid" } | undefined;
type ProcessStartTime = (pid: number) => string | null | undefined;

function parseOwnerMarker(contents: string): OwnerMarker {
  try {
    const value = JSON.parse(contents) as Partial<RunOwner>;
    if (Number.isInteger(value.pid) && (value.pid ?? 0) > 0 && typeof value.token === "string" && (typeof value.startedAt === "string" || value.startedAt === null)) {
      return { kind: "current", owner: { pid: value.pid!, token: value.token, startedAt: value.startedAt } };
    }
  } catch {
    // Old runs wrote a bare PID. Invalid/partial markers use the age
    // grace period instead of being treated as proof that an owner died.
  }
  const legacyPid = Number(contents.trim());
  if (Number.isInteger(legacyPid) && legacyPid > 0) return { kind: "legacy", pid: legacyPid };
  return { kind: "invalid" };
}

function readMarker(directory: string): OwnerMarker {
  try {
    return parseOwnerMarker(readFileSync(join(directory, OWNER_PID_FILE), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function writeMarker(directory: string, owner: RunOwner): void {
  writeFileSync(join(directory, OWNER_PID_FILE), JSON.stringify(owner));
}

/** Return the process birth string on systems with `ps`; undefined means
 * definitely dead, while null means the PID exists but its birth time is
 * unavailable on this platform. Comparing the birth string prevents a
 * later, unrelated process reusing the recorded PID from pinning an
 * orphaned directory forever. */
export function processStartTime(pid: number): string | null | undefined {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      // The process exists but is owned by another user; ask ps below.
    } else {
      return undefined;
    }
  }
  try {
    const result = Bun.spawnSync({ cmd: ["ps", "-o", "lstart=", "-p", String(pid)], stdout: "pipe", stderr: "ignore" });
    if (result.exitCode !== 0) return null;
    const value = new TextDecoder().decode(result.stdout).trim();
    return value || null;
  } catch {
    return null;
  }
}

export function createOwnedDemoDataDir(root: string, owner: RunOwner): string {
  const directory = join(root, `.demo-data-run-${owner.token}-${crypto.randomUUID()}`);
  mkdirSync(directory);
  try {
    writeMarker(directory, owner);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}

/** Remove only the directory whose marker still carries this run's
 * token. A collided or replaced path is left intact. */
export function removeOwnedDemoDataDir(directory: string, ownerToken: string): boolean {
  if (!existsSync(directory)) return false;
  const marker = readMarker(directory);
  if (marker?.kind !== "current" || marker.owner.token !== ownerToken) return false;
  rmSync(directory, { recursive: true, force: true });
  return true;
}

/** Reclaim old run data, preserving recent missing/corrupt markers and
 * live owners. A valid current-format marker is checked against process
 * start time so PID reuse is distinguishable from the original owner. */
export function sweepStaleDemoDataDirs(
  root: string,
  now = Date.now(),
  getStartTime: ProcessStartTime = processStartTime,
): void {
  for (const name of readdirSync(root).filter((entry) => entry === ".demo-data" || entry.startsWith(".demo-data-"))) {
    const directory = join(root, name);
    try {
      const marker = readMarker(directory);
      const age = now - statSync(directory).mtimeMs;
      if (marker?.kind === "current") {
        const actualStart = getStartTime(marker.owner.pid);
        if (actualStart !== undefined && (marker.owner.startedAt === null || actualStart === null || actualStart === marker.owner.startedAt)) continue;
        // `undefined` is a dead PID; a differing start string is PID reuse.
      } else if (marker?.kind === "legacy") {
        // Legacy markers have no birth time to compare. Keep them through
        // the grace window, then reclaim them even if the PID was reused.
        if (age <= STALE_DEMO_DATA_MS) continue;
      } else if (age <= STALE_DEMO_DATA_MS) {
        // Missing, empty, truncated or malformed marker: do not treat an
        // incomplete write as proof that a possibly-live run is dead.
        continue;
      }
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/** Serialize screenshot-script builds that share frontend/dist. The
 * lock directory is atomic; its owner marker gives later runs a safe
 * stale-owner check, and the final token check cannot remove a newer
 * run's lock. */
export async function withScreenshotBuildLock<T>(
  lockDirectory: string,
  owner: RunOwner,
  runBuild: () => T | Promise<T>,
  getStartTime: ProcessStartTime = processStartTime,
): Promise<T> {
  const waitStarted = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDirectory);
      writeMarker(lockDirectory, owner);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const marker = readMarker(lockDirectory);
      let stale = false;
      if (marker?.kind === "current") {
        const actualStart = getStartTime(marker.owner.pid);
        stale = actualStart === undefined || (marker.owner.startedAt !== null && actualStart !== null && actualStart !== marker.owner.startedAt);
        if (actualStart === null) {
          // If this platform cannot read process birth time, retain a
          // valid lock rather than risk running concurrent dist builds.
          stale = false;
        }
      } else {
        try {
          stale = Date.now() - statSync(lockDirectory).mtimeMs > STALE_DEMO_DATA_MS;
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
        }
      }
      if (stale) {
        const staleToken = marker?.kind === "current" ? marker.owner.token : undefined;
        if (staleToken) removeOwnedDemoDataDir(lockDirectory, staleToken);
        else {
          // Atomically quarantine before removing so a contender cannot
          // have its newly-created lock recursively deleted by this run.
          const quarantine = `${lockDirectory}.stale-${crypto.randomUUID()}`;
          try {
            renameSync(lockDirectory, quarantine);
            rmSync(quarantine, { recursive: true, force: true });
          } catch (renameError) {
            if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") throw renameError;
          }
        }
        continue;
      }
      if (Date.now() - waitStarted > 10 * 60 * 1000) throw new Error("Timed out waiting for the screenshot build lock");
      await Bun.sleep(100);
    }
  }
  try {
    return await runBuild();
  } finally {
    removeOwnedDemoDataDir(lockDirectory, owner.token);
  }
}

/** Read the actual port from backend/index.ts's existing startup URL.
 * The reader keeps draining stdout after finding it so the child cannot
 * block later if its normal logs fill the pipe. */
export async function waitForBackendPort(stdout: ReadableStream<Uint8Array<ArrayBufferLike>>, timeoutMs = 15_000): Promise<number> {
  let settled = false;
  let resolvePort!: (port: number) => void;
  let rejectPort!: (error: Error) => void;
  const portReady = new Promise<number>((resolve, reject) => {
    resolvePort = resolve;
    rejectPort = reject;
  });
  const reader = stdout.getReader();
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          if (!settled) {
            settled = true;
            rejectPort(new Error("Screenshot backend exited before reporting its bound port"));
          }
          return;
        }
        if (settled) continue;
        buffer = (buffer + decoder.decode(value, { stream: true })).slice(-4096);
        const match = buffer.match(/Home URL: https?:\/\/localhost:(\d+)(?:\D|$)/);
        const port = match ? Number(match[1]) : 0;
        if (port > 0 && port <= 65535) {
          settled = true;
          resolvePort(port);
        }
      }
    } catch (error) {
      if (!settled) {
        settled = true;
        rejectPort(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      reader.releaseLock();
    }
  })();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      portReady,
      new Promise<number>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Screenshot backend did not report its bound port within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
