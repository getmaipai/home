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
      "@maipai/spec": "file:../../commons-tags/spec-spec-v0.1.95/spec",
      zod: "^4.0.0",
    },
  }, null, 2);

  // One fixture archive per Commons tag, shaped like GitHub's: commons-<tag>/<package>/package.json.
  function commonsFixture(root: string): { digests: Record<string, string>; dir: string } {
    const digests: Record<string, string> = {};
    for (const [pkg, tag] of [["core", "core-v0.1.0"], ["spec", "spec-v0.1.95"]] as const) {
      const pkgDir = join(root, "archive", pkg, `commons-${tag}`, pkg);
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: `@maipai/${pkg}`, version: "0.0.1" }));
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
    return Bun.spawnSync(["bash", "-c", `source "${script}"; curl() { case "$2" in *core-v0.1.0*) cp "$ROOT/core-v0.1.0.tar.gz" "$4";; *spec-v0.1.95*) cp "$ROOT/spec-v0.1.95.tar.gz" "$4";; *) return 22;; esac; }; commons_archive_sha256() { case "$1" in core-v0.1.0) echo "$CORE_SHA";; spec-v0.1.95) echo "$SPEC_SHA";; *) return 1;; esac; }; fetch_stack_commons "$WORKSPACE" no`], {
      env: { ...process.env, ROOT: root, CORE_SHA: digests["core-v0.1.0"]!, SPEC_SHA: digests["spec-v0.1.95"]!, WORKSPACE: workspace, TMPDIR: root },
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
      Bun.spawnSync(["bash", "-c", `source "${script}"; for t in core-v0.1.0 spec-v0.1.95 other; do commons_archive_sha256 $t || echo none; done; declare -f commons_archive_sha256 stack_commons_deps fetch_one_stack_commons fetch_stack_commons`]).stdout.toString();
    const install = show(INSTALL_SH);
    const engine = show(ENGINE_HELPER);
    expect(install).toContain("d3c60aec818e73c00079e5a819d86477ecb590a0172f214a0aee80890d8427f4");
    expect(install).toContain("42cce9e73007b395cc7f6f742a43f20a6032f7f0baf4da82869affce3c5a9903");
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

  test("dry-run prints the Commons tags and their verified archive digests without fetching", () => {
    const result = bashCall('fetch_stack_commons /tmp/maipai-stack yes');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("core-v0.1.0 sha256 d3c60aec818e73c00079e5a819d86477ecb590a0172f214a0aee80890d8427f4");
    expect(result.stdout).toContain("spec-v0.1.95 sha256 42cce9e73007b395cc7f6f742a43f20a6032f7f0baf4da82869affce3c5a9903");
    expect(result.stdout).toContain("/tmp/maipai-stack/commons-tags/<package>-<tag>/<package>");
  });

  test("maipai-engine update --dry-run names the Stack, both Commons packages and the rebuild", () => {
    const result = Bun.spawnSync(["bash", ENGINE_HELPER, "--dry-run", "update"]);
    expect(result.exitCode).toBe(0);
    const said = result.stdout.toString();
    expect(said).toContain("Would fetch Stack at pinned STACK_TAG");
    expect(said).toContain("core-v0.1.0 and spec-v0.1.95");
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
    ["failed service install", 'find_console_user() { echo marlow; }; chown() { return 0; }; sudo() { return 1; }', "install-service command failed"],
    ["health timeout", 'find_console_user() { echo marlow; }; chown() { return 0; }; sudo() { return 0; }; curl() { return 22; }; sleep() { :; }', "did not answer /healthz in time"],
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
    const { stdout, exitCode } = runScript(["--dry-run"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("[dry-run] MaiPai Stack install plan for");
    expect(stdout).toContain("STACK_TAG=");
    expect(stdout).toMatch(/would fetch getmaipai\/stack@[0-9a-f]+ into/);
    expect(stdout).toContain("would fetch each getmaipai/commons tag named in");
    expect(stdout).toContain("core-v0.1.0 sha256 d3c60aec818e73c00079e5a819d86477ecb590a0172f214a0aee80890d8427f4");
    expect(stdout).toContain("spec-v0.1.95 sha256 42cce9e73007b395cc7f6f742a43f20a6032f7f0baf4da82869affce3c5a9903");
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
    const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; find_free_port() { echo "find_free_port WAS CALLED with: $*" >&2; exit 1; }; main --dry-run`]);
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
      `tar() { case "$*" in *commons-core-v0.1.0*) command mkdir -p "$4/core"; touch "$4/core/package.json";; *commons-spec-v0.1.95*) command mkdir -p "$4/spec"; touch "$4/spec/package.json";; *) command mkdir -p "$4/backend"; printf '%s\\n' '"@maipai/core": "file:../../commons-tags/core-core-v0.1.0/core",' '"@maipai/spec": "file:../../commons-tags/spec-spec-v0.1.95/spec",' > "$4/backend/package.json";; esac; }`,
      `sha256_file() { case "$1" in *commons.tar.gz) echo "FIXTURE";; esac; }`,
      `commons_archive_sha256() { echo FIXTURE; }`,
      `build_stack_binary() { return 0; }`,
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
    expect(result.stdout.toString()).toContain("[dry-run] MaiPai Stack install plan for");
  });
});
