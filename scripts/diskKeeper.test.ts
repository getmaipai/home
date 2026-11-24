import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sh = (cwd: string, cmd: string) => Bun.spawnSync(["bash", "-c", cmd], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
const out = (r: ReturnType<typeof sh>) => r.stdout.toString() + r.stderr.toString();

// A throwaway origin, a clone ("home") and five worktrees in every state the cleaner must tell apart. Everything lives under tmpdir.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "diskkeeper-"));
  const org = join(root, "org"); mkdirSync(org);
  const origin = join(root, "origin.git");
  const home = join(org, "home");
  sh(root, `git init -q --bare -b main ${origin} && git clone -q ${origin} ${home}`);
  sh(home, `git checkout -q -b main 2>/dev/null; echo a > a && git add a && git commit -qm base && git push -q origin main`);
  const wt = (name: string, setup: string) => { sh(home, `git worktree add -q ${org}/wt-${name} -b ${name} && cd ${org}/wt-${name} && ${setup}`); return join(org, `wt-${name}`); };
  const p = {
    merged: wt("merged", `echo m > m && git add m && git commit -qm m && cd ${home} && git merge -q --ff-only merged && git push -q origin main`),
    squashed: wt("squashed", `echo s > s && git add s && git commit -qm s && git push -q origin squashed && cd ${home} && git checkout -q -b tmp && git cherry-pick -n squashed && git commit -qm squash && git checkout -q main && git merge -q --ff-only tmp && git push -q origin main`),
    pushed: wt("pushed", `echo p > p && git add p && git commit -qm p && git push -q origin pushed`),
    unpushed: wt("unpushed", `echo u > u && git add u && git commit -qm u`),
    dirty: wt("dirty", `echo d > d`),
  };
  const env = `MAIPAI_DISK_ORG=${org} MAIPAI_DISK_HOME=${root}/nohome MAIPAI_DISK_REPOS=${home} MAIPAI_DISK_LOG=${root}/log.tsv MAIPAI_DISK_ACTIVE_SECS=0 MAIPAI_DISK_KEEP=`;
  return { root, org, home, p, env, script: join(import.meta.dir, "disk-keeper.sh") };
}

test("worktrees: dry run lists safe ones, removes nothing, never offers dirty or unpushed", () => {
  const f = fixture();
  const r = out(sh(f.home, `${f.env} bash ${f.script} worktrees`));
  for (const k of ["merged", "squashed", "pushed"]) expect(r).toMatch(new RegExp(`would remove.*wt-${k}`));
  expect(r).not.toMatch(/would remove.*wt-(dirty|unpushed)/);
  expect(r).toMatch(/DIRTY.*wt-dirty/);
  expect(r).toMatch(/UNPUSHED.*wt-unpushed/);
  expect(r).toContain("git cherry");
  for (const k of Object.values(f.p)) expect(existsSync(k)).toBe(true);
  expect(existsSync(join(f.root, "log.tsv"))).toBe(false);
});

test("worktrees --apply removes only the safe ones and logs each removal; keep globs protect", () => {
  const f = fixture();
  sh(f.home, `${f.env.replace("MAIPAI_DISK_KEEP=", "MAIPAI_DISK_KEEP='*wt-pushed'")} bash ${f.script} worktrees --apply`);
  expect(existsSync(f.p.merged)).toBe(false);
  expect(existsSync(f.p.squashed)).toBe(false);
  expect(existsSync(f.p.pushed)).toBe(true);
  expect(existsSync(f.p.dirty)).toBe(true);
  expect(existsSync(f.p.unpushed)).toBe(true);
  const log = readFileSync(join(f.root, "log.tsv"), "utf8");
  expect(log).toContain("wt-merged");
  expect(log).toContain("wt-squashed");
  expect(log).not.toContain("wt-dirty");
});

test("weights: assigned models are never proposed; a finished experiment's unassigned weight goes only with --apply", () => {
  const f = fixture();
  const scratch = join(f.org, "home", "data-scratch");
  const assigned = join(scratch, "exp", "keepme-model.gguf");
  const junk = join(scratch, "exp", "junk-weights.safetensors");
  mkdirSync(join(scratch, "exp"), { recursive: true });
  for (const x of [assigned, junk]) sh(f.root, `dd if=/dev/zero of=${x} bs=1m count=2 2>/dev/null`);
  writeFileSync(join(scratch, "exp", "RESULTS.md"), "done");
  const src = join(f.root, "tiers.ts");
  writeFileSync(src, 'export const tier = "keepme-model";');
  const env = `${f.env} MAIPAI_ASSIGNED_FILES=${src} MAIPAI_SCRATCH_WEIGHTS=${f.root}/none`;
  const dry = out(sh(f.home, `${env} bash ${f.script} weights --min-mb 1 --older-days 0`));
  expect(dry).toMatch(/assigned.*keepme-model/);
  expect(dry).toMatch(/would remove.*junk-weights/);
  expect(existsSync(junk)).toBe(true);
  sh(f.home, `${env} bash ${f.script} weights --min-mb 1 --older-days 0 --apply`);
  expect(existsSync(junk)).toBe(false);
  expect(existsSync(assigned)).toBe(true);
  expect(existsSync(join(scratch, "exp", "RESULTS.md"))).toBe(true);
  expect(readFileSync(join(f.root, "log.tsv"), "utf8")).toContain("junk-weights");
});

test("weights refuses to propose anything when no assigned-model source is readable", () => {
  const f = fixture();
  expect(sh(f.home, `${f.env} MAIPAI_ASSIGNED_FILES=/nonexistent bash ${f.script} weights`).exitCode).toBe(4);
});

test("check warns past the threshold", () => {
  const r = sh(tmpdir(), `MAIPAI_DISK_WARN_PCT=0 bash ${join(import.meta.dir, "disk-keeper.sh")} check`);
  expect(r.exitCode).toBe(3);
  expect(out(r)).toContain("DISK WARNING");
});

test("scratch guard blocks a weight download outside the scratch root and allows one inside", () => {
  const guard = join(import.meta.dir, "hooks", "scratch-weights-guard.sh");
  const run = (command: string) => Bun.spawnSync(["bash", guard], { stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { command } })), env: { ...process.env, MAIPAI_SCRATCH_WEIGHTS: "/tmp/sw-test-root" } });
  expect(run("hf download org/model --local-dir data-scratch/x").exitCode).toBe(2);
  expect(run("hf download org/model --local-dir /tmp/sw-test-root/x").exitCode).toBe(0);
  expect(run("ls -la").exitCode).toBe(0);
});
