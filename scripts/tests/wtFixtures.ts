import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export function createWtFixtures() {

const scratch = mkdtempSync(join(tmpdir(), "maipai-wt-test-"));
const repoRoot = join(import.meta.dir, "..");
// The logic is the shared getmaipai/.github script; this repo's scripts/wt.sh is a thin wrapper, so the
// lifecycle is exercised against the shared file in the sibling .github checkout.
const common = resolve(repoRoot, spawnSync("git", ["-C", repoRoot, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).stdout.trim());
// Same source as the wrapper: the sibling .github checkout's origin/main, never its working tree (which may be stale or mid-edit).
const sharedFromOrigin = () => {
  const dir = mkdtempSync(join(tmpdir(), "maipai-wt-shared-"));
  const std = join(common, "..", "..", ".github");
  const archive = spawnSync("bash", ["-c", `git -C '${std}' archive origin/main standards/bin | tar -x -C '${dir}'`], { encoding: "utf8" });
  if (archive.status !== 0) throw new Error(`cannot read .github origin/main:standards/bin: ${archive.stderr}`);
  return join(dir, "standards", "bin", "wt.sh");
};
const script = process.env.MAIPAI_WT_SHARED || sharedFromOrigin();
// wt.sh reads its session files with node, so a machine without node cannot run these tests; they skip with this reason.
const hasNode = spawnSync("node", ["-v"], { stdio: "ignore" }).status === 0;
const hasTmuxBin = spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
process.env.WT_T2_GLOBS ??= "backend/src/auth/* docs/design/RULES.md scripts/check.sh";
const fixture = join(scratch, "home");
const stateHome = join(scratch, "xdg-state");
const bare = join(scratch, "origin.git");
const data = join(scratch, "session-data");
const socket = `wt-test-${process.pid}-${Date.now()}`;
const fixtureEnv = (env: Record<string, string> = {}) => ({ ...process.env, MAIPAI_WT_DATA: data, MAIPAI_WT_TMUX_SOCKET: socket, XDG_STATE_HOME: stateHome,
  GATE_HEAVY_SLOTS: "16", GATE_HEAVY_MAX_LOAD: "100000", GATE_HEAVY_MIN_FREE_PCT: "0", GATE_HEAVY_MAX_WAIT_SECONDS: "30", ...env });
const run = (args: string[], env: Record<string, string> = {}) => spawnSync("bash", [script, ...args], {
  cwd: fixture,
  encoding: "utf8",
  env: fixtureEnv(env),
});

const setup = () => {
  mkdirSync(fixture, { recursive: true });
  spawnSync("git", ["init", "--bare", bare], { stdio: "inherit" });
  spawnSync("git", ["init", "-b", "main", fixture], { stdio: "inherit" });
  spawnSync("git", ["-C", fixture, "config", "user.name", "Test User"]);
  spawnSync("git", ["-C", fixture, "config", "user.email", "test@example.invalid"]);
  writeFileSync(join(fixture, "README.md"), "fixture\n");
  mkdirSync(join(fixture, "scripts"), { recursive: true });
  writeFileSync(join(fixture, "scripts", "check.sh"), "#!/usr/bin/env bash\necho '== scope: fixture'\n");
  spawnSync("git", ["-C", fixture, "add", "."]);
  spawnSync("git", ["-C", fixture, "commit", "-m", "initial"]);
  spawnSync("git", ["-C", fixture, "remote", "add", "origin", bare]);
  spawnSync("git", ["-C", fixture, "push", "-u", "origin", "main"]);
};

const cleanup = () => {
  spawnSync("tmux", ["-L", socket, "kill-server"], { stdio: "ignore" });
  rmSync(scratch, { recursive: true, force: true });
};


  return { scratch, repoRoot, common, script, hasNode, hasTmuxBin, fixture, bare, data, socket, run, fixtureEnv, setup, cleanup };
}
