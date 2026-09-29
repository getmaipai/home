import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireInstanceLock,
  assertDataDirPlacement,
  assertNoLegacyDataDirLock,
  DataDirPlacementError,
  HubAlreadyRunningError,
  hubLockPath,
  LEGACY_LOCK_FILE_NAME,
  OPT_OUT_ENV,
} from "@/lib/instanceLock";

// SINGLE-INSTANCE-01 (#194) and -02 (#196): at most ONE hub per machine
// (per OS user), whatever its data directory or port. The lock lives at a
// fixed per-user path, never in the data directory.

const dirs: string[] = [];
const children: Array<ReturnType<typeof Bun.spawn>> = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "maipai-lock-"));
  dirs.push(d);
  return d;
}
/** A lock path in its own throwaway directory: tests never touch ~/.maipai. */
const lockIn = (d: string) => join(d, "home", "hub.lock");
afterEach(() => {
  for (const c of children.splice(0)) c.kill();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function bunChild(): ReturnType<typeof Bun.spawn> {
  const c = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 60000)"], { stdout: "ignore", stderr: "ignore" });
  children.push(c);
  return c;
}
function writeLock(path: string, pid: number, startedAt: number, port = 8787, dataDir = "/elsewhere/data"): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ pid, startedAt, port, dataDir, cwd: "/elsewhere" }));
}
const readLock = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const ident = (dataDir: string, port = 8787) => ({ port, dataDir });

describe("where the machine lock lives", () => {
  test("the default is a fixed per-user path that ignores cwd and the data directory", () => {
    expect(hubLockPath({}, "/home/x", "linux")).toBe("/home/x/.maipai/home/hub.lock");
    expect(hubLockPath({ MAIPAI_DATA_DIR: "/somewhere/else" }, "/home/x", "darwin")).toBe("/home/x/.maipai/home/hub.lock");
    expect(hubLockPath({ LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, "C:\\Users\\x", "win32")).toContain("MaiPai");
  });
  test("MAIPAI_HUB_LOCK_PATH overrides it (tests point it at a temp path)", () => {
    expect(hubLockPath({ MAIPAI_HUB_LOCK_PATH: "/tmp/t/hub.lock" }, "/home/x", "linux")).toBe("/tmp/t/hub.lock");
  });
});

describe("the machine-wide hub lock", () => {
  test("taking the lock records pid, port, data directory and cwd; releasing removes it", () => {
    const path = lockIn(tmp());
    const lock = acquireInstanceLock(path, ident("/data/a"));
    expect(readLock(path)).toMatchObject({ pid: process.pid, port: 8787, dataDir: "/data/a", cwd: process.cwd() });
    lock.setPort(9000);
    expect(readLock(path).port).toBe(9000);
    lock.release();
    expect(existsSync(path)).toBe(false);
  });

  test("a second boot is refused whatever its data directory or port, naming pid, port, data directory and the stop command", () => {
    const path = lockIn(tmp());
    const owner = bunChild();
    writeLock(path, owner.pid, Date.now(), 8787, "/data/real");
    let caught: unknown;
    try {
      acquireInstanceLock(path, ident("/data/stray", 9999));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HubAlreadyRunningError);
    const msg = (caught as Error).message;
    expect(msg).toContain(`PID ${owner.pid}`);
    expect(msg).toContain("port 8787");
    expect(msg).toContain("/data/real");
    expect(msg).toContain(`kill ${owner.pid}`);
    expect(readLock(path).pid).toBe(owner.pid);
    expect(readdirSync(join(path, ".."))).toEqual(["hub.lock"]);
  });

  test("a stale lock from a dead pid is reclaimed", async () => {
    const path = lockIn(tmp());
    const dead = bunChild();
    dead.kill();
    await dead.exited;
    writeLock(path, dead.pid, Date.now());
    const lock = acquireInstanceLock(path, ident("/data/a"));
    expect(readLock(path).pid).toBe(process.pid);
    lock.release();
  });

  test("a pid reused by an unrelated (non-bun) process is reclaimed", () => {
    const path = lockIn(tmp());
    const stranger = Bun.spawn(["sleep", "60"], { stdout: "ignore", stderr: "ignore" });
    children.push(stranger);
    writeLock(path, stranger.pid, Date.now());
    const lock = acquireInstanceLock(path, ident("/data/a"));
    expect(readLock(path).pid).toBe(process.pid);
    lock.release();
  });

  test("a pid reused by a bun process that started after the lock was written is reclaimed", () => {
    const path = lockIn(tmp());
    const later = bunChild();
    writeLock(path, later.pid, Date.now() - 3_600_000);
    const lock = acquireInstanceLock(path, ident("/data/a"));
    expect(readLock(path).pid).toBe(process.pid);
    lock.release();
  });

  test("an unreadable lock file is reclaimed", () => {
    const path = lockIn(tmp());
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "not json");
    const lock = acquireInstanceLock(path, ident("/data/a"));
    expect(readLock(path).pid).toBe(process.pid);
    lock.release();
  });

  test("release never removes a lock some other hub now owns", () => {
    const path = lockIn(tmp());
    const lock = acquireInstanceLock(path, ident("/data/a"));
    const owner = bunChild();
    writeLock(path, owner.pid, Date.now());
    lock.release();
    expect(readLock(path).pid).toBe(owner.pid);
  });
});

describe("a hub that predates the machine lock (data-directory hub.lock)", () => {
  test("a live one on the same data directory still refuses a new hub; a stale one is cleared", async () => {
    const dir = tmp();
    const owner = bunChild();
    writeFileSync(join(dir, LEGACY_LOCK_FILE_NAME), JSON.stringify({ pid: owner.pid, startedAt: Date.now(), port: 8787, cwd: "/x" }));
    expect(() => assertNoLegacyDataDirLock(dir)).toThrow(HubAlreadyRunningError);
    owner.kill();
    await owner.exited;
    assertNoLegacyDataDirLock(dir);
    expect(existsSync(join(dir, LEGACY_LOCK_FILE_NAME))).toBe(false);
  });
});

describe("the boot guard, as a real second process", () => {
  const guard = join(import.meta.dir, "../src/lib/bootGuard.ts");
  /** A production-style boot: the test-only opt-out is stripped from the env. */
  function boot(lockPath: string, dataDir: string, port: string, extra: Record<string, string> = {}, script?: string) {
    const env: Record<string, string | undefined> = { ...process.env, MAIPAI_HUB_LOCK_PATH: lockPath, MAIPAI_DATA_DIR: dataDir, PORT: port, ...extra };
    if (!("keepOptOut" in extra)) delete env[OPT_OUT_ENV];
    delete env.keepOptOut;
    return Bun.spawn(
      [process.execPath, "-e", script ?? `import ${JSON.stringify(guard)}; console.log("BOOTED"); setTimeout(() => {}, 60000);`],
      { env: env as Record<string, string>, stdout: "pipe", stderr: "pipe" },
    );
  }

  test("a production-style second hub on a different data directory and port exits 1, names the first, and touches nothing", async () => {
    const root = tmp();
    const lockPath = lockIn(root);
    const dataA = join(root, "data-a");
    const dataB = join(root, "data-b");
    const first = boot(lockPath, dataA, "8799");
    children.push(first);
    expect(new TextDecoder().decode((await first.stdout.getReader().read()).value)).toContain("BOOTED");

    const second = boot(lockPath, dataB, "8798");
    const [err, code] = await Promise.all([new Response(second.stderr).text(), second.exited]);
    expect(code).toBe(1);
    expect(err).toContain(`PID ${first.pid}`);
    expect(err).toContain("port 8799");
    expect(err).toContain(dataA);
    expect(err).toContain(`kill ${first.pid}`);
    // The refused hub never created its data directory, let alone a database.
    expect(existsSync(dataB)).toBe(false);
  });

  test("with the test-only opt-out, hubs on their own data directories run side by side and take no lock", async () => {
    const root = tmp();
    const lockPath = lockIn(root);
    const a = boot(lockPath, join(root, "a"), "8797", { [OPT_OUT_ENV]: "1", keepOptOut: "1" });
    const b = boot(lockPath, join(root, "b"), "8796", { [OPT_OUT_ENV]: "1", keepOptOut: "1" });
    children.push(a, b);
    expect(new TextDecoder().decode((await a.stdout.getReader().read()).value)).toContain("BOOTED");
    expect(new TextDecoder().decode((await b.stdout.getReader().read()).value)).toContain("BOOTED");
    expect(existsSync(lockPath)).toBe(false);
  });

  test("SIGTERM releases the lock so the next boot starts", async () => {
    const root = tmp();
    const lockPath = lockIn(root);
    const first = boot(
      lockPath, join(root, "a"), "8799", {},
      `import ${JSON.stringify(guard)}; process.on("SIGTERM", () => process.exit(0)); console.log("BOOTED"); setTimeout(() => {}, 60000);`,
    );
    children.push(first);
    await first.stdout.getReader().read();
    first.kill("SIGTERM");
    await first.exited;
    expect(existsSync(lockPath)).toBe(false);
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
