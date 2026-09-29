import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireInstanceLock,
  assertDataDirPlacement,
  DataDirPlacementError,
  HubAlreadyRunningError,
  LOCK_FILE_NAME,
} from "@/lib/instanceLock";

// SINGLE-INSTANCE-01 (#194): one hub per data directory, taken from the
// data directory itself, so a hand-started second hub cannot run beside
// the real one.

const dirs: string[] = [];
const children: Array<ReturnType<typeof Bun.spawn>> = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "maipai-lock-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const c of children.splice(0)) c.kill();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function bunChild(): ReturnType<typeof Bun.spawn> {
  const c = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 60000)"], { stdout: "ignore", stderr: "ignore" });
  children.push(c);
  return c;
}
function writeLock(dir: string, pid: number, startedAt: number, port = 8787): void {
  writeFileSync(join(dir, LOCK_FILE_NAME), JSON.stringify({ pid, startedAt, port, cwd: "/elsewhere" }));
}
const readLock = (dir: string) => JSON.parse(readFileSync(join(dir, LOCK_FILE_NAME), "utf8"));

describe("hub lock in the data directory", () => {
  test("taking the lock records pid and port; releasing removes it", () => {
    const dir = tmp();
    const lock = acquireInstanceLock(dir, 8787);
    expect(readLock(dir)).toMatchObject({ pid: process.pid, port: 8787 });
    lock.setPort(9000);
    expect(readLock(dir).port).toBe(9000);
    lock.release();
    expect(existsSync(join(dir, LOCK_FILE_NAME))).toBe(false);
  });

  test("a second boot is refused when a live hub owns the directory, naming its pid and port", () => {
    const dir = tmp();
    const owner = bunChild();
    writeLock(dir, owner.pid, Date.now(), 8787);
    let caught: unknown;
    try {
      acquireInstanceLock(dir, 8787);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HubAlreadyRunningError);
    expect((caught as Error).message).toContain(`PID ${owner.pid}`);
    expect((caught as Error).message).toContain("port 8787");
    // The refused boot left the owner's lock and created nothing else.
    expect(readLock(dir).pid).toBe(owner.pid);
    expect(readdirSync(dir)).toEqual([LOCK_FILE_NAME]);
  });

  test("a stale lock from a dead pid is reclaimed", async () => {
    const dir = tmp();
    const dead = bunChild();
    dead.kill();
    await dead.exited;
    writeLock(dir, dead.pid, Date.now());
    const lock = acquireInstanceLock(dir, 8787);
    expect(readLock(dir).pid).toBe(process.pid);
    lock.release();
  });

  test("a pid reused by an unrelated (non-bun) process is reclaimed", () => {
    const dir = tmp();
    const stranger = Bun.spawn(["sleep", "60"], { stdout: "ignore", stderr: "ignore" });
    children.push(stranger);
    writeLock(dir, stranger.pid, Date.now());
    const lock = acquireInstanceLock(dir, 8787);
    expect(readLock(dir).pid).toBe(process.pid);
    lock.release();
  });

  test("a pid reused by a bun process that started after the lock was written is reclaimed", () => {
    const dir = tmp();
    const later = bunChild();
    writeLock(dir, later.pid, Date.now() - 3_600_000);
    const lock = acquireInstanceLock(dir, 8787);
    expect(readLock(dir).pid).toBe(process.pid);
    lock.release();
  });

  test("an unreadable lock file is reclaimed", () => {
    const dir = tmp();
    writeFileSync(join(dir, LOCK_FILE_NAME), "not json");
    const lock = acquireInstanceLock(dir, 8787);
    expect(readLock(dir).pid).toBe(process.pid);
    lock.release();
  });

  test("hubs on different data directories run side by side", () => {
    const a = acquireInstanceLock(tmp(), 8787);
    const b = acquireInstanceLock(tmp(), 8787);
    a.release();
    b.release();
  });

  test("release never removes a lock some other hub now owns", () => {
    const dir = tmp();
    const lock = acquireInstanceLock(dir, 8787);
    const owner = bunChild();
    writeLock(dir, owner.pid, Date.now());
    lock.release();
    expect(readLock(dir).pid).toBe(owner.pid);
  });
});

describe("the boot guard, as a real second process", () => {
  const guard = join(import.meta.dir, "../src/lib/bootGuard.ts");
  function boot(dir: string, extra: Record<string, string> = {}) {
    return Bun.spawn(
      [process.execPath, "-e", `import ${JSON.stringify(guard)}; console.log("BOOTED"); setTimeout(() => {}, 60000);`],
      { env: { ...process.env, MAIPAI_DATA_DIR: dir, PORT: "8799", ...extra }, stdout: "pipe", stderr: "pipe" },
    );
  }

  test("the second hub exits non-zero with a plain message and never creates a database", async () => {
    const dir = tmp();
    const first = boot(dir);
    children.push(first);
    const reader = first.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("BOOTED");

    const second = boot(dir);
    const [err, code] = await Promise.all([new Response(second.stderr).text(), second.exited]);
    expect(code).not.toBe(0);
    expect(err).toContain(`PID ${first.pid}`);
    expect(err).toContain("port 8799");
    expect(readdirSync(dir)).toEqual([LOCK_FILE_NAME]);
  });

  test("SIGTERM releases the lock so the next boot starts", async () => {
    const dir = tmp();
    const first = Bun.spawn(
      [process.execPath, "-e", `import ${JSON.stringify(guard)}; process.on("SIGTERM", () => process.exit(0)); console.log("BOOTED"); setTimeout(() => {}, 60000);`],
      { env: { ...process.env, MAIPAI_DATA_DIR: dir, PORT: "8799" }, stdout: "pipe", stderr: "ignore" },
    );
    children.push(first);
    await first.stdout.getReader().read();
    first.kill("SIGTERM");
    await first.exited;
    expect(existsSync(join(dir, LOCK_FILE_NAME))).toBe(false);
  });
});

describe("a data directory outside the repo needs MAIPAI_DATA_DIR set on purpose", () => {
  const repoRoot = "/work/org/home";
  test("the stray org-root folder is refused with a clear message", () => {
    expect(() => assertDataDirPlacement("/work/org/data", { explicit: false, repoRoot, home: "/home/x" })).toThrow(
      DataDirPlacementError,
    );
    expect(() => assertDataDirPlacement("/work/org/data", { explicit: false, repoRoot, home: "/home/x" })).toThrow(
      /MAIPAI_DATA_DIR/,
    );
  });
  test("the repo's own data folder, an explicit override, and the installed layout are allowed", () => {
    assertDataDirPlacement("/work/org/home/data", { explicit: false, repoRoot, home: "/home/x" });
    assertDataDirPlacement("/somewhere/else", { explicit: true, repoRoot, home: "/home/x" });
    assertDataDirPlacement("/home/x/.maipai/home/data", { explicit: false, repoRoot, home: "/home/x" });
  });
  test("a sibling folder that merely shares the repo's name prefix is still refused", () => {
    expect(() => assertDataDirPlacement("/work/org/home-old/data", { explicit: false, repoRoot, home: "/home/x" })).toThrow(
      DataDirPlacementError,
    );
  });
});
