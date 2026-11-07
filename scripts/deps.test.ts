import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// DEPS-SELFHEAL-01 (2026-11-02): the lander's own checkout must make the pinned commons tag worktrees itself, and a failed install that
// leaves a dangling node_modules/@maipai link must not make the retry fail too.
const lib = join(import.meta.dir, "lib", "deps.sh");
let root = "";
let fakeBin = "";

function git(dir: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
}

// A fresh layout per test: <case>/commons (git repo, optional tag, stub ensure-tag.sh), <case>/home/backend (package.json), a fake bun.
function layout(name: string, opts: { tag?: boolean } = {}) {
  const base = join(root, name);
  const commons = join(base, "commons");
  const backend = join(base, "home", "backend");
  mkdirSync(join(commons, "scripts"), { recursive: true });
  mkdirSync(backend, { recursive: true });
  git(commons, "init", "-q");
  writeFileSync(join(commons, "README"), "x");
  git(commons, "add", "README");
  git(commons, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init");
  if (opts.tag !== false) git(commons, "tag", "spec-v0.1.298");
  writeFileSync(
    join(commons, "scripts", "ensure-tag.sh"),
    `#!/usr/bin/env bash\necho "$1 $2" >> "${base}/ensure.log"\nmkdir -p "$(dirname "$0")/../../commons-tags/$1-$2/$1"\n`,
  );
  writeFileSync(join(backend, "package.json"), JSON.stringify({ name: "b", dependencies: { "@maipai/spec": "file:../../commons-tags/spec-spec-v0.1.298/spec" } }));
  return { base, commons, backend, tagDir: join(base, "commons-tags", "spec-spec-v0.1.298") };
}

function sh(script: string, extraEnv: Record<string, string> = {}) {
  const r = Bun.spawnSync(["bash", "-c", `source ${JSON.stringify(lib)}\n${script}`], {
    env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}`, HOME: root, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { status: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "deps-")));
  fakeBin = join(root, "bin");
  mkdirSync(fakeBin);
  // Fake bun: FAKE_BUN_MODE=needs-tag fails unless the tag folder exists; =dangle leaves a dangling @maipai link on the first call only.
  writeFileSync(
    join(fakeBin, "bun"),
    `#!/usr/bin/env bash
echo "bun $* in $PWD" >> "$FAKE_BUN_LOG"
case "$FAKE_BUN_MODE" in
  needs-tag) [[ -d "$FAKE_BUN_TAGDIR" ]] || { echo "error: file:../../commons-tags missing" >&2; exit 1; } ;;
  dangle)
    if [[ -d node_modules/@maipai/ok ]]; then exit 0; fi
    n=$(grep -c . "$FAKE_BUN_LOG")
    if (( n == 1 )); then mkdir -p node_modules/@maipai; ln -s ../../../node_modules/.bun/missing node_modules/@maipai/spec; exit 0; fi
    mkdir -p node_modules/@maipai/ok ;;
esac
exit 0
`,
  );
  chmodSync(join(fakeBin, "bun"), 0o755);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("ensure_pinned_tags and install_deps", () => {
  test("a missing per-tag worktree is created from package.json before the install runs", () => {
    const l = layout("create");
    const log = join(l.base, "bun.log");
    expect(existsSync(l.tagDir)).toBe(false);
    const r = sh(`install_deps ${l.backend} --force`, { FAKE_BUN_MODE: "needs-tag", FAKE_BUN_TAGDIR: l.tagDir, FAKE_BUN_LOG: log });
    expect(r.status).toBe(0);
    expect(readFileSync(join(l.base, "ensure.log"), "utf8").trim()).toBe("spec spec-v0.1.298");
    expect(existsSync(l.tagDir)).toBe(true);
    expect(readFileSync(log, "utf8")).toContain("bun install --frozen-lockfile --force");
  });

  test("a dangling node_modules/@maipai link after an install deletes node_modules and uses the second attempt", () => {
    const l = layout("dangle");
    mkdirSync(l.tagDir, { recursive: true });
    mkdirSync(join(l.backend, "node_modules", "keep"), { recursive: true });
    const log = join(l.base, "bun.log");
    const r = sh(`install_deps ${l.backend}`, { FAKE_BUN_MODE: "dangle", FAKE_BUN_LOG: log, FAKE_BUN_TAGDIR: l.tagDir });
    expect(r.status).toBe(0);
    expect(r.err).toContain("dangling");
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(2);
    expect(existsSync(join(l.backend, "node_modules", "keep"))).toBe(false); // the old node_modules was deleted
    expect(existsSync(join(l.backend, "node_modules", "@maipai", "ok"))).toBe(true);
    expect(existsSync(join(l.base, "home", "unrelated"))).toBe(false);
  });

  test("a tag that does not exist after the fetch gives one plain message naming it and the command, and a non-zero status", () => {
    const l = layout("missing", { tag: false });
    const log = join(l.base, "bun.log");
    const r = sh(`install_deps ${l.backend}; rc=$?; echo "ERR=$DEPS_ERROR"; exit $rc`, { FAKE_BUN_MODE: "needs-tag", FAKE_BUN_LOG: log, FAKE_BUN_TAGDIR: l.tagDir });
    expect(r.status).not.toBe(0);
    const line = r.out.split("\n").find((x) => x.startsWith("ERR="))!;
    expect(line).toContain("spec-v0.1.298");
    expect(line).toContain("ensure-tag.sh spec spec-v0.1.298");
    expect(line.split("\n")).toHaveLength(1);
    expect(existsSync(log)).toBe(false); // bun never ran
  });
});

describe("INSTALL-STAMP-01: node_modules records what it was installed from", () => {
  const stampFile = (l: { backend: string }) => join(l.backend, "node_modules", ".maipai-install-stamp");
  const env = (l: { base: string; tagDir: string }) => ({ FAKE_BUN_MODE: "", FAKE_BUN_LOG: join(l.base, "bun.log"), FAKE_BUN_TAGDIR: l.tagDir });
  const installs = (l: { base: string }) => (existsSync(join(l.base, "bun.log")) ? readFileSync(join(l.base, "bun.log"), "utf8").trim().split("\n").length : 0);

  test("deps_ensure installs with --force when there is no stamp, writes one, and skips while it matches", () => {
    const l = layout("stamp-skip");
    mkdirSync(l.tagDir, { recursive: true });
    mkdirSync(join(l.backend, "node_modules"), { recursive: true });
    expect(sh(`deps_ensure ${l.backend}`, env(l)).status).toBe(0);
    expect(installs(l)).toBe(1);
    expect(readFileSync(join(l.base, "bun.log"), "utf8")).toContain("--frozen-lockfile --force");
    expect(readFileSync(stampFile(l), "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(sh(`deps_ensure ${l.backend}`, env(l)).status).toBe(0);
    expect(installs(l)).toBe(1);
  });

  test("a changed package.json or bun.lock, a corrupted stamp and a deleted node_modules each install again", () => {
    const l = layout("stamp-redo");
    mkdirSync(l.tagDir, { recursive: true });
    mkdirSync(join(l.backend, "node_modules"), { recursive: true });
    sh(`deps_ensure ${l.backend}`, env(l));
    expect(installs(l)).toBe(1);
    writeFileSync(join(l.backend, "bun.lock"), "lock v2\n");
    sh(`deps_ensure ${l.backend}`, env(l));
    expect(installs(l)).toBe(2);
    writeFileSync(stampFile(l), "corrupted\n");
    sh(`deps_ensure ${l.backend}`, env(l));
    expect(installs(l)).toBe(3);
    rmSync(join(l.backend, "node_modules"), { recursive: true });
    mkdirSync(join(l.backend, "node_modules"), { recursive: true });
    sh(`deps_ensure ${l.backend}`, env(l));
    expect(installs(l)).toBe(4);
  });

  test("AUDIT-GATE-01: the workspace root package.json and bun.lock are part of the stamp", () => {
    const l = layout("stamp-root");
    mkdirSync(l.tagDir, { recursive: true });
    mkdirSync(join(l.backend, "node_modules"), { recursive: true });
    const home = join(l.base, "home");
    writeFileSync(join(home, "package.json"), JSON.stringify({ name: "home", workspaces: ["backend"], overrides: { zod: "4.0.0" } }));
    writeFileSync(join(home, "bun.lock"), "root lock v1\n");
    sh(`deps_ensure ${l.backend}`, env(l));
    expect(installs(l)).toBe(1);
    writeFileSync(join(home, "bun.lock"), "root lock v2\n");
    sh(`deps_ensure ${l.backend}`, env(l));
    expect(installs(l)).toBe(2);
    writeFileSync(join(home, "package.json"), JSON.stringify({ name: "home", workspaces: ["backend"], overrides: { zod: "4.1.0" } }));
    sh(`deps_ensure ${l.backend}`, env(l));
    expect(installs(l)).toBe(3);
    sh(`deps_ensure ${l.backend}`, env(l));
    expect(installs(l)).toBe(3);
  });

  test("a failed install leaves no stamp, so the next call installs again", () => {
    const l = layout("stamp-fail", { tag: false });
    mkdirSync(join(l.backend, "node_modules"), { recursive: true });
    writeFileSync(stampFile(l), "stale\n");
    const r = sh(`deps_current ${l.backend}; echo "current=$?"; install_deps ${l.backend} --force; echo "rc=$?"; [[ -e ${stampFile(l)} ]] && echo stamped || echo unstamped`, { ...env(l), FAKE_BUN_MODE: "needs-tag" });
    expect(r.out).toContain("current=1");
    expect(r.out).toContain("rc=1");
    expect(r.out).toContain("unstamped");
  });
});

describe("the settings generator never writes the shared commons checkout", () => {
  test("with MAIPAI_COMMONS_DIR unset it writes to a private temp directory", () => {
    const tmp = join(root, "gen-tmp");
    mkdirSync(tmp);
    const genEnv: Record<string, string | undefined> = { ...process.env, TMPDIR: tmp };
    delete genEnv.MAIPAI_COMMONS_DIR;
    const r = Bun.spawnSync(["bun", "run", "scripts/gen-settings-registry.ts"], {
      cwd: join(import.meta.dir, "..", "backend"),
      env: genEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(r.exitCode).toBe(0);
    const out = r.stdout.toString();
    expect(out).toContain(tmp);
    expect(out).not.toContain("/commons/spec/settings/keys.json");
  });
});
