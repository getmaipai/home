import { describe, test, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";

// HOME-STACK-01: install.sh's Stack functions are pure bash, sourced
// (not executed - see the script's own "am I sourced" guard at the
// bottom) so each is called directly the way a real run would, rather
// than a TypeScript reimplementation that could drift from what the
// script actually does.
const INSTALL_SH = join(import.meta.dir, "install.sh");
const ENGINE_HELPER = join(import.meta.dir, "engine-computer", "maipai-engine");
const PAIR_RESPONSE = join(import.meta.dir, "engine-computer", "pair-response.py");

async function readChild(process: ReturnType<typeof Bun.spawn>) {
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout as ReadableStream<Uint8Array>).text(),
    new Response(process.stderr as ReadableStream<Uint8Array>).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function startPairServer(body: Record<string, string>, expectedPath?: string, status = 200) {
  const source = `
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
      const path = new URL(request.url).pathname;
      if (process.env.EXPECTED_PATH && path !== process.env.EXPECTED_PATH) return new Response("wrong path", { status: 404 });
      return Response.json(JSON.parse(process.env.RESPONSE_BODY), { status: Number(process.env.RESPONSE_STATUS || 200) });
    }});
    console.log(server.port);
    process.on("SIGTERM", () => { server.stop(true); process.exit(0); });
  `;
  const child = Bun.spawn(["bun", "-e", source], {
    env: { ...process.env, RESPONSE_BODY: JSON.stringify(body), EXPECTED_PATH: expectedPath ?? "", RESPONSE_STATUS: String(status) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  let line = "";
  while (!line.includes("\n")) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`Mock server exited before ready: ${await new Response(child.stderr as ReadableStream<Uint8Array>).text()}`);
    line += new TextDecoder().decode(chunk.value);
  }
  return { child, port: Number(line.trim()) };
}

async function stopPairServer(child: ReturnType<typeof Bun.spawn>) {
  child.kill("SIGTERM");
  await child.exited;
}

function bashCall(cmd: string): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; ${cmd}`]);
  return { stdout: result.stdout.toString().trim(), stderr: result.stderr.toString(), exitCode: result.exitCode };
}

function runScript(args: string[]): { stdout: string; exitCode: number } {
  const result = Bun.spawnSync(["bash", INSTALL_SH, ...args]);
  return { stdout: result.stdout.toString(), exitCode: result.exitCode };
}

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
      'mkdir -p "$OUT_DIR/migrations" "$OUT_DIR/backend-src"',
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

describe("REMOTE-STACK-BOX-01 engine computer dry runs", () => {
  test("the box prints the same SHA-256 host check code as Home", () => {
    const folder = mkdtempSync(join(tmpdir(), "maipai-engine-check-code-"));
    const hostKey = join(folder, "host.pub");
    const line = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPoISQD6sKkxbk5FD8YL6LuvYzhXACmFp4cr8oleBk1h known-vector";
    try {
      writeFileSync(hostKey, line);
      const result = Bun.spawnSync(["bash", "-c", 'source "$ENGINE_HELPER"; print_check_code'], {
        env: { ...process.env, ENGINE_HELPER, MAIPAI_ENGINE_HOST_KEY_PUB: hostKey },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toBe("Check code: ZY7I47UWEAS2");
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });

  test("installer dry run keeps each printed command on a short line", () => {
    const { stdout, exitCode } = runScript(["--engine-computer", "--dry-run"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("STACK_TAG=");
    expect(stdout).toContain("sudo useradd -r -U -s /usr/sbin/nologin maipai-stack");
    expect(stdout).toContain("sudo loginctl enable-linger maipai-stack");
    expect(stdout).toContain("sudo apt-get install openssh-server");
    expect(stdout).toContain("sudo systemctl enable --now ssh");
    expect(stdout).toContain("Ready to pair.");
    for (const line of stdout.split("\n")) {
      if (line.includes("sudo ")) expect(line.length).toBeLessThan(70);
    }
  });

  test.each([
    ["pair", ["pair", "192.0.2.10", "K7Q-M2X-RP4-ZT7"]],
    ["unpair", ["unpair"]],
    ["update", ["update"]],
    ["status", ["status"]],
  ] as const)("%s dry run is repeatable", (_name, args) => {
    const first = Bun.spawnSync([ENGINE_HELPER, "--dry-run", ...args]);
    const second = Bun.spawnSync([ENGINE_HELPER, "--dry-run", ...args]);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(second.stdout.toString()).toBe(first.stdout.toString());
    for (const line of first.stdout.toString().split("\n")) {
      if (line.includes("sudo ")) expect(line.length).toBeLessThan(70);
    }
  });

  test("box doctor verifies the sole authorized key against the paired key", () => {
    const folder = mkdtempSync(join(tmpdir(), "maipai-engine-doctor-"));
    const pairFile = join(folder, "paired-home.json");
    const authKeys = join(folder, "authorized_keys");
    const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest fixture";
    const expected = `restrict,port-forwarding,permitopen=\"127.0.0.1:8770\" ${key}`;
    const runDoctor = (authorized: string) => {
      writeFileSync(pairFile, JSON.stringify({ household_id: "household-test", authorized_key: key }));
      writeFileSync(authKeys, authorized);
      return Bun.spawnSync(["bash", "-c", 'source "$ENGINE_HELPER"; id() { echo 1000; }; systemctl() { return 0; }; loginctl() { echo yes; }; ss() { echo "LISTEN 0 128 127.0.0.1:8770 0.0.0.0:*"; }; nvidia-smi() { echo "GPU 0"; }; doctor'], {
        env: { ...process.env, ENGINE_HELPER, MAIPAI_ENGINE_PAIR_FILE: pairFile, MAIPAI_ENGINE_AUTH_KEYS: authKeys, MAIPAI_PINNED_ENGINE: folder },
      });
    };
    try {
      writeFileSync(join(folder, "llama-server"), "#!/bin/sh\necho 'version b10797'\n", { mode: 0o755 });
      writeFileSync(join(folder, ".engine-ready"), "ready");
      const matched = runDoctor(`${expected}\n`);
      expect(matched.stdout.toString()).toContain("PASS hop 5: one restricted key matches the paired household");
      const duplicated = runDoctor(`${expected}\n${expected}\n`);
      expect(duplicated.stdout.toString()).toContain("FAIL hop 5: restricted authorized key is missing or duplicated");
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });

  test("pair response fetches the mocked endpoint and verifies the code HMAC", async () => {
    const code = "K7Q-M2X-RP4-ZT7";
    const normalizedCode = code.replaceAll("-", "").toUpperCase();
    const lookup = createHmac("sha256", normalizedCode)
      .update("maipai-pair-lookup")
      .digest("hex")
      .slice(0, 32);
    const macKey = createHmac("sha256", normalizedCode)
      .update("maipai-pair-mac")
      .digest();
    const publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest fixture";
    const householdId = "household-test-01";
    const signature = createHmac("sha256", macKey)
      .update(`${publicKey}\n${householdId}`)
      .digest("hex");
    const server = await startPairServer({ public_key: publicKey, household_id: householdId, hmac_sha256: signature }, `/api/engine-link/pair/${lookup}`);
    try {
      const home = `http://127.0.0.1:${server.port}`;
      const process = Bun.spawn(["python3", PAIR_RESPONSE, home, code], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const { exitCode, stdout, stderr } = await readChild(process);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(stdout.trim().split("\n")).toEqual([publicKey, householdId]);
    } finally {
      await stopPairServer(server.child);
    }
  });

  // PAIR-WIRE-01: the helper used to drop Home's JSON error body on an HTTP error and print "HTTP Error 403".
  async function helperSays(status: number, body: Record<string, string>) {
    const server = await startPairServer(body, undefined, status);
    try {
      const child = Bun.spawn(["python3", PAIR_RESPONSE, `http://127.0.0.1:${server.port}`, "K7Q-M2X-RP4-ZT7"], { stdout: "pipe", stderr: "pipe" });
      return await readChild(child);
    } finally {
      await stopPairServer(server.child);
    }
  }

  test("an HTTP 403 with Home's JSON error shows Home's words and the next step, not 'HTTP Error 403'", async () => {
    const { exitCode, stdout, stderr } = await helperSays(403, { error: "Pairing is available only on the household network" });
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Pairing is available only on the household network");
    expect(stderr).toContain("while it is on your home network");
    expect(stderr).not.toContain("HTTP Error");
    expect(stderr).not.toContain("KeyError");
  });

  test("an HTTP 400 (code expired or already used) says to get a new code in Home, with the https:// address", async () => {
    const { exitCode, stderr } = await helperSays(400, { error: "Pairing code is invalid or expired" });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Pairing code is invalid or expired");
    expect(stderr).toContain("Pair engine computer");
    expect(stderr).toContain("https://");
  });

  test("an HTTP error with no error field still says what happened and what to do", async () => {
    const { exitCode, stderr } = await helperSays(500, { note: "nothing useful" });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Home answered with HTTP 500.");
    expect(stderr).toContain("Check that Home is running");
  });

  test("a 200 reply that carries an error field, or no signature at all, is explained, never a bare KeyError", async () => {
    const withError = await helperSays(200, { error: "Pairing code is invalid or expired" });
    expect(withError.exitCode).toBe(1);
    expect(withError.stderr).toContain("Pairing code is invalid or expired");
    const noSignature = await helperSays(200, { public_key: "ssh-ed25519 AAAA fixture", household_id: "household-test-01" });
    expect(noSignature.exitCode).toBe(1);
    expect(noSignature.stderr).toContain("missing its key, its household or its signature");
    expect(noSignature.stderr).toContain("Update Home");
    expect(noSignature.stderr).not.toContain("KeyError");
  });

  test("a signature with a non-ASCII character fails the check with the explained message, not a Python TypeError", async () => {
    const { exitCode, stderr } = await helperSays(200, { public_key: "ssh-ed25519 AAAA fixture", household_id: "household-test-01", hmac: "caf\u00e9" });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("did not verify");
    expect(stderr).not.toContain("TypeError");
  });

  test("the helper accepts the signature under either name (hmac_sha256 or hmac)", async () => {
    const code = "K7Q-M2X-RP4-ZT7";
    const normalized = code.replaceAll("-", "").toUpperCase();
    const lookup = createHmac("sha256", normalized).update("maipai-pair-lookup").digest("hex").slice(0, 32);
    const macKey = createHmac("sha256", normalized).update("maipai-pair-mac").digest();
    const publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest fixture";
    const householdId = "household-test-01";
    const signature = createHmac("sha256", macKey).update(`${publicKey}\n${householdId}`).digest("hex");
    for (const field of ["hmac", "hmac_sha256"]) {
      const server = await startPairServer({ public_key: publicKey, household_id: householdId, [field]: signature }, `/api/engine-link/pair/${lookup}`);
      try {
        const child = Bun.spawn(["python3", PAIR_RESPONSE, `http://127.0.0.1:${server.port}`, code], { stdout: "pipe", stderr: "pipe" });
        const { exitCode, stdout, stderr } = await readChild(child);
        expect(stderr, field).toBe("");
        expect(exitCode, field).toBe(0);
        expect(stdout.trim().split("\n")).toEqual([publicKey, householdId]);
      } finally {
        await stopPairServer(server.child);
      }
    }
  });

  test("maipai-engine pair's own closing line points at the message above and a new code", () => {
    expect(readFileSync(ENGINE_HELPER, "utf8")).toContain("The message above says what went wrong and what to do");
  });

  test("pair response rejects a mocked endpoint with a bad HMAC", async () => {
    const server = await startPairServer({
          public_key: "ssh-ed25519 AAAA fixture",
          household_id: "household-test-01",
          hmac_sha256: "bad",
    });
    try {
      const home = `http://127.0.0.1:${server.port}`;
      const process = Bun.spawn(["python3", PAIR_RESPONSE, home, "K7Q-M2X-RP4-ZT7"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const { exitCode, stderr, stdout } = await readChild(process);
      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("did not verify");
    } finally {
      await stopPairServer(server.child);
    }
  });
});

describe("engine computer installer cleanup", () => {
  test("completes the engine-computer function sequence without a leaked RETURN trap", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-engine-install-trap-"));
    const command = [
      `source "${INSTALL_SH}"`,
      // Each call gets its own scratch folder (the code removes the one it makes), all inside the test's own root.
      `mktemp() { command mktemp -d "${root}/m.XXXXXX"; }`,
      `curl() { :; }`,
      // The mocked unpack: the Stack's package.json (read to learn the Commons packages) and each package's folder.
      `tar() { case "$*" in *commons-core-v0.1.0*) command mkdir -p "$4/core"; touch "$4/core/package.json";; *commons-spec-v0.1.136*) command mkdir -p "$4/spec"; touch "$4/spec/package.json";; *) command mkdir -p "$4/backend"; printf '%s\\n' '"@maipai/core": "file:../../commons-tags/core-core-v0.1.0/core",' '"@maipai/spec": "file:../../commons-tags/spec-spec-v0.1.136/spec",' > "$4/backend/package.json";; esac; }`,
      `sha256_file() { case "$1" in *commons.tar.gz) echo "FIXTURE";; esac; }`,
      `commons_archive_sha256() { echo FIXTURE; }`,
      `build_stack_binary() { return 0; }`,
      `publish_engine_stack_binary() { return 0; }`,
      `install_stack_service() { return 0; }`,
      `mkdir() { command mkdir -p "$@"; }`,
      `fetch_stack_source "${root}/stack" no`,
      `fetch_stack_commons "${root}" no`,
      `setup_stack "${root}/install" /usr/bin/bun linux x64 no`,
      'echo "engine-computer path complete"',
    ].join("; ");
    try {
      const result = Bun.spawnSync(["bash", "-c", command]);
      const stderr = result.stderr.toString();
      expect(stderr).not.toContain("unbound variable");
      expect(result.exitCode, `${stderr}\n${result.stdout.toString()}`).toBe(0);
      expect(result.stdout.toString()).toContain("engine-computer path complete");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ENGINE-TRAP-01: `sudo maipai-engine update` did everything, then died with "work: unbound variable". update() set
// `trap 'rm -rf "$work"' RETURN` on a function local; a RETURN trap outlives the function, so it fired again when
// main returned, where `work` no longer exists, and `set -u` killed the script after a good update.
describe("maipai-engine update: its cleanup cannot fire twice or on a name that is gone (ENGINE-TRAP-01)", () => {
  // Runs update() from a function, the way main() calls it, with every machine-changing step stubbed and every file
  // inside `scratch`. `engine` is the script under test (the tests use the repo's; the proof run used the old one).
  function runUpdate(engine: string, scratch: string, buildFails: boolean) {
    const build = buildFails ? "exit 1" : 'mkdir -p "$OUT_DIR/migrations" "$OUT_DIR/backend-src" && : > "$OUT_DIR/maipai-stack-linux-x64"';
    const script = [
      `source "${engine}"`,
      `need_root() { :; }`,
      `mktemp() { command mktemp -d "${scratch}/work.XXXXXX"; }`,
      `uname() { case "$1" in -s) echo Linux;; -m) echo x86_64;; *) command uname "$@";; esac; }`,
      `curl() { :; }`,
      // The Stack download is "unpacked" into $4 as a build script that writes what the real build writes.
      `tar() { command mkdir -p "$4/scripts"; printf '%s\\n' '${build}' > "$4/scripts/build-binary.sh"; }`,
      `fetch_stack_commons() { return 0; }`,
      `chown() { :; }`,
      `loginctl() { :; }`,
      `id() { echo 1000; }`,
      `sudo() { :; }`,
      `STACK_ROOT="${scratch}/root"`,
      `command mkdir -p "$STACK_ROOT/.bun/bin"`,
      `printf '#!/bin/sh\\n' > "$STACK_ROOT/.bun/bin/bun"`,
      `command chmod +x "$STACK_ROOT/.bun/bin/bun"`,
      // main() calls update() from inside its own function frame, and keeps going after it.
      `main_like() { update; echo "back in main_like"; }`,
      `main_like`,
      `echo "main returned"`,
    ].join("\n");
    return Bun.spawnSync(["bash", "-c", script]);
  }
  const leftovers = (scratch: string): string[] => readdirSync(scratch).filter((name) => name.startsWith("work."));

  test("a good update returns to the caller, the script exits 0, and the work folder is gone", () => {
    const scratch = mkdtempSync(join(tmpdir(), "maipai-engine-trap-"));
    try {
      const result = runUpdate(ENGINE_HELPER, scratch, false);
      const said = `${result.stdout.toString()}\n${result.stderr.toString()}`;
      expect(result.stderr.toString()).not.toContain("unbound variable");
      expect(result.exitCode, said).toBe(0);
      expect(said).toContain("back in main_like");
      expect(said).toContain("main returned");
      expect(existsSync(join(scratch, "root", "maipai-stack-linux-x64"))).toBe(true);
      expect(leftovers(scratch)).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("a failed build stops with the fix, and the work folder is still removed", () => {
    const scratch = mkdtempSync(join(tmpdir(), "maipai-engine-trap-"));
    try {
      const result = runUpdate(ENGINE_HELPER, scratch, true);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).not.toContain("unbound variable");
      expect(result.stderr.toString()).toContain("The Stack build failed");
      expect(result.stderr.toString()).toContain("run sudo maipai-engine update again");
      expect(leftovers(scratch)).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("the old line fails this test: a RETURN trap on a function local fires again where the local is gone", () => {
    // The shape of the old code, on its own: it exits nonzero with the exact message Jesse saw.
    const old = Bun.spawnSync(["bash", "-c", `set -euo pipefail; update() { local work=w; trap 'rm -rf "$work"' RETURN; true; }; main() { update; echo after; }; main; echo end`]);
    expect(old.exitCode).not.toBe(0);
    expect(old.stderr.toString()).toContain("work: unbound variable");
    // And the shape of the fix: same frame, exits 0.
    const fixed = Bun.spawnSync(["bash", "-c", `set -euo pipefail; W=""; cleanup() { trap - RETURN EXIT; if [ -n "\${W:-}" ]; then rm -rf "$W"; fi; W=""; return 0; }; update() { local work=w; W="$work"; trap cleanup RETURN EXIT; true; }; main() { update; echo after; }; main; echo end`]);
    expect(fixed.exitCode, fixed.stderr.toString()).toBe(0);
    expect(fixed.stdout.toString()).toContain("end");
  });
});

describe("piped execution (curl -fsSL ... | bash, this file's own documented usage)", () => {
  test("main() still runs - a real regression found by a code review", () => {
    // `[[ "${BASH_SOURCE[0]}" == "${0}" ]]` looked like the right guard
    // for "did someone execute this file, or source it" and was wrong:
    // piped into bash (this script's own top-of-file documented install
    // command), BASH_SOURCE[0] is empty and $0 is "bash", so that
    // comparison is false and main() silently never runs - the
    // installer would exit 0 having installed nothing. Piping the real
    // file into bash here, exactly as a household's own copy-pasted
    // install command would, is the one way to actually catch a
    // regression of this - a test that only ever invokes `bash
    // install.sh` as a real file argument, the way every other test in
    // this file does, would never see it.
    const result = Bun.spawnSync(["bash", "-s", "--", "--dry-run"], { stdin: readFileSync(INSTALL_SH) });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("[dry-run] MaiPai Home install plan for");
  });
});

describe("latest_tag (Mac Studio install audit, 2026-10-16)", () => {
  // GitHub's releases/latest for getmaipai/home answered
  // search-assist-weights-v2 (a data release whose tag points at an old
  // commit), so a real install would have fetched a stale Home. Only
  // Home's own v-tags count now.
  const releases = (tags: string[]) => JSON.stringify(tags.map((tag_name) => ({ tag_name })));

  test("skips a data release and takes the newest v-tag", () => {
    const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; curl() { printf '%s' '${releases(["search-assist-weights-v2", "v0.1.1-rc1", "v0.1.0"])}'; }; latest_tag`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("v0.1.1-rc1");
  });

  test("with no v-tag at all it stops and says to cut a release", () => {
    const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; curl() { printf '%s' '${releases(["search-assist-weights-v2"])}'; }; latest_tag`]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Cut a release");
  });
});

describe("run_install_preflight", () => {
  function fakeBun(root: string, rows: string) {
    // The first call (import ... checkInstallPreflight) answers with the
    // given rows; the second (the blocker filter, fed on stdin) runs the
    // real Bun so the filter itself is exercised.
    const bun = join(root, "bun");
    writeFileSync(bun, `#!/bin/bash\ncase "\${2:-}" in import*) printf '%s' '${rows}' ;; *) exec "${Bun.which("bun")}" "$@" ;; esac\n`, { mode: 0o755 });
    return bun;
  }

  test("a blocking row stops the install with the row's fix and the next step", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-preflight-"));
    mkdirSync(join(root, "backend"));
    try {
      const bun = fakeBun(root, JSON.stringify([{ severity: "error", title: "Disk space", text: "Only 1 GB is free.", fix: { label: "Free up space" } }, { severity: null, title: "Memory", text: "ok" }]));
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; run_install_preflight "${bun}" "${root}/backend" 3000`]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Disk space: Only 1 GB is free. Fix: Free up space");
      expect(result.stderr.toString()).toContain("did not pass the install checks");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("warnings alone let the install go on", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-preflight-"));
    mkdirSync(join(root, "backend"));
    try {
      const bun = fakeBun(root, JSON.stringify([{ severity: "warning", title: "Home port", text: "3000 is busy." }]));
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; run_install_preflight "${bun}" "${root}/backend" 3000 && echo PASSED`]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("PASSED");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a missing backend or Bun is named, not a bare cd error", () => {
    const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; run_install_preflight /nonexistent/bun /nonexistent/backend 3000`]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("/nonexistent/bun is missing");
  });
});

describe("main() step order (Mac Studio install audit, 2026-10-16)", () => {
  // Every step that touches the network, root, or the system is a stub
  // that appends its name to a trace, so the order main() runs them in
  // is asserted the way a real run would experience it. Two regressions
  // live here: the preflight used to run first, with `bun` from PATH
  // and ../backend beside the script (neither exists under sudo or
  // `curl | bash`), and the port was probed before the old Home was
  // stopped on an upgrade, so every upgrade drifted to 3001.
  function runMain(root: string, extra = "", args: string[] = []) {
    const trace = join(root, "trace");
    const stubs = `
      INSTALL_ROOT_DARWIN="${root}/install"
      t() { echo "$*" >> "${trace}"; }
      detect_os() { echo darwin; }
      detect_arch() { echo arm64; }
      require_root() { t require_root; }
      check_required_tools() { t check_required_tools; }
      check_console_session() { t check_console_session; }
      check_disk_space() { t "check_disk_space $2"; }
      snapshot_data() { t "snapshot_data $2"; }
      clear_quarantine_and_sign() { t clear_quarantine_and_sign; }
      install_log_rotation() { t install_log_rotation; }
      wait_for_url() { t "wait_for_url $1"; }
      print_reboot_note() { t print_reboot_note; }
      latest_tag() { echo v0.1.0; }
      record_setup_plan() { t record_setup_plan; }
      launchctl() { t "launchctl $1"; }
      rsync() { t rsync; }
      fetch_release_source() { t "fetch_release_source $1"; mkdir -p "$2/backend"; }
      find_free_port() { t find_free_port; echo 3000; }
      ensure_bun_system_wide() { t ensure_bun_system_wide; }
      build_app() { t "build_app $1 $2"; }
      run_install_preflight() { t "run_install_preflight $1 $2 $3"; }
      setup_stack() { t setup_stack; mkdir -p "$1/stack"; echo 8771 > "$1/stack/.port"; }
      install_launchd_daemon() { t "install_launchd_daemon $3 $4"; }
      ${extra}
    `;
    const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; ${stubs}
main ${args.join(" ")}`]);
    const lines = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n") : [];
    return { result, lines };
  }

  test("fresh install: Home only. No Stack build, no console-session check, preflight after the build", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-main-order-"));
    try {
      const { result, lines } = runMain(root);
      expect(result.exitCode).toBe(0);
      expect(lines).toEqual([
        "require_root",
        "check_required_tools",
        "check_disk_space 3",
        "record_setup_plan",
        "fetch_release_source v0.1.0",
        "find_free_port",
        "ensure_bun_system_wide",
        "clear_quarantine_and_sign",
        `build_app ${root}/install ${root}/install/.bun/bin/bun`,
        `run_install_preflight ${root}/install/.bun/bin/bun ${root}/install/backend 3000`,
        "install_launchd_daemon 3000 8770",
        "install_log_rotation",
        "wait_for_url http://127.0.0.1:3000/",
      ]);
      expect(existsSync(join(root, "install", "stack"))).toBe(false);
      expect(readFileSync(join(root, "install", ".stack-port-base"), "utf8").trim()).toBe("8770");
      expect(result.stdout.toString()).toContain("The setup wizard asks where the AI runs");
      expect(readFileSync(join(root, "install", ".installed-tag"), "utf8").trim()).toBe("v0.1.0");
      expect(result.stdout.toString()).toContain("http://localhost:3000");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("upgrade: the old Home is stopped before the port is probed", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-main-order-"));
    mkdirSync(join(root, "install"));
    writeFileSync(join(root, "install", ".installed-tag"), "v0.0.9\n");
    try {
      const { result, lines } = runMain(root);
      expect(result.exitCode).toBe(0);
      expect(lines).toContain("check_disk_space 3");
      expect(lines).not.toContain("setup_stack");
      expect(lines).not.toContain("check_console_session");
      expect(lines.indexOf("launchctl bootout")).toBeGreaterThanOrEqual(0);
      expect(lines.indexOf("launchctl bootout")).toBeLessThan(lines.indexOf("find_free_port"));
      expect(lines.indexOf("rsync")).toBeLessThan(lines.indexOf("find_free_port"));
      // The data copy is taken after the stop and before any file is replaced.
      expect(lines.indexOf("snapshot_data v0.0.9")).toBeGreaterThan(lines.indexOf("launchctl bootout"));
      expect(lines.indexOf("snapshot_data v0.0.9")).toBeLessThan(lines.indexOf("rsync"));
      expect(readFileSync(join(root, "install", ".installed-tag"), "utf8").trim()).toBe("v0.1.0");
      expect(readFileSync(join(root, "install", ".previous-tag"), "utf8").trim()).toBe("v0.0.9");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a failed preflight stops before the Stack and before any service", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-main-order-"));
    try {
      const { result, lines } = runMain(root, 'run_install_preflight() { t run_install_preflight; die "This computer did not pass the install checks."; }');
      expect(result.exitCode).toBe(1);
      expect(lines).not.toContain("setup_stack");
      expect(lines.some((line) => line.startsWith("install_launchd_daemon"))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("an upgrade keeps the port the last install used, unless MAIPAI_PORT is set", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-main-order-"));
    mkdirSync(join(root, "install"));
    writeFileSync(join(root, "install", ".installed-tag"), "v0.0.9\n");
    try {
      const stubs = 'previous_home_port() { echo 3010; }; find_free_port() { t "find_free_port $1"; echo "$1"; }';
      const { lines } = runMain(root, stubs);
      expect(lines).toContain("find_free_port 3010");
      const root2 = mkdtempSync(join(tmpdir(), "maipai-main-order-"));
      try {
        mkdirSync(join(root2, "install"));
        writeFileSync(join(root2, "install", ".installed-tag"), "v0.0.9\n");
        const set = runMain(root2, `${stubs}; MAIPAI_PORT=3500; APP_PORT=3500`);
        expect(set.lines).toContain("find_free_port 3500");
      } finally { rmSync(root2, { recursive: true, force: true }); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a failure after the old Home was stopped, before any file changed, starts the old Home again and says so", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-main-order-"));
    mkdirSync(join(root, "install"));
    writeFileSync(join(root, "install", ".installed-tag"), "v0.0.9\n");
    try {
      const { result, lines } = runMain(root, 'fetch_release_source() { return 1; }; restart_home_service() { t restart_home_service; }');
      expect(result.exitCode).toBe(1);
      expect(lines).toContain("restart_home_service");
      expect(lines).not.toContain("rsync");
      const out = result.stdout.toString() + result.stderr.toString();
      expect(out).toContain("could not download");
      expect(out).toContain("Your data was not touched");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a failure after the files were replaced names the rerun and the rollback command", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-main-order-"));
    mkdirSync(join(root, "install"));
    writeFileSync(join(root, "install", ".installed-tag"), "v0.0.9\n");
    writeFileSync(join(root, "install", ".previous-tag"), "v0.0.8\n");
    try {
      const { result } = runMain(root, 'build_app() { die "the build failed"; }');
      expect(result.exitCode).toBe(1);
      const out = result.stdout.toString();
      expect(out).toContain("Your data is safe");
      expect(out).toContain(`sudo bash ${root}/install/scripts/install.sh --rollback`);
      // The unfinished install is not recorded as the installed version.
      expect(readFileSync(join(root, "install", ".installed-tag"), "utf8").trim()).toBe("v0.0.9");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("--rollback installs the previous tag, skips the data copy, restores the old one, and swaps the markers", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-main-order-"));
    mkdirSync(join(root, "install"));
    writeFileSync(join(root, "install", ".installed-tag"), "v0.0.9\n");
    writeFileSync(join(root, "install", ".previous-tag"), "v0.0.8\n");
    try {
      const trace = join(root, "trace");
      const stubs = `
        INSTALL_ROOT_DARWIN="${root}/install"
        t() { echo "$*" >> "${trace}"; }
        detect_os() { echo darwin; }
        detect_arch() { echo arm64; }
        require_root() { :; }; check_required_tools() { :; }; check_console_session() { :; }; check_disk_space() { :; }
        record_setup_plan() { :; }; launchctl() { :; }; rsync() { :; }
        fetch_release_source() { t "fetch $1"; mkdir -p "$2/backend"; }
        snapshot_data() { t snapshot_data; }
        restore_snapshot() { t "restore_snapshot $2"; }
        find_free_port() { echo "$1"; }; ensure_bun_system_wide() { :; }; clear_quarantine_and_sign() { :; }
        build_app() { :; }; run_install_preflight() { :; }
        setup_stack() { :; }; install_launchd_daemon() { :; }; install_log_rotation() { :; }
        wait_for_url() { :; }; print_reboot_note() { :; }
      `;
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; ${stubs}\nmain --rollback`]);
      expect(result.exitCode).toBe(0);
      const lines = readFileSync(trace, "utf8").trim().split("\n");
      expect(lines).toEqual(["fetch v0.0.8", "restore_snapshot v0.0.8"]);
      expect(readFileSync(join(root, "install", ".installed-tag"), "utf8").trim()).toBe("v0.0.8");
      expect(readFileSync(join(root, "install", ".previous-tag"), "utf8").trim()).toBe("v0.0.9");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("--rollback with no earlier version stops with a plain message before touching anything", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-main-order-"));
    try {
      const { result, lines } = runMain(root, "", ["--rollback"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("there is no earlier version to go back to");
      expect(lines).not.toContain("rsync");
      expect(lines).not.toContain("snapshot_data v0.0.9");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("--version installs that release and not the latest one", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-main-order-"));
    try {
      const { result, lines } = runMain(root, "", ["--version", "v0.0.5"]);
      expect(result.exitCode).toBe(0);
      expect(lines).toContain("fetch_release_source v0.0.5");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a resumed install (folder present, never finished) does not take an upgrade snapshot and is not called an upgrade", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-main-order-"));
    mkdirSync(join(root, "install", "backend"), { recursive: true });
    try {
      const { result, lines } = runMain(root);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("did not finish - continuing");
      expect(lines).toContain("check_disk_space 3");
      expect(lines.some((line) => line.startsWith("snapshot_data"))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a bad MAIPAI_PORT or MAIPAI_STACK_PORT stops with the fix", () => {
    for (const [name, message] of [["MAIPAI_PORT", "MAIPAI_PORT is 'abc'"], ["MAIPAI_STACK_PORT", "MAIPAI_STACK_PORT is 'abc'"]] as const) {
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; main --dry-run`], { env: { ...process.env, [name]: "abc" } });
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(message);
      expect(result.stderr.toString()).toContain("Set it to a number from 1 to 65535");
    }
  });
});

describe("macOS install checks (Mac Studio audit, 2026-10-16)", () => {
  const bash = (script: string, env: Record<string, string> = {}) =>
    Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; ${script}`], { env: { ...process.env, ...env } });

  test("valid_port and valid_release_tag", () => {
    expect(bash("valid_port 3000 && valid_port 65535 && ! valid_port 0 && ! valid_port 70000 && ! valid_port abc && ! valid_port ''").exitCode).toBe(0);
    expect(bash("valid_release_tag v0.1.0 && valid_release_tag v1.2.3-rc1 && ! valid_release_tag main && ! valid_release_tag search-assist-weights-v2").exitCode).toBe(0);
  });

  test("missing tools on a Mac point at the Command Line Tools with the exact command", () => {
    const empty = mkdtempSync(join(tmpdir(), "maipai-nopath-"));
    try {
      const result = Bun.spawnSync(["/bin/bash", "-c", `source "${INSTALL_SH}"; check_required_tools darwin`], { env: { PATH: empty } });
      expect(result.exitCode).toBe(1);
      const err = result.stderr.toString();
      expect(err).toContain("xcode-select --install");
      expect(err).toContain("curl");
      expect(err).toContain("run this installer again");
    } finally { rmSync(empty, { recursive: true, force: true }); }
  });

  test("with every tool present the check passes (this machine)", () => {
    expect(bash("check_required_tools darwin").exitCode).toBe(0);
  });

  test("the Stack build never needs python3 or Homebrew", () => {
    const text = readFileSync(INSTALL_SH, "utf8");
    expect(text).not.toContain("python3");
    expect(text).not.toMatch(/\bbrew\b/);
    expect(text).toContain("SKIP_VERIFY=1");
  });

  test("headless Mac: no console user stops with the reason and the command to run at the Mac's own screen", () => {
    const result = bash('find_console_user() { echo ""; }; check_console_session darwin');
    expect(result.exitCode).toBe(1);
    const out = result.stdout.toString() + result.stderr.toString();
    expect(out).toContain("nobody is logged in at this Mac's own screen");
    expect(out).toContain("run the installer again.");
  });

  test("a console user with no desktop session is also stopped", () => {
    const result = bash('find_console_user() { echo marlow; }; id() { echo 501; }; launchctl() { return 113; }; check_console_session darwin');
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain("marlow is the console user but has no desktop session");
  });

  test("a logged-in console user passes, and Linux is never asked", () => {
    expect(bash('find_console_user() { echo marlow; }; id() { echo 501; }; launchctl() { return 0; }; check_console_session darwin').exitCode).toBe(0);
    expect(bash("check_console_session linux").exitCode).toBe(0);
  });

  test("run_as_console_user joins the user's login session and sets HOME on macOS", () => {
    const result = bash('id() { echo 501; }; dscl() { echo "NFSHomeDirectory: /Users/marlow"; }; launchctl() { echo "launchctl $*"; }; sudo() { echo "sudo $*"; }; run_as_console_user darwin marlow STACK_DATA_DIR=/d /bin/x install-service');
    const out = result.stdout.toString();
    expect(out).toContain("launchctl asuser 501 sudo -u marlow env HOME=/Users/marlow STACK_DATA_DIR=/d /bin/x install-service");
  });

  test("the Home bring-up needs 3 GB and the AI engine step 6 GB, not the plan's models", () => {
    expect(bash("echo $HOME_REQUIRED_GB $STACK_REQUIRED_GB").stdout.toString().trim()).toBe("3 6");
  });

  test("too little free disk stops with the amount and what to do", () => {
    const result = bash('free_gb_at() { echo 2; }; check_disk_space /usr/local/maipai-home 3 Home || true; echo "problem=$DISK_PROBLEM"');
    const out = result.stdout.toString() + result.stderr.toString();
    expect(out).toContain("2 GB free");
    expect(out).toContain("Home needs 3 GB");
    expect(out).toContain("problem=This computer has 2 GB free");
    expect(bash("free_gb_at() { echo 2; }; check_disk_space /x 3 Home").exitCode).toBe(1);
  });

  test("enough free disk passes", () => {
    expect(bash("free_gb_at() { echo 30; }; check_disk_space /x 3 Home").exitCode).toBe(0);
    expect(bash("free_gb_at() { echo 3; }; check_disk_space /x 3 Home").exitCode).toBe(0);
  });

  test("free_gb_at reads the nearest folder that exists", () => {
    const out = bash("free_gb_at /definitely/not/here/yet").stdout.toString().trim();
    expect(Number(out)).toBeGreaterThan(0);
  });

  test("quarantine is cleared and an unsigned binary is signed on macOS only", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-sign-"));
    const log = join(dir, "calls");
    const stubs = `xattr() { echo "xattr $*" >> "${log}"; }; codesign() { echo "codesign $*" >> "${log}"; case "$1" in --verify) return 1;; esac; }`;
    const bin = join(dir, "bin");
    writeFileSync(bin, "", { mode: 0o755 });
    try {
      bash(`${stubs}; clear_quarantine_and_sign darwin "${dir}" "${bin}" "${dir}/missing"`);
      const mac = readFileSync(log, "utf8");
      expect(mac).toContain(`xattr -dr com.apple.quarantine ${dir}`);
      expect(mac).toContain(`codesign --force --sign - ${bin}`);
      expect(mac).not.toContain("missing");
      rmSync(log);
      bash(`${stubs}; clear_quarantine_and_sign linux "${dir}" "${bin}"`);
      expect(existsSync(log)).toBe(false);
      bash(`xattr() { :; }; codesign() { echo "codesign $*" >> "${log}"; return 0; }; clear_quarantine_and_sign darwin "${dir}" "${bin}"`);
      expect(readFileSync(log, "utf8")).toBe(`codesign --verify ${bin}\n`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("wait_for_url answers, and times out with the URL named", () => {
    expect(bash("curl() { return 0; }; wait_for_url http://127.0.0.1:3000/ Home 3").stdout.toString()).toContain("Home is answering at http://127.0.0.1:3000/");
    const fail = bash("curl() { return 22; }; sleep() { :; }; wait_for_url http://127.0.0.1:3000/ Home 2");
    expect(fail.exitCode).toBe(1);
    expect(fail.stdout.toString()).toContain("Home did not answer at http://127.0.0.1:3000/ in time");
  });

  test("previous_home_port reads the port back from the launchd file and the systemd unit", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-prev-"));
    try {
      writeFileSync(join(dir, "p.plist"), "<dict>\n    <key>PORT</key><string>3010</string>\n</dict>\n");
      writeFileSync(join(dir, "u.service"), "[Service]\nEnvironment=PORT=3020\n");
      expect(bash("previous_home_port darwin", { HOME_PLIST: join(dir, "p.plist") }).stdout.toString().trim()).toBe("3010");
      expect(bash("previous_home_port linux", { HOME_UNIT: join(dir, "u.service") }).stdout.toString().trim()).toBe("3020");
      expect(bash("previous_home_port darwin", { HOME_PLIST: join(dir, "none") }).stdout.toString().trim()).toBe("");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("the reboot note says the Stack waits for login, and mentions automatic login and FileVault", () => {
    const out = bash('defaults() { return 1; }; fdesetup() { echo "FileVault is On."; }; print_reboot_note darwin').stdout.toString();
    expect(out).toContain("The MaiPai Stack starts when the Mac's user logs in");
    expect(out).toContain("Automatic login");
    expect(out).toContain("FileVault is on");
    expect(bash("print_reboot_note linux").stdout.toString()).toContain("both start by themselves");
  });
});

describe("Home service files carry both ports", () => {
  test("the launchd plist sets PORT, MAIPAI_STACK_PORT and keeps Home running after a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-plist-"));
    try {
      const plist = join(dir, "com.maipai.home.plist");
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; launchctl() { :; }; install_launchd_daemon "${dir}/app" /bun 3010 8771`], { env: { ...process.env, HOME_PLIST: plist } });
      expect(result.exitCode).toBe(0);
      const text = readFileSync(plist, "utf8");
      expect(text).toContain("<key>PORT</key><string>3010</string>");
      expect(text).toContain("<key>MAIPAI_STACK_PORT</key><string>8771</string>");
      expect(text).toContain("<key>RunAtLoad</key><true/>");
      expect(text).toContain("<key>KeepAlive</key><true/>");
      expect(text).toContain(`${dir}/app/data/logs/launchd.err.log`);
      expect(text).toContain(`<key>DENO_DIR</key><string>${dir}/app/data/deno</string>`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("the installer fills the Deno cache the service reads, one package test at a time", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-deno-prime-"));
    try {
      mkdirSync(join(dir, "app/backend/packages/a"), { recursive: true });
      mkdirSync(join(dir, "app/backend/packages/b"), { recursive: true });
      writeFileSync(join(dir, "app/backend/packages/a/handler_test.ts"), "");
      writeFileSync(join(dir, "app/backend/packages/b/handler_test.ts"), "");
      mkdirSync(join(dir, "bin"));
      const fake = join(dir, "bin/deno");
      writeFileSync(fake, `#!/bin/bash\necho "$DENO_DIR $*" >> "${dir}/calls"\n`, { mode: 0o755 });
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; prime_deno_cache "${dir}/app"`], { env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}` } });
      expect(result.exitCode).toBe(0);
      const calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
      expect(calls).toHaveLength(2);
      for (const call of calls) expect(call).toStartWith(`${dir}/app/data/deno cache `);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("without Deno the installer says what stays off and does not fail", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-deno-missing-"));
    try {
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; PATH=/usr/bin:/bin; prime_deno_cache "${dir}/app"`]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString() + result.stderr.toString()).toContain("Deno is not installed");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("dry-run names the pinned Deno download, its digest and where it lands", () => {
    const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; ensure_deno /opt/maipai-home darwin arm64 yes`]);
    const out = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(out).toContain("[dry-run] would install Deno 2.9.7 (sha256 5cd46d6268f6f78f5d88bdc7159d20bd44cdaa4b3303474839f87ec6fe7ae25c)");
    expect(out).toContain("https://github.com/denoland/deno/releases/download/v2.9.7/deno-aarch64-apple-darwin.zip into /opt/maipai-home/.deno/bin/deno");
  });

  test("a Deno of the pinned version already in place is left alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-deno-have-"));
    try {
      mkdirSync(join(dir, ".deno/bin"), { recursive: true });
      writeFileSync(join(dir, ".deno/bin/deno"), '#!/bin/bash\necho "deno 2.9.7 (stable, release, test)"\n', { mode: 0o755 });
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; curl() { echo called >> "${dir}/curl-calls"; return 1; }; ensure_deno "${dir}" darwin arm64`]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(dir, "curl-calls"))).toBe(false);
      expect(result.stdout.toString()).not.toContain("Installing Deno");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a failed Deno download is not fatal and says what to do", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-deno-fail-"));
    try {
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; curl() { return 22; }; ensure_deno "${dir}" linux x64`]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("Could not install Deno 2.9.7");
      expect(result.stdout.toString()).toContain("run the installer again");
      expect(existsSync(join(dir, ".deno/bin/deno"))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a download whose checksum does not match is rejected", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-deno-bad-"));
    try {
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; curl() { while [ $# -gt 0 ]; do [ "$1" = -o ] && echo junk > "$2"; shift; done; }; ensure_deno "${dir}" linux arm64`]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("Could not install Deno");
      expect(existsSync(join(dir, ".deno/bin/deno"))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("the service units put the install's own Deno on PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-deno-path-"));
    try {
      const plist = join(dir, "p.plist");
      Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; launchctl() { :; }; install_launchd_daemon "${dir}/app" /bun/bin/bun 3000`], { env: { ...process.env, HOME_PLIST: plist } });
      expect(readFileSync(plist, "utf8")).toContain(`${dir}/app/.deno/bin:/usr/local/bin`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("without a Stack port argument the default is used", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-plist-"));
    try {
      const plist = join(dir, "p.plist");
      Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; launchctl() { :; }; install_launchd_daemon "${dir}/app" /bun 3000`], { env: { ...process.env, HOME_PLIST: plist, MAIPAI_STACK_PORT: "9100" } });
      expect(readFileSync(plist, "utf8")).toContain("<key>MAIPAI_STACK_PORT</key><string>9100</string>");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("the dry run shows a moved Stack port everywhere it is used", () => {
    const result = Bun.spawnSync(["bash", "scripts/install.sh", "--stack-only", "--dry-run"], { cwd: join(import.meta.dir, ".."), env: { ...process.env, MAIPAI_STACK_PORT: "9100" } });
    const out = result.stdout.toString();
    expect(out).toContain("PORT=9100");
    expect(out).toContain("would poll http://127.0.0.1:9100/healthz");
    expect(out).not.toContain("8770");
  });
});

describe("upgrade data copy and rollback", () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "maipai-snap-"));
    mkdirSync(join(root, "data", "logs"), { recursive: true });
    writeFileSync(join(root, "data", "home.db"), "v1 data");
    writeFileSync(join(root, "data", "logs", "big.log"), "log");
    return root;
  }
  const bash = (script: string) => Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; ${script}`]);

  test("snapshot_data saves data/ (not logs) under upgrade-backups, named for the version it came from", () => {
    const root = fixture();
    try {
      expect(bash(`snapshot_data "${root}" v0.0.9`).exitCode).toBe(0);
      const names = readdirSync(join(root, "upgrade-backups"));
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(/^\d{8}-\d{6}-from-v0\.0\.9$/);
      const listing = Bun.spawnSync(["tar", "-tzf", join(root, "upgrade-backups", names[0] as string, "data.tar.gz")]).stdout.toString();
      expect(listing).toContain("data/home.db");
      expect(listing).not.toContain("big.log");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("only the newest two copies are kept", () => {
    const root = fixture();
    try {
      for (const name of ["20260101-000000-from-v1", "20260102-000000-from-v2", "20260103-000000-from-v3", "20260104-000000-from-v4"]) {
        mkdirSync(join(root, "upgrade-backups", name), { recursive: true });
      }
      bash(`prune_snapshots "${root}/upgrade-backups"`);
      expect(readdirSync(join(root, "upgrade-backups")).sort()).toEqual(["20260103-000000-from-v3", "20260104-000000-from-v4"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("restore_snapshot puts the old data back and keeps the newer data aside", () => {
    const root = fixture();
    try {
      bash(`snapshot_data "${root}" v0.0.9`);
      writeFileSync(join(root, "data", "home.db"), "v2 data");
      const result = bash(`restore_snapshot "${root}" v0.0.9`);
      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(root, "data", "home.db"), "utf8")).toBe("v1 data");
      const aside = readdirSync(root).find((n) => n.startsWith("data.rolled-back-"));
      expect(aside).toBeDefined();
      expect(readFileSync(join(root, aside as string, "home.db"), "utf8")).toBe("v2 data");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("restore_snapshot with no copy for that version leaves the data alone and says so", () => {
    const root = fixture();
    try {
      const result = bash(`restore_snapshot "${root}" v9.9.9`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("There is no saved data copy from v9.9.9");
      expect(readFileSync(join(root, "data", "home.db"), "utf8")).toBe("v1 data");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a rebuild of the Stack never touches stack/data", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-stack-keep-"));
    mkdirSync(join(root, "stack", "data"), { recursive: true });
    writeFileSync(join(root, "stack", "data", "models.keep"), "model");
    const script = [
      `fetch_stack_source() { :; }`,
      `fetch_stack_commons() { :; }`,
      // Same behavior as the Stack's build-binary.sh: it deletes its OUT_DIR first.
      `build_stack_binary() { rm -rf "$2"; mkdir -p "$2/migrations" "$2/backend-src"; : > "$2/maipai-stack-darwin-arm64"; }`,
      `install_stack_service() { :; }`,
      `setup_stack "${root}" /bun darwin arm64 no`,
    ].join("; ");
    try {
      const result = bash(script);
      expect(result.exitCode, result.stdout.toString()).toBe(0);
      expect(readFileSync(join(root, "stack", "data", "models.keep"), "utf8")).toBe("model");
      expect(existsSync(join(root, "stack", "maipai-stack-darwin-arm64"))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("rotate-logs.sh", () => {
  const ROTATE = join(import.meta.dir, "rotate-logs.sh");

  test("a log over the limit is copied to .1 and emptied; shifts older copies; keeps three", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-rotate-"));
    const logs = join(root, "data", "logs");
    mkdirSync(logs, { recursive: true });
    mkdirSync(join(root, "stack", "data", "logs"), { recursive: true });
    try {
      writeFileSync(join(logs, "launchd.out.log"), "x".repeat(2 * 1024 * 1024));
      writeFileSync(join(logs, "launchd.out.log.1"), "older1");
      writeFileSync(join(logs, "launchd.out.log.2"), "older2");
      writeFileSync(join(logs, "small.log"), "tiny");
      writeFileSync(join(root, "stack", "data", "logs", "stack.log"), "y".repeat(2 * 1024 * 1024));
      const result = Bun.spawnSync(["bash", ROTATE, root], { env: { ...process.env, LOG_MAX_MB: "1" } });
      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(logs, "launchd.out.log"), "utf8")).toBe("");
      expect(readFileSync(join(logs, "launchd.out.log.1"), "utf8")).toHaveLength(2 * 1024 * 1024);
      expect(readFileSync(join(logs, "launchd.out.log.2"), "utf8")).toBe("older1");
      expect(readFileSync(join(logs, "launchd.out.log.3"), "utf8")).toBe("older2");
      expect(readFileSync(join(logs, "small.log"), "utf8")).toBe("tiny");
      expect(readFileSync(join(root, "stack", "data", "logs", "stack.log"), "utf8")).toBe("");
      expect(existsSync(join(root, "stack", "data", "logs", "stack.log.1"))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("no folder argument or a bad LOG_MAX_MB stops with the fix", () => {
    const none = Bun.spawnSync(["bash", ROTATE]);
    expect(none.exitCode).toBe(1);
    expect(none.stderr.toString()).toContain("give the MaiPai install folder");
    const bad = Bun.spawnSync(["bash", ROTATE, "/tmp"], { env: { ...process.env, LOG_MAX_MB: "lots" } });
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr.toString()).toContain("LOG_MAX_MB must be a whole number");
  });

  test("install_log_rotation writes a daily daemon that runs the script with the install folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-lr-"));
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "rotate-logs.sh"), "");
    try {
      const plist = join(dir, "lr.plist");
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; launchctl() { :; }; install_log_rotation darwin "${dir}"`], { env: { ...process.env, LOGROTATE_PLIST: plist } });
      expect(result.exitCode).toBe(0);
      const text = readFileSync(plist, "utf8");
      expect(text).toContain("com.maipai.logrotate");
      expect(text).toContain(`<string>${dir}/scripts/rotate-logs.sh</string>`);
      expect(text).toContain("StartCalendarInterval");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("uninstall.sh removes the log rotation daemon and offers the upgrade copies with the data", () => {
    const text = readFileSync(join(import.meta.dir, "uninstall.sh"), "utf8");
    expect(text).toContain("com.maipai.logrotate.plist");
    expect(text).toContain("upgrade-backups");
    expect(text).toContain("DELETE MY DATA");
    expect(Bun.spawnSync(["bash", "-n", join(import.meta.dir, "uninstall.sh")]).exitCode).toBe(0);
  });
});

describe("Home-first install: the Stack step is its own run (INSTALL-SPLIT-01)", () => {
  function tmp(): string {
    return mkdtempSync(join(tmpdir(), "install-split-"));
  }

  test("stack_status writes the small JSON the backend reads, with quotes escaped", () => {
    const dir = tmp();
    const file = join(dir, "data", "stack-install.json");
    const r = bashCall(`STACK_STATUS_FILE="${file}"; stack_status running building 'say "hi"
there'`);
    expect(r.exitCode).toBe(0);
    const json = JSON.parse(readFileSync(file, "utf8"));
    expect(json.state).toBe("running");
    expect(json.stage).toBe("building");
    expect(json.problem).toBe('say "hi" there');
    expect(typeof json.pid).toBe("number");
    expect(typeof json.updatedAt).toBe("string");
    rmSync(dir, { recursive: true, force: true });
  });

  test("stack_status does nothing when no status file is set (the upgrade path)", () => {
    expect(bashCall("unset STACK_STATUS_FILE; stack_status running building").exitCode).toBe(0);
  });

  test("a failed Stack step leaves state failed with the plain-words problem", () => {
    const dir = tmp();
    const file = join(dir, "s.json");
    const r = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; STACK_STATUS_FILE="${file}"; trap on_stack_exit EXIT; STACK_PROBLEM="Out of room. Free space, then press Try again."; exit 3`]);
    expect(r.exitCode).toBe(3);
    const json = JSON.parse(readFileSync(file, "utf8"));
    expect(json.state).toBe("failed");
    expect(json.problem).toBe("Out of room. Free space, then press Try again.");
    rmSync(dir, { recursive: true, force: true });
  });

  test("a failed Stack step with no named cause still says what to do", () => {
    const dir = tmp();
    const file = join(dir, "s.json");
    Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; STACK_STATUS_FILE="${file}"; trap on_stack_exit EXIT; exit 1`]);
    expect(JSON.parse(readFileSync(file, "utf8")).problem).toContain("Try again");
    rmSync(dir, { recursive: true, force: true });
  });

  test("a finished Stack step is not overwritten by the exit trap", () => {
    const dir = tmp();
    const file = join(dir, "s.json");
    Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; STACK_STATUS_FILE="${file}"; trap on_stack_exit EXIT; stack_status ready; STACK_DONE=yes`]);
    expect(JSON.parse(readFileSync(file, "utf8")).state).toBe("ready");
    rmSync(dir, { recursive: true, force: true });
  });

  test("--stack-only refuses to combine with --rollback, --version or --engine-computer", () => {
    for (const extra of [["--rollback"], ["--version", "v1.0.0"], ["--engine-computer"]]) {
      const r = Bun.spawnSync(["bash", INSTALL_SH, "--stack-only", "--dry-run", ...extra]);
      expect(r.exitCode).not.toBe(0);
    }
  });

  test("the Home-only dry run names the wizard as the way the AI engine gets installed", () => {
    const { stdout, exitCode } = runScript(["--dry-run"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("[dry-run] MaiPai Home install plan for");
    expect(stdout).toContain("setup wizard installs it");
    expect(stdout).not.toContain("STACK_TAG=");
  });

  test("the Linux Stack step unit and sudoers rule allow exactly one command, no wildcard", () => {
    const dir = tmp();
    const unit = join(dir, "unit");
    const rule = join(dir, "rule");
    const r = bashCall(`STACK_STEP_UNIT_FILE="${unit}"; SUDOERS_FILE="${rule}"; systemctl() { :; }; chown() { :; }; visudo() { return 0; }; install() { cp "$5" "$7" 2>/dev/null || cp "\${@: -2:1}" "\${@: -1}"; }; install_stack_step_unit "${dir}/home"`);
    expect(r.exitCode).toBe(0);
    const u = readFileSync(unit, "utf8");
    expect(u).toContain("Type=oneshot");
    expect(u).toContain("User=root");
    expect(u).toContain(`ExecStart=/bin/bash ${dir}/home/scripts/install.sh --stack-only`);
    const line = readFileSync(rule, "utf8").trim();
    expect(line).toMatch(/^maipai ALL=\(root\) NOPASSWD: \S*systemctl start --no-block maipai-stack-install\.service$/);
    expect(line).not.toContain("*");
    rmSync(dir, { recursive: true, force: true });
  });

  test("on Linux the person who ran the installer is read from .install-user, and the service account never counts", () => {
    const dir = tmp();
    const file = join(dir, ".install-user");
    writeFileSync(file, "marlow\n");
    expect(bashCall(`INSTALL_USER_FILE="${file}"; find_console_user linux`).stdout).toBe("marlow");
    writeFileSync(file, "maipai\n");
    expect(bashCall(`INSTALL_USER_FILE="${file}"; find_console_user linux`).stdout).toBe("");
    rmSync(dir, { recursive: true, force: true });
  });

  test("the LaunchDaemon lets a running Stack install outlive a Home restart", () => {
    expect(readFileSync(INSTALL_SH, "utf8")).toContain("<key>AbandonProcessGroup</key><true/>");
  });

  test("uninstall removes the Stack step unit and the sudoers rule, and copes with no Stack", () => {
    const text = readFileSync(join(import.meta.dir, "uninstall.sh"), "utf8");
    expect(text).toContain("STACK_STEP_UNIT");
    expect(text).toContain("/etc/sudoers.d/maipai-home");
  });
});
