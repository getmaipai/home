import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK_LIBRARY = join(import.meta.dir, "worktreeLock.sh");

function initializeRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  const result = Bun.spawnSync(["git", "init", "-q", path]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

test("worktree lock refuses a second check, lets nested preflight inherit, and scopes to the worktree", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "maipai-worktree-lock-"));
  const firstRepo = join(scratch, "first");
  const otherRepo = join(scratch, "other");
  const releasePath = join(scratch, "release");
  initializeRepo(firstRepo);
  initializeRepo(otherRepo);
  const holder = Bun.spawn(["bash", "-c", `
    source "$LOCK_LIBRARY"
    acquire_worktree_lock || exit 1
    bash -c 'source "$LOCK_LIBRARY"; acquire_worktree_lock && echo nested-preflight-shared-lock'
    # The machine-wide gate-lock.sh wraps the child --pre and uses descriptors 7, 8 and 9 (closing them on unlock).
    bash -c 'exec 7>&- 8>&- 9>&-; source "$LOCK_LIBRARY"; acquire_worktree_lock && echo nested-after-wrapper-closed-7-8-9'
    echo holder-ready
    while [ ! -e "$RELEASE_PATH" ]; do sleep 0.02; done
  `], {
    cwd: firstRepo,
    env: { ...process.env, LOCK_LIBRARY, RELEASE_PATH: releasePath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutReader = holder.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  try {
    while (!output.includes("holder-ready")) {
      const result = await stdoutReader.read();
      if (result.done) throw new Error(`holder exited before locking: ${output}`);
      output += decoder.decode(result.value, { stream: true });
    }
    expect(output).toContain("nested-preflight-shared-lock");
    expect(output).toContain("nested-after-wrapper-closed-7-8-9");

    const duplicate = Bun.spawnSync(["bash", "-c", `source "$LOCK_LIBRARY"; acquire_worktree_lock`], {
      cwd: firstRepo,
      env: { ...process.env, LOCK_LIBRARY },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(duplicate.exitCode).toBe(1);
    expect(duplicate.stderr.toString()).toContain(`another check is already running in ${realpathSync(firstRepo)}`);

    const separate = Bun.spawnSync(["bash", "-c", `source "$LOCK_LIBRARY"; acquire_worktree_lock`], {
      cwd: otherRepo,
      env: { ...process.env, LOCK_LIBRARY },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(separate.exitCode).toBe(0);
  } finally {
    writeFileSync(releasePath, "done");
    expect(await holder.exited).toBe(0);
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("LOCK-LANDING-01: MAIPAI_WORKTREE_LOCK=off lets a landing check run while a stray holder keeps the lock, and a refusal names the holder", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "maipai-worktree-lock-off-"));
  const repo = join(scratch, "repo");
  const releasePath = join(scratch, "release");
  initializeRepo(repo);
  const holder = Bun.spawn(["bash", "-c", `
    source "$LOCK_LIBRARY"
    acquire_worktree_lock >/dev/null || exit 1
    echo holder-ready
    while [ ! -e "$RELEASE_PATH" ]; do sleep 0.02; done
  `], { cwd: repo, env: { ...process.env, LOCK_LIBRARY, RELEASE_PATH: releasePath }, stdout: "pipe", stderr: "pipe" });
  const reader = holder.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  try {
    while (!output.includes("holder-ready")) {
      const result = await reader.read();
      if (result.done) throw new Error(`holder exited before locking: ${output}`);
      output += decoder.decode(result.value, { stream: true });
    }
    const env = { ...process.env, LOCK_LIBRARY };
    delete (env as Record<string, string | undefined>).MAIPAI_WORKTREE_LOCK;
    const refused = Bun.spawnSync(["bash", "-c", `source "$LOCK_LIBRARY"; acquire_worktree_lock`], { cwd: repo, env, stdout: "pipe", stderr: "pipe" });
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr.toString()).toContain("another check is already running");
    const skipped = Bun.spawnSync(["bash", "-c", `source "$LOCK_LIBRARY"; acquire_worktree_lock`], { cwd: repo, env: { ...env, MAIPAI_WORKTREE_LOCK: "off" }, stdout: "pipe", stderr: "pipe" });
    expect(skipped.exitCode).toBe(0);
    expect(skipped.stdout.toString()).toContain("skipped");
  } finally {
    writeFileSync(releasePath, "done");
    expect(await holder.exited).toBe(0);
    rmSync(scratch, { recursive: true, force: true });
  }
});
