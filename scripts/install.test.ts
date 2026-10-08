import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
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

async function startPairServer(body: Record<string, string>, expectedPath?: string) {
  const source = `
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
      const path = new URL(request.url).pathname;
      if (process.env.EXPECTED_PATH && path !== process.env.EXPECTED_PATH) return new Response("wrong path", { status: 404 });
      return Response.json(JSON.parse(process.env.RESPONSE_BODY));
    }});
    console.log(server.port);
    process.on("SIGTERM", () => { server.stop(true); process.exit(0); });
  `;
  const child = Bun.spawn(["bun", "-e", source], {
    env: { ...process.env, RESPONSE_BODY: JSON.stringify(body), EXPECTED_PATH: expectedPath ?? "" },
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
  test("lays the pinned, checksummed core workspace beside Stack using an offline mocked download", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-stack-commons-layout-"));
    const archiveRoot = join(root, "archive", "commons-core-v0.1.0", "core");
    const workspace = join(root, "workspace");
    const stackDir = join(workspace, "stack");
    const commonsDir = join(workspace, "commons");
    const archive = join(root, "commons.tar.gz");
    mkdirSync(archiveRoot, { recursive: true });
    mkdirSync(join(stackDir, "backend"), { recursive: true });
    writeFileSync(join(archiveRoot, "package.json"), JSON.stringify({ name: "@maipai/core", version: "0.1.0" }));
    const packed = Bun.spawnSync(["tar", "-czf", archive, "-C", join(root, "archive"), "commons-core-v0.1.0"]);
    expect(packed.exitCode).toBe(0);
    const digestResult = Bun.spawnSync(["shasum", "-a", "256", archive]);
    expect(digestResult.exitCode).toBe(0);
    const digest = digestResult.stdout.toString().split(/\s+/)[0];
    const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; curl() { cp "$FIXTURE_ARCHIVE" "$4"; }; commons_core_sha256() { printf '%s\\n' "$EXPECTED_SHA"; }; fetch_stack_commons "$COMMONS_DEST" no`], {
      env: { ...process.env, FIXTURE_ARCHIVE: archive, EXPECTED_SHA: digest, COMMONS_DEST: commonsDir },
    });
    try {
      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(commonsDir, "core", "package.json"), "utf8")).toContain('"version":"0.1.0"');
      expect(join(stackDir, "backend", "../../commons/core")).toBe(join(commonsDir, "core"));
      expect(readFileSync(join(commonsDir, "core", "package.json"), "utf8")).toContain('"name":"@maipai/core"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("dry-run prints the pinned Commons tag and verified archive digest without fetching", () => {
    const result = bashCall('fetch_stack_commons /tmp/maipai-stack/commons yes');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("getmaipai/commons@core-v0.1.0");
    expect(result.stdout).toContain("d3c60aec818e73c00079e5a819d86477ecb590a0172f214a0aee80890d8427f4");
    expect(result.stdout).toContain("/tmp/maipai-stack/commons/core");
  });

  test("setup_stack dry-run does not create its scratch tree", () => {
    const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; mktemp() { echo "mktemp called during dry-run" >&2; return 1; }; setup_stack /opt/maipai-home /opt/maipai-home/.bun/bin/bun linux x64 yes`]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).not.toContain("mktemp called during dry-run");
    expect(result.stdout.toString()).toContain("would fetch getmaipai/commons@core-v0.1.0");
    expect(result.stdout.toString()).toContain("scripts/build-binary.sh");
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
    expect(stdout).toContain("would fetch getmaipai/commons@core-v0.1.0");
    expect(stdout).toContain("d3c60aec818e73c00079e5a819d86477ecb590a0172f214a0aee80890d8427f4");
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
