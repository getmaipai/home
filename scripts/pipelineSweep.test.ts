import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "pipeline.sh");

test("pipeline.sh sweep removes only the landed, clean, idle worktree", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pipeline-sweep-")));
  let sleeper: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", MAIPAI_LAND_GIT_ENV: "" };
    const sh = (cwd: string, ...args: string[]) => {
      const r = Bun.spawnSync(args, { cwd, env });
      if (r.exitCode !== 0) throw new Error(`${args.join(" ")}: ${r.stderr.toString()}`);
      return r.stdout.toString().trim();
    };
    const origin = join(dir, "origin.git"), main = join(dir, "home");
    sh(dir, "git", "init", "-q", "--bare", "-b", "main", origin);
    sh(dir, "git", "clone", "-q", origin, main);
    sh(main, "git", "checkout", "-q", "-B", "main");
    writeFileSync(join(main, "a.txt"), "a\n");
    sh(main, "git", "add", "a.txt");
    sh(main, "git", "commit", "-q", "-m", "init");
    sh(main, "git", "push", "-q", "origin", "main");
    const sessions = join(main, "data-scratch", "sessions");
    mkdirSync(sessions, { recursive: true });
    const names = ["landed", "dirty", "unlanded", "busy", "fresh"];
    const paths: Record<string, string> = { fresh: "", landed: "", dirty: "", unlanded: "", busy: "" };
    for (const n of names) {
      const p = join(dir, `wt-${n}`);
      paths[n] = p;
      sh(main, "git", "worktree", "add", "-q", "-b", `wt/${n}`, p, "main");
      if (n === "unlanded") {
        writeFileSync(join(p, "new.txt"), "x\n");
        sh(p, "git", "add", "new.txt");
        sh(p, "git", "commit", "-q", "-m", "unlanded work");
      }
      if (n === "dirty") writeFileSync(join(p, "scratch.txt"), "x\n");
      if (n !== "fresh" && n !== "unlanded") {
        mkdirSync(join(dir, "land", "notes"), { recursive: true });
        writeFileSync(join(dir, "land", "notes", `wt-${n}.json`), JSON.stringify({ branch: `wt/${n}`, status: "landed" }));
      }
      writeFileSync(join(sessions, `${n}.json`), JSON.stringify({ path: p, branch: `wt/${n}`, pid: 1 }));
      writeFileSync(join(sessions, `${n}.beat`), "");
      sh(dir, "find", p, "-exec", "touch", "-t", "202001010000", "{}", "+");
    }
    sleeper = Bun.spawn(["sleep", "30"], { cwd: paths.busy! });
    const run = (...args: string[]) => Bun.spawnSync(["bash", script, "sweep", ...args], { cwd: main, env: { ...env, MAIPAI_LAND_DATA: join(dir, "land"), MAIPAI_WATCH_DATA: join(dir, "watch") } });

    const dry = run("--dry-run");
    expect(dry.stdout.toString()).toContain("would remove landed");
    expect(existsSync(paths.landed!)).toBe(true);

    const real = run();
    expect(real.exitCode).toBe(0);
    expect(existsSync(paths.landed!)).toBe(false);
    expect(existsSync(join(sessions, "landed.json"))).toBe(false);
    expect(existsSync(join(sessions, "landed.beat"))).toBe(false);
    expect(sh(main, "git", "branch", "--list", "wt/landed")).toBe("");
    for (const n of ["dirty", "unlanded", "busy", "fresh"]) {
      expect(existsSync(paths[n]!)).toBe(true);
      expect(existsSync(join(sessions, `${n}.json`))).toBe(true);
    }
    const reaped = readFileSync(join(main, "data-scratch", "reaped.md"), "utf8");
    expect(reaped).toContain("| dirty |");
    expect(reaped).toContain("| unlanded |");
    expect(reaped).toContain("| busy |");
    expect(reaped).toContain("| fresh |");
    expect(reaped).toContain("kept: no landing record");
  } finally {
    sleeper?.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
