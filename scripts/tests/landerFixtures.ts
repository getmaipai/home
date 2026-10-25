import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function createLanderFixtures() {

const scratch = mkdtempSync(join(tmpdir(), "maipai-lander-"));
const origin = join(scratch, "origin.git");
const main = join(scratch, "main");
const data = join(scratch, "land-data");
const watchData = join(scratch, "watch-data");
const pipelineBin = join(scratch, "pipeline-bin");
const warm = join(scratch, "warm-checkout");
const scriptNames = ["land.sh", "lander.sh", "pipeline.sh", "watcher.sh", "wt.sh"];
const env: Record<string, string | undefined> = {
  ...process.env,
  MAIPAI_LAND_DATA: data,
  MAIPAI_WATCH_DATA: watchData,
  MAIPAI_PIPELINE_BIN: pipelineBin,
  MAIPAI_LAND_CHECKOUT: warm,
  MAIPAI_LAND_SKIP_INSTALL: "1",
  MAIPAI_LAND_UPDATE_MAIN: "0",
  MAIPAI_LAND_GIT_ENV: "",
  MAIPAI_LAND_CHECK_CMD: "bash scripts/check.sh --pre",
  MAIPAI_LAND_GENERATE_CMD: "bash scripts/generate.sh",
};

function git(dir: string, ...args: string[]) {
  const out = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (out.status !== 0) throw new Error(`git ${args.join(" ")} failed (${out.status}): ${out.stderr}`);
  return out.stdout.trim();
}
function run(script: string, args: string[], cwd = main, raw = false) {
  const actualArgs = script === "land.sh" && !raw ? ["--queue-anyway", ...args] : args;
  return spawnSync("bash", [join(main, "scripts", script), ...actualArgs], { cwd, env, encoding: "utf8", timeout: 60_000 });
}
function makeWorktree(name: string) {
  const path = join(scratch, name);
  git(main, "worktree", "add", "-b", `wt/${name}`, path, "origin/main");
  return path;
}
function commit(worktree: string, message: string) {
  git(worktree, "add", "-A");
  git(worktree, "commit", "-m", message);
  return git(worktree, "rev-parse", "HEAD");
}
function pushScriptChange(name: string, marker: string) {
  git(main, "fetch", "origin");
  const slug = marker.replace(/[^a-z0-9-]/gi, "-");
  const worktree = join(scratch, `snapshot-${slug}`);
  git(main, "worktree", "add", "-b", `wt/snapshot-${slug}`, worktree, "origin/main");
  const path = join(worktree, "scripts", name);
  writeFileSync(path, `${readFileSync(path, "utf8")}\n# ${marker}\n`);
  git(worktree, "add", `scripts/${name}`);
  git(worktree, "commit", "-m", marker);
  git(worktree, "push", "origin", "HEAD:main");
}
function note(name: string): { branch: string; sha: string; status: string; reason: string; main_sha: string; check_tail: string; note?: string } {
  return JSON.parse(readFileSync(join(data, "notes", `wt-${name}.json`), "utf8"));
}
function queueFiles() { return readdirSync(join(data, "queue")).filter((f) => f.endsWith(".json")); }

const setup = () => {
  mkdirSync(scratch, { recursive: true });
  spawnSync("git", ["init", "--bare", "--initial-branch=main", origin], { encoding: "utf8" });
  spawnSync("git", ["clone", origin, main], { encoding: "utf8" });
  git(main, "config", "user.name", "Lander Test");
  git(main, "config", "user.email", "lander@example.test");
  mkdirSync(join(main, "scripts"), { recursive: true });
  for (const name of scriptNames) copyFileSync(join(import.meta.dir, "..", name), join(main, "scripts", name));
  writeFileSync(join(main, "scripts", "check.sh"), "#!/usr/bin/env bash\nif [[ -f RED ]]; then echo 'fake check: RED found'; exit 1; fi\necho 'fake check: clean'\n");
  writeFileSync(join(main, "scripts", "generate.sh"), "#!/usr/bin/env bash\nif [[ -f GEN ]]; then mkdir -p docs/api; git rev-parse HEAD > docs/api/openapi.json; fi\n");
  mkdirSync(join(main, "docs"), { recursive: true });
  writeFileSync(join(main, "docs", "BACKLOG.md"), "- [ ] **ALPHA-01: first** (S).\n- [ ] **BETA-02: second** (S).\n");
  mkdirSync(join(main, "data-scratch"), { recursive: true });
  writeFileSync(join(main, "file.txt"), "line one\nline two\nline three\n");
  git(main, "add", "-A");
  git(main, "commit", "-m", "fixture base");
  git(main, "push", "-u", "origin", "main");
};



function awaitQueueName() {
  return readdirSync(join(data, "queue")).find((f) => f.endsWith(".json")) ?? "missing.json";
}

  const cleanup = () => rmSync(scratch, { recursive: true, force: true });
  return { scratch, origin, main, data, watchData, pipelineBin, warm, env, git, run, makeWorktree, commit, pushScriptChange, note, queueFiles, setup, cleanup, awaitQueueName };
}
