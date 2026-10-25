import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function createWatcherFixtures() {

const roots: string[] = [];
let snapshotCount = 0;
const sourceScripts = ["watcher.sh", "pipeline.sh"];
const template = join(mkdtempSync(join(tmpdir(), "maipai-watcher-template-")), "repo");
const templateOrigin = join(template, "origin.git");
const templateMain = join(template, "main");
mkdirSync(template, { recursive: true });
spawnSync("git", ["init", "--bare", "--initial-branch=main", templateOrigin], { encoding: "utf8" });
spawnSync("git", ["clone", templateOrigin, templateMain], { encoding: "utf8" });
git(templateMain, "config", "user.name", "Watcher Test");
git(templateMain, "config", "user.email", "watcher@example.test");
mkdirSync(join(templateMain, "scripts"), { recursive: true });
for (const name of sourceScripts) copyFileSync(join(import.meta.dir, "..", name), join(templateMain, "scripts", name));
writeFileSync(join(templateMain, "scripts", "suite.sh"), "#!/usr/bin/env bash\nif [[ -f RED ]]; then echo '(fail) breaks [1ms]'; echo 'shard: failing files: backend/tests/broken.test.ts'; exit 1; fi\necho 'all green'\n");
writeFileSync(join(templateMain, "scripts", "rerun.sh"), "#!/usr/bin/env bash\nif [[ -f RED && ! -f FLAKY ]]; then exit 1; fi\nexit 0\n");
writeFileSync(join(templateMain, "base.txt"), "base\n");
git(templateMain, "add", "-A");
git(templateMain, "commit", "-m", "fixture base");
git(templateMain, "push", "-u", "origin", "main");
roots.push(join(template, ".."));

function git(dir: string, ...args: string[]) {
  const out = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (out.status !== 0) throw new Error(`git ${args.join(" ")} failed (${out.status}): ${out.stderr}`);
  return out.stdout.trim();
}

function fixture() {
  const scratch = mkdtempSync(join(tmpdir(), "maipai-watcher-"));
  roots.push(scratch);
  const origin = join(scratch, "origin.git");
  const main = join(scratch, "main");
  const data = join(scratch, "watch-data");
  const pipelineBin = join(scratch, "pipeline-bin");
  const warm = join(scratch, "home-watcher");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MAIPAI_WATCH_DATA: data,
    MAIPAI_PIPELINE_BIN: pipelineBin,
    MAIPAI_WATCH_CHECKOUT: warm,
    MAIPAI_WATCH_SKIP_INSTALL: "1",
    MAIPAI_WATCH_QUIET_MAX_SECONDS: "0",
    MAIPAI_LAND_DATA: join(scratch, "land-data"),
    MAIPAI_WATCH_LEGS: "backend frontend",
    MAIPAI_LAND_GIT_ENV: "",
    MAIPAI_WATCH_SUITE_CMD: "bash scripts/suite.sh",
    MAIPAI_WATCH_RERUN_CMD: "bash scripts/rerun.sh",
    MAIPAI_WATCH_ISSUE_CMD: `bash ${join(scratch, "issue.sh")}`,
    MAIPAI_WATCH_NO_LOCK: "1",
  };
  cpSync(templateOrigin, origin, { recursive: true });
  cpSync(templateMain, main, { recursive: true });
  git(main, "remote", "set-url", "origin", origin);
  writeFileSync(join(scratch, "issue.sh"), `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> '${join(scratch, "issue.calls")}'\n`);
  return { scratch, origin, main, data, warm, pipelineBin, env };
}

function pushScriptChange(f: ReturnType<typeof fixture>, marker: string) {
  git(f.main, "fetch", "origin");
  const id = ++snapshotCount;
  const worktree = join(f.scratch, `snapshot-${id}`);
  git(f.main, "worktree", "add", "-b", `wt/snapshot-${id}`, worktree, "origin/main");
  const path = join(worktree, "scripts/watcher.sh");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n# ${marker}\n`);
  git(worktree, "add", "scripts/watcher.sh");
  git(worktree, "commit", "-m", marker);
  git(worktree, "push", "origin", "HEAD:main");
}

function commit(f: ReturnType<typeof fixture>, message: string, files: Record<string, string>) {
  for (const [name, value] of Object.entries(files)) writeFileSync(join(f.main, name), value);
  git(f.main, "add", "-A");
  git(f.main, "commit", "-m", message);
  const sha = git(f.main, "rev-parse", "HEAD");
  git(f.main, "push", "origin", "main");
  return sha;
}

function run(f: ReturnType<typeof fixture>, script: string, args: string[] = [], env: NodeJS.ProcessEnv = f.env) {
  return spawnSync("bash", [join(f.main, "scripts", script), ...args], {
    cwd: f.main,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
}

function records(f: ReturnType<typeof fixture>) {
  return readFileSync(join(f.data, "runs.jsonl"), "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
}


  return { roots, git, fixture, pushScriptChange, commit, run, records };
}
