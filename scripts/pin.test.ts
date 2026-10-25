import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const scratch = mkdtempSync(join(tmpdir(), "maipai-pin-"));
const sourceScript = join(import.meta.dir, "pin.sh");
const fixedSha = "a".repeat(64);
let fixture: ReturnType<typeof createFixture>;

function command(cmd: string, args: string[], cwd?: string, env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 60_000 });
}
function git(dir: string, ...args: string[]) {
  const out = command("git", ["-C", dir, ...args]);
  if (out.status !== 0) throw new Error(`git ${args.join(" ")} failed (${out.status}): ${out.stderr}`);
  return out.stdout.trim();
}
function createFixture() {
  const base = mkdtempSync(join(scratch, "case-"));
  const origin = join(base, "origin.git");
  const repo = join(base, "home");
  command("git", ["init", "--bare", "--initial-branch=main", origin]);
  command("git", ["clone", origin, repo]);
  git(repo, "config", "user.name", "Pin Test");
  git(repo, "config", "user.email", "pin@example.test");
  git(repo, "checkout", "-b", "wt/pins");
  const files: Record<string, string> = {
    "backend/package.json": '{\n  "dependencies": {\n    "@maipai/ui": "file:../../commons-tags/ui-ui-v1.0.0/ui"\n  }\n}\n',
    "frontend/package.json": '{\n  "dependencies": {\n    "@maipai/ui": "file:../../commons-tags/ui-ui-v1.0.0/ui"\n  }\n}\n',
    "scripts/check.sh": '  CORE_TAG="core-v0.1.5"\n  UI_TAG="ui-v1.0.0"\n  SPEC_TAG="spec-v0.1.226"\n',
    "scripts/install.sh": 'STACK_TAG="1111111111111111111111111111111111111111"\nearlier() {\n  case "$1" in\n    x) echo x ;;\n    *) echo other ;;\n  esac\n}\ncommons_archive_sha256() {\n  case "$1" in\n    ui-v1.0.0) printf \'%s\\n\' "old" ;;\n    *) return 1 ;;\n  esac\n}\n',
    "scripts/engine-computer/maipai-engine": 'STACK_TAG=1111111111111111111111111111111111111111\ncommons_archive_sha256() {\n  case "$1" in\n    ui-v1.0.0) printf \'%s\\n\' "old" ;;\n    *) return 1 ;;\n  esac\n}\n',
    "shared/diskPlan.json": '{\n  "old": true\n}\n',
    "backend/src/lib/botReleasePin.json": JSON.stringify({
      _note: "A Home release bumps this pin.", version: "1.0.0", repo: "getmaipai/bot",
      assets: {
        darwin: { name: "bot-darwin.tar.gz", sha256: "0".repeat(64), size: 1 },
        linux: { name: "bot-linux.tar.gz", sha256: "1".repeat(64), size: 2 },
      },
    }, null, 2) + "\n",
  };
  for (const [path, contents] of Object.entries(files)) {
    const full = join(repo, path); mkdirSync(join(full, ".."), { recursive: true }); writeFileSync(full, contents);
  }
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "scripts/pin.sh"), readFileSync(sourceScript));
  const calls = join(base, "calls.log");
  const stack = join(base, "stack");
  mkdirSync(join(stack, "docs"), { recursive: true });
  command("git", ["init", stack]);
  git(stack, "config", "user.name", "Stack Test"); git(stack, "config", "user.email", "stack@example.test");
  writeFileSync(join(stack, "docs/disk-plan.json"), '{\n  "from": "fake-stack"\n}\n');
  git(stack, "add", "docs/disk-plan.json"); git(stack, "commit", "-m", "fixture stack");
  git(repo, "add", "-A"); git(repo, "commit", "-m", "fixture base");
  return { base, origin, repo, calls, stack, env: {
    ...process.env,
    MAIPAI_PIN_SHA256_CMD: `printf '${fixedSha}'`,
    MAIPAI_PIN_ENSURE_TAG_CMD: `printf 'ensure:%s:%s\\n' "$1" "$2" >> "$CALLS"`,
    MAIPAI_PIN_INSTALL_CMD: `printf 'install:%s\\n' "$PWD" >> "$CALLS"`,
    MAIPAI_PIN_STACK_DIR: stack,
    MAIPAI_PIN_GH_CMD: `cat "$GH_JSON"`,
    MAIPAI_PIN_LAND_CMD: `printf 'land\\n' >> "$CALLS"`,
    CALLS: calls,
    GH_JSON: join(base, "release.json"),
  } as NodeJS.ProcessEnv };
}
function run(...args: string[]) { return command("bash", [join(fixture.repo, "scripts/pin.sh"), ...args], fixture.repo, fixture.env); }
function gitRepo(...args: string[]) { return git(fixture.repo, ...args); }
function commits() { return Number(gitRepo("rev-list", "--count", "HEAD")); }
function read(path: string) { return readFileSync(join(fixture.repo, path), "utf8"); }

beforeEach(() => { fixture = createFixture(); }, 60_000);

describe.serial("pin.sh", () => {
  test("commons updates manifests and digests, installs, commits and lands", () => {
    const out = run("commons", "ui-v9.9.9");
    if (out.status !== 0) console.error(out.stderr);
    expect(out.status).toBe(0);
    for (const path of ["backend/package.json", "frontend/package.json"]) expect(read(path)).toContain("ui-ui-v9.9.9/ui");
    for (const path of ["scripts/install.sh", "scripts/engine-computer/maipai-engine"]) {
      expect(read(path)).toContain(`ui-v9.9.9) printf '%s\\n' "${fixedSha}" ;;`);
    }
    expect(read("scripts/check.sh")).toContain('  UI_TAG="ui-v9.9.9"');
    expect(read("scripts/check.sh")).toContain('SPEC_TAG="spec-v0.1.226"');
    const install = read("scripts/install.sh");
    expect(install.indexOf("ui-v9.9.9)")).toBeGreaterThan(install.indexOf("commons_archive_sha256()"));
    expect(readFileSync(fixture.calls, "utf8")).toContain("ensure:ui:ui-v9.9.9");
    expect(readFileSync(fixture.calls, "utf8").match(/install:/g)).toHaveLength(2);
    expect(gitRepo("log", "-1", "--format=%s")).toBe("Pin ui-v9.9.9");
    expect(readFileSync(fixture.calls, "utf8")).toContain("land");
  }, 60_000);

  test("the default ensure-tag command receives the package and tag", () => {
    mkdirSync(join(fixture.base, "commons/scripts"), { recursive: true });
    writeFileSync(join(fixture.base, "commons/scripts/ensure-tag.sh"), 'echo "args:$#:$1:$2" >> "$CALLS"\n');
    const env = { ...fixture.env }; delete env.MAIPAI_PIN_ENSURE_TAG_CMD;
    const out = command("bash", [join(fixture.repo, "scripts/pin.sh"), "commons", "ui-v9.9.9", "--no-land"], fixture.repo, env);
    expect(out.status).toBe(0);
    expect(readFileSync(fixture.calls, "utf8")).toContain("args:2:ui:ui-v9.9.9");
  }, 60_000);

  test("commons repeat is refused without another commit", () => {
    expect(run("commons", "ui-v9.9.9").status).toBe(0);
    const count = commits();
    const out = run("commons", "ui-v9.9.9");
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("already pinned");
    expect(commits()).toBe(count);
  }, 60_000);

  test("stack updates both tags and copies the disk plan", () => {
    const sha = git(fixture.stack, "rev-parse", "HEAD");
    const out = run("stack", sha);
    if (out.status !== 0) console.error(out.stderr);
    expect(out.status).toBe(0);
    expect(read("scripts/install.sh")).toContain(`STACK_TAG="${sha}"`);
    expect(read("scripts/engine-computer/maipai-engine")).toContain(`STACK_TAG="${sha}"`);
    expect(read("shared/diskPlan.json")).toBe(readFileSync(join(fixture.stack, "docs/disk-plan.json"), "utf8"));
    expect(gitRepo("log", "-1", "--format=%s")).toBe(`Pin Stack ${sha.slice(0, 7)}`);
  }, 60_000);

  test("bot release updates asset sizes and digests while preserving key order and indentation", () => {
    const release = { assets: [
      { name: "bot-darwin.tar.gz", size: 900, digest: `sha256:${"a".repeat(64)}` },
      { name: "bot-linux.tar.gz", size: 901, digest: `sha256:${"b".repeat(64)}` },
    ] };
    writeFileSync(fixture.env.GH_JSON!, JSON.stringify(release));
    const out = run("bot", "9.9.9");
    if (out.status !== 0) console.error(out.stderr);
    expect(out.status).toBe(0);
    const serialized = read("backend/src/lib/botReleasePin.json");
    const pin = JSON.parse(serialized);
    expect(pin.version).toBe("9.9.9");
    expect(pin.assets.darwin).toMatchObject({ size: 900, sha256: "a".repeat(64) });
    expect(pin.assets.linux).toMatchObject({ size: 901, sha256: "b".repeat(64) });
    expect(serialized.startsWith('{\n  "_note"')).toBe(true);
    expect(serialized.indexOf('"darwin"')).toBeLessThan(serialized.indexOf('"linux"'));
    expect(gitRepo("log", "-1", "--format=%s")).toBe("Pin bot 9.9.9");
  }, 60_000);

  test("dry run is read only and dirty tracked trees are refused", () => {
    const before = read("backend/package.json");
    const dry = run("commons", "ui-v9.9.9", "--dry-run");
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("backend/package.json");
    expect(dry.stdout).toContain("Would commit: Pin ui-v9.9.9");
    expect(read("backend/package.json")).toBe(before);
    expect(commits()).toBe(1);
    writeFileSync(join(fixture.repo, "shared/diskPlan.json"), "dirty\n");
    const refused = run("stack", git(fixture.stack, "rev-parse", "HEAD"));
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("tracked changes are uncommitted");
  }, 60_000);
});

afterAll(() => { if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true }); });
