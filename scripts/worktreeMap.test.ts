import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "worktree-map.sh");

test("worktree-map.sh build writes states from session files and read prints one entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "wtmap-"));
  try {
    const sessions = join(dir, "sessions"), land = join(dir, "land"), map = join(dir, "state", "worktrees.json");
    mkdirSync(sessions, { recursive: true }); mkdirSync(join(land, "queue"), { recursive: true });
    const mk = (n: string, runState: string) => { writeFileSync(join(sessions, `${n}.json`), JSON.stringify({ branch: `wt/${n}`, path: `/x/${n}`, runState })); writeFileSync(join(sessions, `${n}.beat`), ""); };
    mk("a", "RUNNING"); mk("b", "DONE"); mk("c", "RUNNING");
    writeFileSync(join(land, "queue", "c.json"), JSON.stringify({ branch: "wt/c" }));
    const env = { ...process.env, MAIPAI_SESSIONS_DIR: sessions, MAIPAI_MAP_FILE: map, MAIPAI_LAND_DATA: land };
    const cwd = resolve(import.meta.dir, "..");
    expect(Bun.spawnSync(["bash", script, "build"], { env, cwd }).exitCode).toBe(0);
    const entries = JSON.parse(readFileSync(map, "utf8")).entries as { branch: string; state: string }[];
    const st = (b: string) => entries.find((e) => e.branch === b)?.state;
    expect(st("wt/a")).toBe("working");
    expect(st("wt/b")).toBe("kept");
    expect(st("wt/c")).toBe("queued");
    const one = Bun.spawnSync(["bash", script, "read", "wt/a"], { env, cwd });
    expect(JSON.parse(one.stdout.toString()).session).toBe("a");
    expect(Bun.spawnSync(["bash", script, "read", "wt/none"], { env, cwd }).exitCode).toBe(1);
    expect(Bun.spawnSync(["bash", script, "counts"], { env, cwd }).stdout.toString()).toContain("1 queued");
    expect(Bun.spawnSync(["bash", script, "bogus"], { env, cwd }).exitCode).toBe(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
