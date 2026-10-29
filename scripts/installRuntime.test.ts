import { describe, test, expect, setDefaultTimeout } from "bun:test";
setDefaultTimeout(30_000);
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import * as installFixtures from "./installFixtures";
const { INSTALL_SH, ENGINE_HELPER, PAIR_RESPONSE, readChild, startPairServer, stopPairServer, bashCall, runScript } = installFixtures;

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
    const build = buildFails ? "exit 1" : 'mkdir -p "$OUT_DIR/migrations" "$OUT_DIR/backend-src" "$OUT_DIR/ort-wasm" && : > "$OUT_DIR/maipai-stack-linux-x64"';
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

