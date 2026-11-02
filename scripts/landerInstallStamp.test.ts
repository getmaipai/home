import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/landerFixtures";
const { scratch, warm, env, git, run, makeWorktree, commit, note, setup, cleanup } = fixtures.createLanderFixtures();

// INSTALL-STAMP-01 (2026-11-02): the lander installs in its warm checkout when node_modules was not installed from the package.json and
// bun.lock in the tree being checked, not when HEAD history shows a package file moved. A bounced landing leaves the warm checkout's HEAD on
// the failed branch tip, so the old diff saw nothing on the retry and the static check kept running against the old packages.
const calls = join(scratch, "bun-calls");
const stampName = ".maipai-install-stamp";
let prior: Record<string, string | undefined> = {};

beforeAll(() => {
  setup();
  const bin = join(scratch, "stub-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "bun"), `#!/bin/bash\necho "$PWD: $*" >> "${calls}"\nmkdir -p node_modules\n`, { mode: 0o755 });
  prior = { path: env.PATH, skip: env.MAIPAI_LAND_SKIP_INSTALL };
  env.PATH = `${bin}:${process.env.PATH}`;
  delete env.MAIPAI_LAND_SKIP_INSTALL;
}, 60_000);
afterAll(() => {
  env.PATH = prior.path;
  env.MAIPAI_LAND_SKIP_INSTALL = prior.skip;
  cleanup();
});

const warmBackend = () => join(warm, "backend");
const backendInstalls = () => (existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter((l) => l.startsWith(`${warmBackend()}: `)) : []);

function land(name: string) {
  const wt = join(scratch, name);
  expect(run("land.sh", ["--detach"], wt).status).toBe(0);
  expect(run("lander.sh", ["run-once"]).status).toBe(0);
}

describe("warm checkout install stamp", () => {
  test("a bounced landing followed by a retry of the same branch installs, then a matching stamp skips", () => {
    // Base: backend/package.json v1 lands and is installed.
    const base = makeWorktree("stamp_base");
    mkdirSync(join(base, "backend"), { recursive: true });
    writeFileSync(join(base, "backend", "package.json"), '{"name":"b","version":"1"}\n');
    commit(base, "backend v1");
    land("stamp_base");
    expect(note("stamp_base").status).toBe("landed");
    expect(backendInstalls()).toHaveLength(1);
    const stamp = join(warmBackend(), "node_modules", stampName);
    expect(readFileSync(stamp, "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);

    // A branch bumps the package file and conflicts with main: it bounces at the rebase, leaving the warm HEAD on its tip.
    const bump = makeWorktree("stamp_bump");
    const other = makeWorktree("stamp_other");
    writeFileSync(join(other, "file.txt"), "other first line\nline two\nline three\n");
    commit(other, "other change");
    land("stamp_other");
    writeFileSync(join(bump, "backend", "package.json"), '{"name":"b","version":"2"}\n');
    writeFileSync(join(bump, "file.txt"), "bump first line\nline two\nline three\n");
    commit(bump, "bump pin");
    land("stamp_bump");
    expect(note("stamp_bump").status).toBe("bounced");
    expect(note("stamp_bump").reason).toContain("rebase conflict");
    expect(backendInstalls()).toHaveLength(1); // the bounce came before any install

    // The session rebases and lands again: the package diff between the warm HEAD and the rebased sha is empty, but node_modules is still v1.
    git(bump, "fetch", "origin");
    git(bump, "reset", "--hard", "-q", "origin/main");
    writeFileSync(join(bump, "backend", "package.json"), '{"name":"b","version":"2"}\n');
    commit(bump, "bump pin again");
    land("stamp_bump");
    expect(note("stamp_bump").status).toBe("landed");
    expect(backendInstalls()).toHaveLength(2);
    expect(backendInstalls()[1]).toContain("install --frozen-lockfile --force");

    // A landing that changes no package file runs no install.
    const doc = makeWorktree("stamp_doc");
    writeFileSync(join(doc, "docs", "note.md"), "doc\n");
    commit(doc, "doc only");
    land("stamp_doc");
    expect(note("stamp_doc").status).toBe("landed");
    expect(backendInstalls()).toHaveLength(2);
  }, 120_000);

  test("a stamp that does not match, and a missing stamp, each install again", () => {
    const stamp = join(warmBackend(), "node_modules", stampName);
    const before = backendInstalls().length;
    writeFileSync(stamp, "corrupted\n");
    const a = makeWorktree("stamp_corrupt");
    writeFileSync(join(a, "docs", "a.md"), "a\n");
    commit(a, "doc a");
    land("stamp_corrupt");
    expect(note("stamp_corrupt").status).toBe("landed");
    expect(backendInstalls()).toHaveLength(before + 1);
    expect(readFileSync(stamp, "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);

    rmSync(stamp);
    const b = makeWorktree("stamp_missing");
    writeFileSync(join(b, "docs", "b.md"), "b\n");
    commit(b, "doc b");
    land("stamp_missing");
    expect(note("stamp_missing").status).toBe("landed");
    expect(backendInstalls()).toHaveLength(before + 2);
    expect(existsSync(stamp)).toBe(true);
  }, 120_000);
});
