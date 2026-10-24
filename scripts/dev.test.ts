import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const scratch = mkdtempSync(join(tmpdir(), "maipai-devtest-"));
const scriptSource = join(import.meta.dir, "dev.sh");

function fixture(name: string, gitKind: "file" | "directory") {
  const root = join(scratch, name);
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "data"), { recursive: true });
  copyFileSync(scriptSource, join(root, "scripts", "dev.sh"));
  if (gitKind === "file") writeFileSync(join(root, ".git"), "gitdir: elsewhere\n");
  else mkdirSync(join(root, ".git"));
  return root;
}

const worktree = fixture("worktree", "file");
const main = fixture("main", "directory");
function run(root: string, ...args: string[]) {
  return spawnSync("bash", [join(root, "scripts", "dev.sh"), ...args], {
    encoding: "utf8",
    env: { ...process.env, MAIPAI_DEV_ROOT: root },
  });
}

describe("scripts/dev.sh", () => {
  test("chooses a stable worktree port in the 88xx range", () => {
    const first = run(worktree, "port");
    const second = run(worktree, "port");
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(Number(first.stdout.trim())).toBeGreaterThanOrEqual(8800);
    expect(Number(first.stdout.trim())).toBeLessThanOrEqual(8899);
    expect(second.stdout.trim()).toBe(first.stdout.trim());
  });

  test("uses 8787 for a main checkout", () => {
    const out = run(main, "port");
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe("8787");
  });

  test("explicit port overrides checkout type and drives both URLs", () => {
    const port = run(worktree, "port", "--port", "8850");
    expect(port.status).toBe(0);
    expect(port.stdout.trim()).toBe("8850");
    const url = run(worktree, "url", "--port", "8850");
    expect(url.status).toBe(0);
    expect(url.stdout).toContain("http://localhost:9850");
    expect(url.stdout).toContain("http://127.0.0.1:8850");
  });

  test("status reports both processes stopped without pid files", () => {
    const out = run(worktree, "status");
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("backend: stopped");
    expect(out.stdout).toContain("vite: stopped");
  });

  test("stop removes a stale backend pid file", () => {
    const state = join(worktree, "data", "dev");
    mkdirSync(state, { recursive: true });
    const pidFile = join(state, "backend.pid");
    writeFileSync(pidFile, "2147000000\n");
    const out = run(worktree, "stop");
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("Dev Home stopped.");
    expect(Bun.file(pidFile).exists()).resolves.toBe(false);
  });

  test("stop leaves the seeded marker alone", async () => {
    const state = join(worktree, "data", "dev");
    mkdirSync(join(state, "hub"), { recursive: true });
    writeFileSync(join(state, "hub", "hub.db"), "");
    const marker = join(state, "seeded");
    writeFileSync(marker, "seeded\n");
    const out = run(worktree, "stop");
    expect(out.status).toBe(0);
    expect(await Bun.file(marker).exists()).toBe(true);
  });
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));
