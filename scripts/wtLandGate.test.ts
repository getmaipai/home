import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import * as fixtures from "./tests/wtFixtures";
const { scratch, repoRoot, common, script, hasNode, hasTmuxBin, fixture, bare, data, socket, run, fixtureEnv, setup, cleanup } = fixtures.createWtFixtures();
beforeAll(setup);
afterAll(cleanup);

// The fixture check takes the real heavy-run slot; a busy Mac (load over 20) made it wait past the 30 s test limit (issue 280).
const IDLE_MACHINE = { GATE_HEAVY_LOAD_CMD: "echo 0", GATE_HEAVY_FREE_CMD: "echo 100" };

describe.skipIf(!hasNode)("wt.sh land gate stamp (needs node installed)", () => {
  const originMain = () => spawnSync("git", ["--git-dir", bare, "rev-parse", "main"], { encoding: "utf8" }).stdout.trim();
  // A worktree with one committed file; `file` decides the tier (docs T0, other code T1).
  const session = (slug: string, file: string) => {
    const started = run(["start", slug]);
    if (started.status !== 0 || !started.stdout.trim()) throw new Error(`wt.sh start failed: ${started.stderr}`);
    const path = started.stdout.trim();
    const name = path.split("/").at(-1)!.replace(/^home-/, "");
    mkdirSync(join(path, file, ".."), { recursive: true });
    writeFileSync(join(path, file), `${slug}\n`);
    spawnSync("git", ["-C", path, "add", file]);
    spawnSync("git", ["-C", path, "commit", "-m", slug], { env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.invalid" } });
    const sh = (args: string[]) => spawnSync("bash", [script, ...args], { cwd: path, encoding: "utf8", env: fixtureEnv({ MAIPAI_WT_SESSION: name, ...IDLE_MACHINE }) });
    const stampPath = join(data, "gate-stamps", `${name}.json`);
    const edit = (fn: (s: any) => void) => { const s = JSON.parse(readFileSync(stampPath, "utf8")); fn(s); writeFileSync(stampPath, JSON.stringify(s)); };
    return { path, name, sh, stampPath, edit };
  };
  const refused = (r: { status: number | null; stderr: string }, text: string, next: string) => {
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(text);
    expect(r.stderr).toContain(next);
  };

  test("refuses with the exact next command when no stamp exists", () => {
    const before = originMain();
    const s = session("nostamp", "docs/nostamp.md");
    refused(s.sh(["land"]), "no gate stamp", `MAIPAI_WT_SESSION=${s.name} bash scripts/wt.sh check`);
    expect(originMain()).toBe(before);
    s.sh(["done"]);
  });

  test("refuses a failed, too-weak, stale, or drifted stamp, then lands after a fresh green check", () => {
    const before = originMain();
    const s = session("stamped", "tools/stamped.ts");
    expect(s.sh(["check"]).status).toBe(0);
    const good = readFileSync(s.stampPath, "utf8");
    const next = `MAIPAI_WT_SESSION=${s.name} bash scripts/wt.sh check`;

    s.edit((j) => { j.exitCode = 1; });
    refused(s.sh(["land"]), "check for session", next);

    writeFileSync(s.stampPath, good);
    s.edit((j) => { j.tier = "T0"; });
    refused(s.sh(["land"]), "need tier T1", `${next} T1`);

    writeFileSync(s.stampPath, good);
    s.edit((j) => { j.created = new Date(Date.now() - 241 * 60 * 1000).toISOString(); });
    refused(s.sh(["land"]), "only 4 hours counts", next);

    writeFileSync(s.stampPath, good);
    writeFileSync(join(s.path, "tools/stamped.ts"), "changed after the check\n");
    spawnSync("git", ["-C", s.path, "commit", "-am", "drift"], { env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.invalid" } });
    refused(s.sh(["land"]), "changed since the gate stamp", next);
    expect(originMain()).toBe(before);

    expect(s.sh(["check"]).status).toBe(0);
    const landed = s.sh(["land"]);
    expect(landed.status).toBe(0);
    expect(originMain()).not.toBe(before);
  }, 30000);

  test("a stronger stamp than needed lands", () => {
    const s = session("stronger", "docs/stronger.md");
    expect(s.sh(["check", "T1"]).status).toBe(0);
    expect(JSON.parse(readFileSync(s.stampPath, "utf8")).tier).toBe("T1");
    expect(s.sh(["land"]).status).toBe(0);
  }, 30000);
});
