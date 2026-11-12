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
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  copyFileSync(join(import.meta.dir, "lib", "mode.sh"), join(root, "scripts", "lib", "mode.sh"));
  if (gitKind === "file") writeFileSync(join(root, ".git"), "gitdir: elsewhere\n");
  else mkdirSync(join(root, ".git"));
  return root;
}

const worktree = fixture("worktree", "file");
const main = fixture("main", "directory");
function run(root: string, ...args: (string | Record<string, string>)[]) {
  const env = typeof args.at(-1) === "object" ? args.pop() as Record<string, string> : {};
  const commandArgs = args.filter((arg): arg is string => typeof arg === "string");
  return spawnSync("bash", [join(root, "scripts", "dev.sh"), ...commandArgs], {
    encoding: "utf8",
    env: { ...process.env, MAIPAI_DEV_ROOT: root, MAIPAI_MODE_FILE: "/nonexistent/mode", MAIPAI_MODE: "", ...env },
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

  test("probes forward from a taken hashed slot", () => {
    const sum = Number(spawnSync("cksum", [], { input: `${worktree}\n`, encoding: "utf8" }).stdout.split(/\s+/)[0]);
    const hashed = 8800 + sum % 100;
    const next = 8800 + ((hashed - 8800 + 1) % 100);
    const out = run(worktree, "port", { MAIPAI_DEV_PROBE_CMD: '[[ "$1" == "$MAIPAI_DEV_TAKEN" ]]', MAIPAI_DEV_TAKEN: String(hashed) });
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe(String(next));
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

describe("scripts/dev.sh --workbench", () => {
  const off = { MAIPAI_DEV_TAILSCALE: "off" };

  test("uses a fixed port pair whatever the checkout, and its own data directory", () => {
    for (const root of [worktree, main]) {
      const out = run(root, "port", "--workbench", off);
      expect(out.status).toBe(0);
      expect(out.stdout.trim()).toBe("8780");
    }
    const url = run(worktree, "url", "--workbench", off);
    expect(url.stdout).toContain("http://localhost:9780");
    expect(run(worktree, "port", "--workbench", { ...off, MAIPAI_WORKBENCH_PORT: "8781" }).stdout.trim()).toBe("8781");
  });

  test("refuses the live hub's and the main checkout's ports", () => {
    for (const port of ["8787", "2000"]) {
      const out = run(worktree, "start", "--workbench", "--port", port, off);
      expect(out.status).toBe(2);
      expect(out.stderr).toContain("never uses port");
    }
  });

  test("refuses a data directory inside the live install", () => {
    const out = run(worktree, "start", "--workbench", { ...off, MAIPAI_LIVE_INSTALL_ROOT: join(worktree, "data") });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain("inside the live install");
  });

  test("stop keeps the workbench data and leaves the normal dev hub alone", async () => {
    const wb = join(worktree, "data", "dev", "workbench");
    mkdirSync(join(wb, "hub"), { recursive: true });
    writeFileSync(join(wb, "hub", "hub.db"), "");
    writeFileSync(join(wb, "seeded"), "");
    const status = run(worktree, "status", "--workbench", off);
    expect(status.stdout).toContain("backend: stopped");
    const out = run(worktree, "stop", "--workbench", off);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("Workbench stopped");
    expect(await Bun.file(join(wb, "hub", "hub.db")).exists()).toBe(true);
    expect(await Bun.file(join(wb, "seeded")).exists()).toBe(true);
  });
});

describe("scripts/dev.sh shared workbench default (DEV-BUDGET-01)", () => {
  const off = { MAIPAI_DEV_TAILSCALE: "off", MAIPAI_MODE: "direct" };
  test("url with no flag is the shared workbench; --own is the private per-worktree hub", () => {
    expect(run(worktree, "url", off).stdout).toContain("http://localhost:9780");
    const own = run(worktree, "url", "--own", off).stdout;
    expect(own).not.toContain("9780"); expect(own).toMatch(/http:\/\/localhost:9[89]\d\d/);
  });
  test("in gated mode the default falls back to a private hub (the workbench is off there)", () => {
    expect(run(worktree, "url", { ...off, MAIPAI_MODE: "gated" }).stdout).not.toContain("9780");
  });
  test("--own and --workbench together are refused; plain stop covers both and says so", () => {
    expect(run(worktree, "start", "--own", "--workbench", off).status).toBe(2);
    const out = run(worktree, "stop", off);
    expect(out.status).toBe(0); expect(out.stdout).toContain("Dev Home stopped."); expect(out.stdout).toContain("Workbench stopped");
  });
  test("a workbench that runs from another worktree is named, with --takeover and --own as the ways out", () => {
    const jobs = mkdtempSync(join(tmpdir(), "wb-owner-")); writeFileSync(join(jobs, "workbench-owner"), "/some/other/worktree\n");
    const out = run(worktree, "start", { ...off, MAIPAI_JOBS_DIR: jobs, MAIPAI_DEV_PROBE_CMD: "true" });
    expect(out.status).toBe(1); expect(out.stderr).toContain("/some/other/worktree"); expect(out.stderr).toContain("--takeover"); expect(out.stderr).toContain("--own");
    rmSync(jobs, { recursive: true, force: true });
  });
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));
