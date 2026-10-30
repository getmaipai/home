import { describe, test, expect, setDefaultTimeout } from "bun:test";
setDefaultTimeout(30_000);
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import * as installFixtures from "./installFixtures";
const { INSTALL_SH, ENGINE_HELPER, PAIR_RESPONSE, readChild, startPairServer, stopPairServer, bashCall, runScript } = installFixtures;

describe("render_stack_binary_name", () => {
  test("matches stack/scripts/build-binary.sh's own naming", () => {
    expect(bashCall("render_stack_binary_name darwin arm64").stdout).toBe("maipai-stack-darwin-arm64");
    expect(bashCall("render_stack_binary_name linux x64").stdout).toBe("maipai-stack-linux-x64");
  });
});


describe("fetch_stack_commons", () => {
  // The Stack at STACK_TAG pins both of these in backend/package.json; the layout must make each path resolve.
  const STACK_PACKAGE_JSON = JSON.stringify({
    name: "@maipai/stack-backend",
    dependencies: {
      "@hono/zod-openapi": "^1.6.3",
      "@maipai/core": "file:../../commons-tags/core-core-v0.1.0/core",
      "@maipai/spec": "file:../../commons-tags/spec-spec-v0.1.136/spec",
      zod: "^4.0.0",
    },
  }, null, 2);

  // One fixture archive per Commons tag, shaped like GitHub's: commons-<tag>/<package>/package.json.
  function commonsFixture(root: string): { digests: Record<string, string>; dir: string } {
    const digests: Record<string, string> = {};
    for (const [pkg, tag] of [["core", "core-v0.1.0"], ["spec", "spec-v0.1.136"]] as const) {
      const pkgDir = join(root, "archive", pkg, `commons-${tag}`, pkg);
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: `@maipai/${pkg}`, version: "0.0.1", ...(pkg === "core" ? { dependencies: { "@maipai/spec": "file:../spec" } } : {}) }));
      const archive = join(root, `${tag}.tar.gz`);
      expect(Bun.spawnSync(["tar", "-czf", archive, "-C", join(root, "archive", pkg), `commons-${tag}`]).exitCode).toBe(0);
      const digest = Bun.spawnSync(["shasum", "-a", "256", archive]);
      expect(digest.exitCode).toBe(0);
      digests[tag] = digest.stdout.toString().split(/\s+/)[0]!;
    }
    return { digests, dir: root };
  }

  // The offline run: curl copies the fixture for the tag in the URL, the digest table is the fixture's.
  function runFetch(script: string, root: string, digests: Record<string, string>, workspace: string) {
    return Bun.spawnSync(["bash", "-c", `source "${script}"; curl() { case "$2" in *core-v0.1.0*) cp "$ROOT/core-v0.1.0.tar.gz" "$4";; *spec-v0.1.136*) cp "$ROOT/spec-v0.1.136.tar.gz" "$4";; *) return 22;; esac; }; commons_archive_sha256() { case "$1" in core-v0.1.0) echo "$CORE_SHA";; spec-v0.1.136) echo "$SPEC_SHA";; *) return 1;; esac; }; fetch_stack_commons "$WORKSPACE" no`], {
      env: { ...process.env, ROOT: root, CORE_SHA: digests["core-v0.1.0"]!, SPEC_SHA: digests["spec-v0.1.136"]!, WORKSPACE: workspace, TMPDIR: root },
    });
  }

  test.each([["install.sh", INSTALL_SH], ["maipai-engine update", ENGINE_HELPER]] as const)("%s: lays core and spec where the Stack's file: paths resolve, using an offline mocked download", (_name, script) => {
    const root = mkdtempSync(join(tmpdir(), "maipai-stack-commons-layout-"));
    try {
      const { digests } = commonsFixture(root);
      const workspace = join(root, "workspace");
      mkdirSync(join(workspace, "stack", "backend"), { recursive: true });
      writeFileSync(join(workspace, "stack", "backend", "package.json"), STACK_PACKAGE_JSON);
      const result = runFetch(script, root, digests, workspace);
      expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0);
      // The regression: every @maipai file: dependency in the pinned package.json resolves, from stack/backend, to a folder that holds its package.
      const deps = (JSON.parse(STACK_PACKAGE_JSON) as { dependencies: Record<string, string> }).dependencies;
      const filePaths = Object.entries(deps).filter(([name, spec]) => name.startsWith("@maipai/") && spec.startsWith("file:"));
      expect(filePaths.map(([name]) => name)).toEqual(["@maipai/core", "@maipai/spec"]);
      for (const [name, spec] of filePaths) {
        const resolved = join(workspace, "stack", "backend", spec.slice("file:".length));
        expect(readFileSync(join(resolved, "package.json"), "utf8"), spec).toContain(`"name":"${name}"`);
      }
      expect(join(workspace, "stack", "backend", "../../commons-tags/core-core-v0.1.0/core")).toBe(join(workspace, "commons-tags", "core-core-v0.1.0", "core"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([["install.sh", INSTALL_SH], ["maipai-engine update", ENGINE_HELPER]] as const)("%s: a wrong digest refuses, says what to do, and unpacks nothing", (_name, script) => {
    const root = mkdtempSync(join(tmpdir(), "maipai-stack-commons-digest-"));
    try {
      const { digests } = commonsFixture(root);
      const workspace = join(root, "workspace");
      mkdirSync(join(workspace, "stack", "backend"), { recursive: true });
      writeFileSync(join(workspace, "stack", "backend", "package.json"), STACK_PACKAGE_JSON);
      const result = runFetch(script, root, { ...digests, "core-v0.1.0": "0".repeat(64) }, workspace);
      expect(result.exitCode).not.toBe(0);
      const said = result.stdout.toString();
      expect(said).toContain("SHA-256 mismatch");
      expect(said).toContain("run this again");
      expect(existsSync(join(workspace, "commons-tags", "core-core-v0.1.0", "core"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([["install.sh", INSTALL_SH], ["maipai-engine update", ENGINE_HELPER]] as const)("%s: a Commons tag with no pinned digest says which digest to add and where", (_name, script) => {
    const root = mkdtempSync(join(tmpdir(), "maipai-stack-commons-newtag-"));
    try {
      const workspace = join(root, "workspace");
      mkdirSync(join(workspace, "stack", "backend"), { recursive: true });
      writeFileSync(join(workspace, "stack", "backend", "package.json"), STACK_PACKAGE_JSON.replace("core-core-v0.1.0/core", "core-core-v0.1.999/core"));
      const result = Bun.spawnSync(["bash", "-c", `source "${script}"; curl() { return 22; }; fetch_stack_commons "$WORKSPACE" no`], { env: { ...process.env, WORKSPACE: workspace, TMPDIR: root } });
      expect(result.exitCode).not.toBe(0);
      const said = result.stdout.toString();
      expect(said).toContain("core-v0.1.999");
      expect(said).toContain("commons_archive_sha256");
      expect(said).toContain("scripts/install.sh");
      expect(said).toContain("scripts/engine-computer/maipai-engine");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([["install.sh", INSTALL_SH], ["maipai-engine update", ENGINE_HELPER]] as const)("%s: a package.json that is not there says to fetch the Stack first", (_name, script) => {
    const result = Bun.spawnSync(["bash", "-c", `source "${script}"; fetch_stack_commons /nonexistent/maipai-work no`]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).toContain("Fetch the Stack source");
  });

  test("the two scripts carry the same pins and the same helpers (a drift between them fails here)", () => {
    const show = (script: string) =>
      Bun.spawnSync(["bash", "-c", `source "${script}"; for t in core-v0.1.0 spec-v0.1.136 other; do commons_archive_sha256 $t || echo none; done; declare -f commons_archive_sha256 stack_commons_deps fetch_one_stack_commons fetch_stack_commons`]).stdout.toString();
    const install = show(INSTALL_SH);
    const engine = show(ENGINE_HELPER);
    expect(install).toContain("d3c60aec818e73c00079e5a819d86477ecb590a0172f214a0aee80890d8427f4");
    expect(install).toContain("5dece57ae0495d27f8c3e565b7de14217e0f5d1495b0a09feee7e10b625e4342");
    expect(engine).toBe(install);
  });

  // The pins are read from the Stack's own package.json, so the digest table must cover whatever the Stack at STACK_TAG
  // names. Read from the sibling Stack checkout when there is one (the gate runs where it exists; a machine without
  // it skips this and the fixture above still holds the same two lines).
  const STACK_DIR = join(import.meta.dir, "..", "..", "stack");
  test.skipIf(!existsSync(join(STACK_DIR, ".git")))("every Commons package in the Stack at STACK_TAG has a pinned digest and resolves under commons-tags", () => {
    const tag = /^STACK_TAG="?([0-9a-f]{40})"?$/m.exec(readFileSync(INSTALL_SH, "utf8"))?.[1];
    expect(tag).toBeDefined();
    const shown = Bun.spawnSync(["git", "-C", STACK_DIR, "show", `${tag}:backend/package.json`]);
    if (shown.exitCode !== 0) return; // the sibling checkout has not fetched that commit; nothing to compare here
    const root = mkdtempSync(join(tmpdir(), "maipai-stack-pins-"));
    try {
      writeFileSync(join(root, "package.json"), shown.stdout.toString());
      const out = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; stack_commons_deps "$MANIFEST"`], { env: { ...process.env, MANIFEST: join(root, "package.json") } });
      expect(out.exitCode, out.stdout.toString()).toBe(0);
      const rows = out.stdout.toString().trim().split("\n").map((line) => line.split(" "));
      expect(rows.length).toBeGreaterThan(0);
      for (const [pkg, dir, ctag] of rows) {
        expect(dir).toBe(`${pkg}-${ctag}`);
        expect(Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; commons_archive_sha256 "${ctag}"`]).exitCode, `no pinned digest for ${ctag}`).toBe(0);
        expect(shown.stdout.toString()).toContain(`"file:../../commons-tags/${dir}/${pkg}"`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Home's own pins: a bump in backend/ or frontend/ package.json without a digest here breaks every fresh install.
  const HOME_ROOT = join(import.meta.dir, "..");
  test("every Commons pin in Home's backend and frontend package.json has a pinned digest", () => {
    let seen = 0;
    for (const m of ["backend", "frontend"]) {
      const text = readFileSync(join(HOME_ROOT, m, "package.json"), "utf8");
      const out = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; stack_commons_deps "$MANIFEST"`], { env: { ...process.env, MANIFEST: join(HOME_ROOT, m, "package.json") } });
      expect(out.exitCode, out.stdout.toString()).toBe(0);
      for (const line of out.stdout.toString().trim().split("\n")) {
        const [pkg, dir, ctag] = line.split(" ");
        seen++;
        expect(text).toContain(`"file:../../commons-tags/${dir}/${pkg}"`);
        for (const script of [INSTALL_SH, ENGINE_HELPER]) {
          expect(Bun.spawnSync(["bash", "-c", `source "${script}"; commons_archive_sha256 "${ctag}"`]).exitCode, `${m}/package.json pins ${ctag} but ${script} has no digest for it: add the SHA-256 of its GitHub archive to commons_archive_sha256`).toBe(0);
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(4);
  });

  test("fetch_home_commons stages every tag both Home manifests name beside the install root, once each", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-home-commons-"));
    try {
      const prefix = join(root, "prefix");
      const install = join(prefix, "maipai-home");
      mkdirSync(join(install, "backend"), { recursive: true });
      mkdirSync(join(install, "frontend"), { recursive: true });
      writeFileSync(join(install, "backend", "package.json"), JSON.stringify({ dependencies: { "@maipai/core": "file:../../commons-tags/core-core-v0.1.0/core", "@maipai/spec": "file:../../commons-tags/spec-spec-v0.1.136/spec" } }, null, 2));
      writeFileSync(join(install, "frontend", "package.json"), JSON.stringify({ dependencies: { "@maipai/spec": "file:../../commons-tags/spec-spec-v0.1.136/spec", react: "^19" } }, null, 2));
      const { digests } = commonsFixture(root);
      const run = (digestOverride?: string) => Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; n=0; curl() { n=$((n+1)); echo "$2" >> "$ROOT/urls"; case "$2" in *core-v0.1.0*) cp "$ROOT/core-v0.1.0.tar.gz" "$4";; *spec-v0.1.136*) cp "$ROOT/spec-v0.1.136.tar.gz" "$4";; *) return 22;; esac; }; commons_archive_sha256() { case "$1" in core-v0.1.0) echo "$CORE_SHA";; spec-v0.1.136) echo "$SPEC_SHA";; *) return 1;; esac; }; fetch_home_commons "$INSTALL"`], {
        env: { ...process.env, ROOT: root, INSTALL: install, CORE_SHA: digestOverride ?? digests["core-v0.1.0"]!, SPEC_SHA: digests["spec-v0.1.136"]!, TMPDIR: root },
      });
      const bad = run("0".repeat(64));
      expect(bad.exitCode).not.toBe(0);
      expect(bad.stdout.toString()).toContain("SHA-256 mismatch");
      expect(existsSync(join(prefix, "commons-tags", "core-core-v0.1.0", "core", "package.json"))).toBe(false);
      const ok = run();
      expect(ok.exitCode, ok.stdout.toString() + ok.stderr.toString()).toBe(0);
      for (const rel of ["core-core-v0.1.0/core", "spec-spec-v0.1.136/spec"]) {
        const resolved = join(install, "backend", "../../commons-tags", rel);
        expect(readFileSync(join(resolved, "package.json"), "utf8")).toContain("@maipai/");
      }
      // core names spec as file:../spec; each tag has its own folder, so the installer links it (v0.2.0 failed bun install without this).
      expect(readFileSync(join(install, "backend", "../../commons-tags/core-core-v0.1.0/spec/package.json"), "utf8")).toContain("@maipai/spec");
      // spec is named by both manifests but downloaded once; core once; the failed run above fetched core only.
      const urls = readFileSync(join(root, "urls"), "utf8").trim().split("\n");
      expect(urls.filter((u) => u.includes("spec-v0.1.136")).length).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("dry-run prints the Commons tags and their verified archive digests without fetching", () => {
    const result = bashCall('fetch_stack_commons /tmp/maipai-stack yes');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("core-v0.1.0 sha256 d3c60aec818e73c00079e5a819d86477ecb590a0172f214a0aee80890d8427f4");
    expect(result.stdout).toContain("spec-v0.1.136 sha256 5dece57ae0495d27f8c3e565b7de14217e0f5d1495b0a09feee7e10b625e4342");
    expect(result.stdout).toContain("/tmp/maipai-stack/commons-tags/<package>-<tag>/<package>");
  });

  test("maipai-engine update --dry-run names the Stack, both Commons packages and the rebuild", () => {
    const result = Bun.spawnSync(["bash", ENGINE_HELPER, "--dry-run", "update"]);
    expect(result.exitCode).toBe(0);
    const said = result.stdout.toString();
    expect(said).toContain("Would fetch Stack at pinned STACK_TAG");
    expect(said).toContain("core-v0.1.0 and spec-v0.1.136");
    expect(said).toContain("pinned SHA-256");
    expect(said).toContain("Would rebuild and restart maipai-stack");
  });

  test("setup_stack dry-run does not create its scratch tree", () => {
    const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; mktemp() { echo "mktemp called during dry-run" >&2; return 1; }; setup_stack /opt/maipai-home /opt/maipai-home/.bun/bin/bun linux x64 yes`]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).not.toContain("mktemp called during dry-run");
    expect(result.stdout.toString()).toContain("would fetch each getmaipai/commons tag named in");
    expect(result.stdout.toString()).toContain("core-v0.1.0 sha256");
    expect(result.stdout.toString()).toContain("scripts/build-binary.sh");
  });
});


describe("engine computer Bun recovery", () => {
  test.each(["missing", "empty", "unrunnable"] as const)("installs a working Bun runtime when its directory is %s", (state) => {
    const root = mkdtempSync(join(tmpdir(), "maipai-engine-bun-recovery-"));
    const bunHome = join(root, ".bun");
    if (state === "empty") mkdirSync(bunHome);
    if (state === "unrunnable") {
      mkdirSync(join(bunHome, "bin"), { recursive: true });
      writeFileSync(join(bunHome, "bin", "bun"), "#!/usr/bin/env bash\nexit 1\n", { mode: 0o755 });
    }
    const install = [
      'curl() { printf "%s\\n" \'mkdir -p "$BUN_INSTALL/bin"\' \'printf "#!/usr/bin/env bash\\\\necho 1.2.3\\\\n" > "$BUN_INSTALL/bin/bun"\' \'chmod +x "$BUN_INSTALL/bin/bun"\'; }',
      `source "${INSTALL_SH}"; ensure_bun_system_wide "${bunHome}"`,
    ].join("; ");
    try {
      const result = Bun.spawnSync(["bash", "-c", install]);
      expect(result.exitCode).toBe(0);
      expect(Bun.spawnSync([join(bunHome, "bin", "bun"), "--version"]).stdout.toString().trim()).toBe("1.2.3");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("build output cannot delete the Bun runtime inside the engine install root", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-engine-build-output-"));
    const bunHome = join(root, ".bun");
    const bunBin = join(bunHome, "bin", "bun");
    const source = join(root, "source");
    const build = join(source, "scripts", "build-binary.sh");
    const output = join(root, "scratch-output");
    mkdirSync(join(bunHome, "bin"), { recursive: true });
    mkdirSync(join(source, "scripts"), { recursive: true });
    writeFileSync(bunBin, "#!/usr/bin/env bash\necho 1.2.3\n", { mode: 0o755 });
    writeFileSync(build, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "bun --version >/dev/null",
      'rm -rf "$OUT_DIR"',
      'mkdir -p "$OUT_DIR/migrations" "$OUT_DIR/backend-src" "$OUT_DIR/ort-wasm"',
      'printf binary > "$OUT_DIR/maipai-stack-linux-x64"',
    ].join("\n"), { mode: 0o755 });
    try {
      const command = `source "${INSTALL_SH}"; build_stack_binary "${source}" "${output}" "${bunBin}" no && publish_engine_stack_binary "${output}" "${root}" maipai-stack-linux-x64`;
      const result = Bun.spawnSync(["bash", "-c", command]);
      expect(result.exitCode).toBe(0);
      expect(Bun.spawnSync([bunBin, "--version"]).stdout.toString().trim()).toBe("1.2.3");
      expect(readFileSync(join(root, "maipai-stack-linux-x64"), "utf8")).toBe("binary");
      expect(existsSync(join(root, "migrations"))).toBe(true);
      expect(existsSync(join(root, "backend-src"))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});


describe("stack_install_service_command", () => {
  test("names every env var install-service actually needs, in one line a test or a log can assert on", () => {
    const out = bashCall('stack_install_service_command /opt/maipai-home/stack/maipai-stack-darwin-arm64 /opt/maipai-home/stack/data 8770 /opt/maipai-home/.bun/bin/bun').stdout;
    expect(out).toBe("STACK_DATA_DIR=/opt/maipai-home/stack/data PORT=8770 STACK_BUN_BIN=/opt/maipai-home/.bun/bin/bun /opt/maipai-home/stack/maipai-stack-darwin-arm64 install-service");
  });
});


describe("required Stack setup failures", () => {
  test.each([
    ["missing Stack user", 'find_console_user() { echo ""; }', "logged-in console user"],
    ["missing Stack binary", 'find_console_user() { echo marlow; }; render_stack_binary_name() { echo absent; }', "compiled Stack binary is missing"],
    ["failed service install", 'find_console_user() { echo marlow; }; chown() { return 0; }; clear_quarantine_and_sign() { :; }; run_as_console_user() { return 1; }', "install-service command failed"],
    ["health timeout", 'find_console_user() { echo marlow; }; chown() { return 0; }; clear_quarantine_and_sign() { :; }; run_as_console_user() { return 0; }; curl() { return 22; }; sleep() { :; }', "did not answer /healthz in time"],
  ] as const)("fails when there is a %s", (_name, setup, message) => {
    const root = mkdtempSync(join(tmpdir(), "maipai-install-required-stack-"));
    mkdirSync(join(root, "stack"));
    writeFileSync(join(root, "stack", "maipai-stack-darwin-arm64"), "", { mode: 0o755 });
    try {
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; ${setup}; install_stack_service "${root}" "${root}/bun" darwin arm64 no`], { env: { ...process.env, STACK_HEALTH_TRIES: "1" } });
      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toContain(message);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});


describe("Stack port on upgrade (2026-10-28 outage)", () => {
  const run = (setup: string, recordedPort: string | null) => {
    const root = mkdtempSync(join(tmpdir(), "maipai-install-stack-port-"));
    mkdirSync(join(root, "stack"));
    writeFileSync(join(root, "stack", "maipai-stack-darwin-arm64"), "", { mode: 0o755 });
    if (recordedPort) writeFileSync(join(root, "stack", ".port"), `${recordedPort}\n`);
    const calls = join(root, "calls.log");
    try {
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; STACK_PORT_BASE=8770; find_console_user() { echo marlow; }; chown() { return 0; }; clear_quarantine_and_sign() { :; }; sleep() { :; }; find_free_port() { echo 8771; }; run_as_console_user() { shift 2; echo "$*" >> "${calls}"; }; ${setup}; install_stack_service "${root}" "${root}/bun" darwin arm64 no`], { env: { ...process.env, STACK_HEALTH_TRIES: "4" } });
      const log = Bun.file(calls).size ? require("node:fs").readFileSync(calls, "utf8") : "";
      return { result, log, port: require("node:fs").readFileSync(join(root, "stack", ".port"), "utf8").trim() };
    } finally { rmSync(root, { recursive: true, force: true }); }
  };

  test("the old Stack still holds its port: the upgrade keeps that port", () => {
    const { log, port } = run("port_in_use() { return 0; }; stack_answers_on() { return 0; }; curl() { return 0; }; (cd() { :; }; true)", "8770");
    expect(port).toBe("8770");
    expect(log).toContain("PORT=8770");
  });

  test("a stranger holds the recorded port: a free one is chosen", () => {
    const { port } = run("port_in_use() { return 0; }; stack_answers_on() { return 1; }; curl() { return 0; }", "8770");
    expect(port).toBe("8771");
  });

  test("a service that was written but never loaded is asked to start", () => {
    const { log } = run('port_in_use() { return 1; }; n=0; curl() { n=$((n+1)); [ "$n" -gt 3 ]; }', null);
    expect(log).toContain("maipai-stack-darwin-arm64 start");
  });
});


describe("find_console_user", () => {
  test("darwin: the real console user, not root, even sourced under sudo-like output", () => {
    const out = bashCall("find_console_user darwin").stdout;
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe("root");
  });

  test("darwin: root (no one logged into the console) is refused, not accepted as valid", () => {
    // A headless Mac reached only over SSH, or the gap between a
    // logout and the next login, both real states - `stat -f%Su
    // /dev/console` answers "root" then. A code review found the
    // original version's only guard was "non-empty," which "root"
    // satisfies, so the Stack would have been installed and run as
    // root: exactly what this function exists to prevent.
    const result = Bun.spawnSync(["bash", "-c", `stat() { echo root; }; source "${INSTALL_SH}"; find_console_user darwin`]);
    expect(result.stdout.toString().trim()).toBe("");
  });

  test("linux: falls back through logname to $SUDO_USER", () => {
    // logname succeeds even under spawnSync on this dev machine (macOS
    // reads it from the audit session, not strictly a controlling tty),
    // so the fallback branch is forced deterministically here with a
    // shell function of the same name - bash calls a function over an
    // external command of the same name, the same shadowing logname's
    // own real absence on a bare container would produce.
    const result = Bun.spawnSync(["bash", "-c", `logname() { return 1; }; source "${INSTALL_SH}"; SUDO_USER=marlow find_console_user linux`]);
    expect(result.stdout.toString().trim()).toBe("marlow");
  });
});


describe("detect_os / detect_arch", () => {
  test("recognize this machine (darwin/arm64 in this repo's own dev environment)", () => {
    const os = bashCall("detect_os").stdout;
    const arch = bashCall("detect_arch").stdout;
    expect(["darwin", "linux"]).toContain(os);
    expect(["x64", "arm64"]).toContain(arch);
  });
});


describe("--dry-run", () => {
  test("prints the full Stack install plan and touches nothing - no root, no network, no filesystem writes", () => {
    const { stdout, exitCode } = runScript(["--stack-only", "--dry-run"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("[dry-run] MaiPai Stack install plan for");
    expect(stdout).toContain("STACK_TAG=");
    expect(stdout).toMatch(/would fetch getmaipai\/stack@[0-9a-f]+ into/);
    expect(stdout).toContain("would fetch each getmaipai/commons tag named in");
    expect(stdout).toContain("core-v0.1.0 sha256 d3c60aec818e73c00079e5a819d86477ecb590a0172f214a0aee80890d8427f4");
    expect(stdout).toContain("spec-v0.1.136 sha256 5dece57ae0495d27f8c3e565b7de14217e0f5d1495b0a09feee7e10b625e4342");
    expect(stdout).toContain("scripts/build-binary.sh");
    expect(stdout).toContain("OUT_DIR=");
    expect(stdout).toContain("SKIP_VERIFY=1");
    expect(stdout).toMatch(/would create .*\/stack\/data \(0700, owned by/);
    expect(stdout).toMatch(/would write .* to .*\/stack\/\.user/);
    expect(stdout).toContain("install-service");
    expect(stdout).toContain("would poll http://127.0.0.1:8770/healthz");
    expect(stdout).toContain("would run: bun run backend/scripts/set-setting.ts engines.stack.url http://127.0.0.1:8770 --only-if-empty-or-prefix http://127.0.0.1:");
    expect(stdout).not.toContain("engines.stack.use_");
  });

  test("makes no network call at all - find_free_port() (a real loopback socket probe) never runs", () => {
    // A code review found this script's own "no network call" claim
    // was false: install_stack_service() called find_free_port()
    // (which opens a real /dev/tcp/127.0.0.1/<port> connection per
    // candidate port, port_in_use()'s own probe) unconditionally,
    // before the dry-run branch's early return - real activity in a
    // network-sandboxed environment even though nothing was ever
    // actually installed. Stubbing find_free_port() to fail loudly and
    // asserting it was never called is a stronger proof than reading
    // the source: it would fail if that call were ever reintroduced,
    // anywhere in the dry-run path, not just at today's call site.
    const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; find_free_port() { echo "find_free_port WAS CALLED with: $*" >&2; exit 1; }; main --stack-only --dry-run`]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).not.toContain("find_free_port WAS CALLED");
  });

  test("does not require root", () => {
    // The real assertion is that this test ran at all without sudo -
    // require_root() is never reached on the --dry-run path (main()
    // returns before calling it). A stray "must run as root" line in
    // stdout would mean that guard leaked into the dry-run branch.
    const { stdout, exitCode } = runScript(["--dry-run"]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("must run as root");
  });
});


describe("open_setup_page", () => {
  test("dry-run prints what it would open and opens nothing", () => {
    const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; find_console_user() { echo marlow; }; run_as_console_user() { echo OPENED; }; open_setup_page darwin http://localhost:3000 yes`]);
    const out = result.stdout.toString() + result.stderr.toString();
    expect(out).toContain("[dry-run] would open http://localhost:3000 in the default browser as marlow");
    expect(out).not.toContain("OPENED");
  });
  test("a failed open is not fatal and says to open the address by hand", () => {
    const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; find_console_user() { echo marlow; }; run_as_console_user() { return 1; }; open_setup_page darwin http://localhost:3000; echo rc=$?`]);
    const out = result.stdout.toString() + result.stderr.toString();
    expect(out).toContain("Open the address below by hand");
    expect(out).toContain("rc=0");
  });
  test("no console user: skips silently", () => {
    const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; find_console_user() { echo; }; run_as_console_user() { echo OPENED; }; open_setup_page darwin http://localhost:3000; echo rc=$?`]);
    const out = result.stdout.toString() + result.stderr.toString();
    expect(out).not.toContain("OPENED");
    expect(out).toContain("rc=0");
  });
});


describe("setup plan option", () => {
  function planCall(args: string[], env: Record<string, string | undefined> = {}, existing = "") {
    const root = mkdtempSync(join(tmpdir(), "maipai-setup-plan-"));
    const data = join(root, "data");
    if (existing) {
      mkdirSync(data, { recursive: true });
      writeFileSync(join(data, "setup-plan"), `${existing}\n`);
    }
    try {
      const scriptArgs = args.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ");
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; INSTALL_ROOT_LINUX="$TEST_ROOT"; INSTALL_ROOT_DARWIN="$TEST_ROOT"; main ${scriptArgs}`], {
        env: { ...process.env, ...env, TEST_ROOT: root },
      });
      return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode, record: existsSync(join(data, "setup-plan")) ? readFileSync(join(data, "setup-plan"), "utf8").trim() : "" };
    } finally { rmSync(root, { recursive: true, force: true }); }
  }

  test.each(["recommended", "moderate", "minimal"] as const)("records accepted plan %s", (plan) => {
    const root = mkdtempSync(join(tmpdir(), "maipai-setup-plan-"));
    try {
      const result = bashCall(`record_setup_plan "${root}/data" "${plan}" no`);
      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(root, "data", "setup-plan"), "utf8").trim()).toBe(plan);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("rejects an unknown plan with allowed values and the next step", () => {
    const result = planCall(["--plan", "huge"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("recommended, moderate, and minimal");
    expect(result.stderr).toContain("run the installer again");
  });

  test("reads MAIPAI_PLAN", () => {
    const result = planCall(["--dry-run"], { MAIPAI_PLAN: "moderate" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("would record setup plan moderate");
  });

  test("rejects an unknown MAIPAI_PLAN with allowed values and the next step", () => {
    const result = planCall(["--dry-run"], { MAIPAI_PLAN: "huge" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("recommended, moderate, and minimal");
    expect(result.stderr).toContain("run the installer again");
  });

  test("flag wins over MAIPAI_PLAN and repeated flags use the last value", () => {
    const result = planCall(["--plan", "minimal", "--plan", "recommended", "--dry-run"], { MAIPAI_PLAN: "moderate" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("using --plan recommended");
    expect(result.stdout).toContain("given more than once");
  });

  test("without a new plan, keeps the saved record", () => {
    const result = planCall(["--dry-run"], {}, "moderate");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Keeping the saved setup plan moderate");
    expect(result.record).toBe("moderate");
  });

  test("dry-run never writes a plan record", () => {
    const result = planCall(["--plan", "recommended", "--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(result.record).toBe("");
  });
});


describe("link_commons_siblings", () => {
  // deps lines are "<package> <tag dir> <tag>"; ui-v1 needs ../spec next to it.
  function layout() {
    const work = mkdtempSync(join(tmpdir(), "link-siblings-"));
    mkdirSync(join(work, "commons-tags", "ui-ui-v1", "ui"), { recursive: true });
    writeFileSync(join(work, "commons-tags", "ui-ui-v1", "ui", "package.json"), JSON.stringify({ name: "@maipai/ui", dependencies: { "@maipai/spec": "file:../spec" } }));
    for (const tag of ["spec-v0.1.272", "spec-v0.1.275"]) mkdirSync(join(work, "commons-tags", `spec-${tag}`, "spec"), { recursive: true });
    const deps = "ui ui-ui-v1 ui-v1\nspec spec-spec-v0.1.275 spec-v0.1.275\n";
    return { work, deps };
  }

  test("points a link made for an older spec tag at the spec this Home names", () => {
    const { work, deps } = layout();
    try {
      Bun.spawnSync(["ln", "-s", "../spec-spec-v0.1.272/spec", join(work, "commons-tags", "ui-ui-v1", "spec")]);
      const result = bashCall(`link_commons_siblings "${work}" "$(printf '%s' '${deps}')"`);
      expect(result.exitCode).toBe(0);
      expect(Bun.spawnSync(["readlink", join(work, "commons-tags", "ui-ui-v1", "spec")]).stdout.toString().trim()).toBe("../spec-spec-v0.1.275/spec");
    } finally { rmSync(work, { recursive: true, force: true }); }
  });

  test("leaves a real folder alone", () => {
    const { work, deps } = layout();
    try {
      mkdirSync(join(work, "commons-tags", "ui-ui-v1", "spec"));
      const result = bashCall(`link_commons_siblings "${work}" "$(printf '%s' '${deps}')"`);
      expect(result.exitCode).toBe(0);
      expect(statSync(join(work, "commons-tags", "ui-ui-v1", "spec")).isDirectory()).toBe(true);
      expect(Bun.spawnSync(["readlink", join(work, "commons-tags", "ui-ui-v1", "spec")]).stdout.toString().trim()).toBe("");
    } finally { rmSync(work, { recursive: true, force: true }); }
  });
});
