import { describe, test, expect, setDefaultTimeout, afterAll } from "bun:test";
setDefaultTimeout(30_000);
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import * as installFixtures from "./installFixtures";
const { INSTALL_SH, ENGINE_HELPER, PAIR_RESPONSE, readChild, startPairServer, stopPairServer, bashCall, runScript } = installFixtures;

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
      const listing = Bun.spawnSync(["tar", "-tf", join(root, "upgrade-backups", names[0] as string, "data.tar")]).stdout.toString();
      expect(listing).toContain("data/home.db");
      expect(listing).not.toContain("big.log");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("snapshot_data excludes downloaded folders and restore_snapshot brings them back from the set-aside data", () => {
    const root = fixture();
    try {
      mkdirSync(join(root, "data", "reference"), { recursive: true });
      writeFileSync(join(root, "data", "reference", "wikipedia_en_all_maxi.zim"), "x".repeat(20_000));
      writeFileSync(join(root, "data", "reference", "library.xml"), "<library/>");
      expect(bash(`MAIPAI_SNAPSHOT_SKIP_MIN=8k; export MAIPAI_SNAPSHOT_SKIP_MIN; snapshot_data "${root}" v0.0.9`).exitCode).toBe(0);
      const names = readdirSync(join(root, "upgrade-backups"));
      const listing = Bun.spawnSync(["tar", "-tf", join(root, "upgrade-backups", names[0] as string, "data.tar")]).stdout.toString();
      expect(listing).not.toContain("data/reference/");
      expect(readFileSync(join(root, "upgrade-backups", names[0] as string, "excluded.txt"), "utf8")).not.toContain("data/reference/wikipedia_en_all_maxi.zim");
      const restored = bash(`restore_snapshot "${root}" v0.0.9`);
      expect(restored.exitCode).toBe(0);
      expect(restored.stdout.toString()).toContain("Kept reference from the newer data");
      expect(readFileSync(join(root, "data", "reference", "wikipedia_en_all_maxi.zim"), "utf8")).toHaveLength(20_000);
      expect(readFileSync(join(root, "data", "reference", "library.xml"), "utf8")).toBe("<library/>");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("snapshot_data excludes reference and models and logs the skipped directories", () => {
    const root = fixture();
    try {
      mkdirSync(join(root, "data", "reference"), { recursive: true });
      mkdirSync(join(root, "data", "models"), { recursive: true });
      writeFileSync(join(root, "data", "reference", "big.zim"), "zim");
      writeFileSync(join(root, "data", "models", "m.bin"), "model");
      const result = bash(`snapshot_data "${root}" v0.0.9`);
      expect(result.exitCode).toBe(0);
      const snap = join(root, "upgrade-backups", readdirSync(join(root, "upgrade-backups"))[0] as string, "data.tar");
      const listing = Bun.spawnSync(["tar", "-tf", snap]).stdout.toString();
      expect(listing).toContain("data/home.db");
      expect(listing).not.toContain("data/reference/");
      expect(listing).not.toContain("data/models/");
      expect(result.stdout.toString()).toContain("Skipped in the data copy (downloaded again when needed): reference, models");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("snapshot_data is a plain tar, leaves out engines, models and caches, and rollback puts them back (SHIP-BACKUP-01)", () => {
    const root = fixture();
    try {
      for (const d of ["engines/pocket-tts", "models", "cache"]) { mkdirSync(join(root, "data", d), { recursive: true }); writeFileSync(join(root, "data", d, "blob.bin"), "bulk"); }
      expect(bash(`snapshot_data "${root}" v0.0.9`).exitCode).toBe(0);
      const dir = join(root, "upgrade-backups", readdirSync(join(root, "upgrade-backups"))[0] as string);
      expect(existsSync(join(dir, "data.tar"))).toBe(true);
      expect(existsSync(join(dir, "data.tar.gz"))).toBe(false);
      const listing = Bun.spawnSync(["tar", "-tf", join(dir, "data.tar")]).stdout.toString();
      expect(listing).toContain("data/home.db");
      for (const d of ["engines", "models", "cache"]) expect(listing).not.toContain(`data/${d}`);
      expect(bash(`restore_snapshot "${root}" v0.0.9`).exitCode).toBe(0);
      expect(readFileSync(join(root, "data", "home.db"), "utf8")).toBe("v1 data");
      for (const p of ["engines/pocket-tts/blob.bin", "models/blob.bin", "cache/blob.bin"]) expect(readFileSync(join(root, "data", p), "utf8")).toBe("bulk");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("snapshot_data keeps what it copies under MAIPAI_SNAPSHOT_MAX_MB by leaving out the biggest files", () => {
    const root = fixture();
    try {
      writeFileSync(join(root, "data", "big-a.dat"), "x".repeat(3 * 1024 * 1024));
      writeFileSync(join(root, "data", "big-b.dat"), "x".repeat(2 * 1024 * 1024));
      expect(bash(`MAIPAI_SNAPSHOT_MAX_MB=1; export MAIPAI_SNAPSHOT_MAX_MB; snapshot_data "${root}" v0.0.9`).exitCode).toBe(0);
      const dir = join(root, "upgrade-backups", readdirSync(join(root, "upgrade-backups"))[0] as string);
      const listing = Bun.spawnSync(["tar", "-tf", join(dir, "data.tar")]).stdout.toString();
      expect(listing).toContain("data/home.db");
      expect(listing).not.toContain("big-a.dat");
      expect(listing).not.toContain("big-b.dat");
      expect(readFileSync(join(dir, "excluded.txt"), "utf8")).toContain("data/big-a.dat");
      expect(bash(`restore_snapshot "${root}" v0.0.9`).exitCode).toBe(0);
      expect(readFileSync(join(root, "data", "big-a.dat"), "utf8")).toHaveLength(3 * 1024 * 1024);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("restore_snapshot still reads a gzipped copy made before SHIP-BACKUP-01", () => {
    const root = fixture();
    try {
      const dir = join(root, "upgrade-backups", "20260101-000000-from-v1");
      mkdirSync(dir, { recursive: true });
      expect(Bun.spawnSync(["tar", "-czf", join(dir, "data.tar.gz"), "-C", root, "data"]).exitCode).toBe(0);
      writeFileSync(join(root, "data", "home.db"), "newer");
      expect(bash(`restore_snapshot "${root}" v1`).exitCode).toBe(0);
      expect(readFileSync(join(root, "data", "home.db"), "utf8")).toBe("v1 data");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("record_previous_tag points --rollback at the version live before this upgrade", () => {
    const root = fixture();
    try {
      writeFileSync(join(root, ".previous-tag"), "sha-0000001\n");
      expect(bash(`record_previous_tag "${root}" sha-17e1007 sha-06df9c5`).exitCode).toBe(0);
      expect(readFileSync(join(root, ".previous-tag"), "utf8").trim()).toBe("sha-17e1007");
      bash(`record_previous_tag "${root}" sha-06df9c5 sha-06df9c5`);
      bash(`record_previous_tag "${root}" "" sha-06df9c5`);
      expect(readFileSync(join(root, ".previous-tag"), "utf8").trim()).toBe("sha-17e1007");
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
      `build_stack_binary() { rm -rf "$2"; mkdir -p "$2/migrations" "$2/backend-src" "$2/ort-wasm"; : > "$2/maipai-stack-darwin-arm64"; }`,
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


describe("install_maipai_command (MAIPAI-CLI-01)", () => {
  test("copies scripts/maipai to the destination as an executable and records success", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-cli-install-"));
    try {
      mkdirSync(join(root, "scripts"));
      writeFileSync(join(root, "scripts", "maipai"), "#!/bin/bash\necho hi\n");
      const dest = join(root, "bin", "maipai");
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; install_maipai_command "${root}"; echo "$MAIPAI_COMMAND_INSTALLED"`], { env: { ...process.env, MAIPAI_COMMAND_DEST: dest } });
      expect(result.stdout.toString().trim().split("\n").pop()).toBe("yes");
      expect(readFileSync(dest, "utf8")).toContain("echo hi");
      expect(statSync(dest).mode & 0o111).not.toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a missing source or an unwritable destination does not fail the install and says what to do", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-cli-install-"));
    try {
      const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; install_maipai_command "${root}"; echo "status=$?"; echo "$MAIPAI_COMMAND_INSTALLED"`], { env: { ...process.env, MAIPAI_COMMAND_DEST: join(root, "bin", "maipai") } });
      const out = result.stdout.toString();
      expect(out).toContain("status=0");
      expect(out).toContain("Could not install the maipai command");
      expect(out.trim().split("\n").pop()).toBe("no");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// DIRECT-FAST-03: timestamps per phase, the Stack rebuild skipped for an unchanged STACK_TAG, the data copy skipped only on a one-shot direct request.
describe("direct-mode installer speedups (DIRECT-FAST-03)", () => {
  const bash = (script: string, env: Record<string, string> = {}) => Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; ${script}`], { env: { ...process.env, ...env } });
  const scratch = mkdtempSync(join(tmpdir(), "maipai-direct-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const me = process.env.USER ?? Bun.spawnSync(["id", "-un"]).stdout.toString().trim();
  const sha = "a".repeat(40);

  test("phase prints a clock time and the seconds since the installer started", () => {
    const out = bash(`phase "app built"`).stdout.toString().trim();
    expect(out).toMatch(/^\[\d\d:\d\d:\d\d \+\d+s\] phase: app built$/);
  });

  test("stack_build_current: true only for the same STACK_TAG with the binary present; MAIPAI_REBUILD_STACK=1 forces a rebuild", () => {
    const dir = join(scratch, "stack1"); mkdirSync(dir, { recursive: true });
    const name = bash(`render_stack_binary_name linux x64`).stdout.toString().trim();
    const check = (env: Record<string, string> = {}) => bash(`stack_build_current "${dir}" linux x64`, env).exitCode;
    expect(check()).toBe(1); // nothing yet
    writeFileSync(join(dir, ".stack-tag"), `${bash("printf %s \"$STACK_TAG\"").stdout.toString()}\n`);
    expect(check()).toBe(1); // marker but no binary
    writeFileSync(join(dir, name), "#!/bin/sh\n", { mode: 0o755 });
    expect(check()).toBe(0);
    expect(check({ MAIPAI_REBUILD_STACK: "1" })).toBe(1);
    writeFileSync(join(dir, ".stack-tag"), "0000000\n");
    expect(check()).toBe(1); // another tag
  });

  test("setup_stack with reuse skips fetch and build but still runs the service step; without the marker it builds and writes the marker", () => {
    const root = join(scratch, "inst"); const stack = join(root, "stack"); mkdirSync(stack, { recursive: true });
    const name = bash(`render_stack_binary_name linux x64`).stdout.toString().trim();
    const stubs = `fetch_stack_source() { echo FETCH; }; fetch_stack_commons() { echo COMMONS; }; build_stack_binary() { echo BUILD; }; publish_engine_stack_binary() { echo PUBLISH; }; install_stack_service() { echo SERVICE; }; stack_status() { :; }; mktemp() { command mktemp -d "${scratch}/m.XXXXXX"; }`;
    const first = bash(`${stubs}; setup_stack "${root}" /usr/bin/bun linux x64 no reuse`).stdout.toString();
    expect(first).toContain("BUILD"); expect(first).toContain("SERVICE");
    expect(readFileSync(join(stack, ".stack-tag"), "utf8").trim()).toHaveLength(40);
    writeFileSync(join(stack, name), "#!/bin/sh\n", { mode: 0o755 });
    const second = bash(`${stubs}; setup_stack "${root}" /usr/bin/bun linux x64 no reuse`).stdout.toString();
    expect(second).toContain("skipping the rebuild");
    expect(second).toContain("SERVICE");
    for (const word of ["FETCH", "COMMONS", "BUILD", "PUBLISH"]) expect(second).not.toContain(word);
    const forced = bash(`${stubs}; setup_stack "${root}" /usr/bin/bun linux x64 no reuse`, { MAIPAI_REBUILD_STACK: "1" }).stdout.toString();
    expect(forced).toContain("BUILD");
    const wizard = bash(`${stubs}; setup_stack "${root}" /usr/bin/bun linux x64 no`).stdout.toString(); // the wizard's Try again never reuses
    expect(wizard).toContain("BUILD");
  });

  test("a failed publish of a rebuild removes the marker instead of vouching for the old build", () => {
    const root = join(scratch, "inst2"); const stack = join(root, "stack"); mkdirSync(stack, { recursive: true });
    writeFileSync(join(stack, ".stack-tag"), "old\n");
    const stubs = `fetch_stack_source() { :; }; fetch_stack_commons() { :; }; build_stack_binary() { :; }; publish_engine_stack_binary() { return 1; }; install_stack_service() { :; }; stack_status() { :; }; mktemp() { command mktemp -d "${scratch}/m2.XXXXXX"; }`;
    const r = bash(`${stubs}; setup_stack "${root}" /usr/bin/bun linux x64 no`);
    expect(r.exitCode).toBe(1);
    expect(existsSync(join(stack, ".stack-tag"))).toBe(false);
  });

  test("direct_install_requested honors a one-shot request for exactly this commit, once, within 15 minutes, from the console user's file", () => {
    const f = join(scratch, "ship-direct");
    const ask = (want: string, env: Record<string, string> = {}) => bash(`direct_install_requested "${want}"`, { SUDO_USER: me, MAIPAI_SHIP_DIRECT_FILE: f, ...env }).exitCode;
    const now = Math.floor(Date.now() / 1000);
    expect(ask(sha)).toBe(1); // no file: the copy is taken
    writeFileSync(f, `${sha} ${now}\n`);
    expect(ask("b".repeat(40))).toBe(1); // another commit; the file is spent
    expect(existsSync(f)).toBe(false);
    writeFileSync(f, `${sha} ${now - 1000}\n`);
    expect(ask(sha)).toBe(1); // stale
    writeFileSync(f, `${sha} ${now}\n`);
    expect(ask(sha, { SUDO_USER: "" })).toBe(1); // no console user
    writeFileSync(f, `${sha} ${now}\n`);
    expect(ask(sha)).toBe(0);
    expect(existsSync(f)).toBe(false);
    expect(ask(sha)).toBe(1); // read once
  });

  test("after a skipped data copy a rollback leaves the data alone even when an older copy from that tag exists", () => {
    const root = join(scratch, "rb"); mkdirSync(join(root, "data"), { recursive: true }); writeFileSync(join(root, "data", "home.db"), "newer");
    mkdirSync(join(root, "upgrade-backups", "20200101-000000-from-v0.0.9"), { recursive: true });
    writeFileSync(join(root, ".snapshot-skipped"), "v0.0.9\n");
    const r = bash(`restore_snapshot "${root}" v0.0.9`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("data stays as it is");
    expect(readFileSync(join(root, "data", "home.db"), "utf8")).toBe("newer");
    expect(readdirSync(root).some((n) => n.startsWith("data.rolled-back"))).toBe(false);
  });

  test("main skips the copy only through --skip-data-snapshot or the one-shot request; the plain path still takes it", () => {
    const text = readFileSync(INSTALL_SH, "utf8");
    expect(text).toContain('if [ "$skip_snapshot" = "yes" ] || { [ -n "$commit_flag" ] && direct_install_requested "$commit_flag"; }; then');
    expect(text).toMatch(/else\n\s+rm -f "\$\{install_root\}\/\.snapshot-skipped"\n\s+snapshot_data/);
  });
});

// DIRECT-FAST-04: kept dependencies, the .deno and node_modules folders that rsync no longer deletes, and the quarantine walk that skips them.
describe("kept dependencies in direct installs (DIRECT-FAST-04)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "maipai-deps-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const bash = (script: string, env: Record<string, string> = {}) => Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; ${script}`], { env: { ...process.env, ...env } });
  const calls = join(scratch, "bun.calls");
  const fakeBun = join(scratch, "bun");
  writeFileSync(fakeBun, `#!/bin/bash\necho "$PWD :: $*" >> ${JSON.stringify(calls)}\n[[ "$1" == --version ]] && { echo 9.9.9; exit 0; }\n[[ -n "$FAKE_VERIFY_FAIL" && "$*" == *--frozen-lockfile* ]] && exit 1\nif [[ "$1" == install && "$*" != *--frozen-lockfile* ]]; then mkdir -p node_modules; fi\nexit 0\n`, { mode: 0o755 });
  function tree(name: string) {
    const root = join(scratch, name);
    for (const d of ["backend", "frontend", "node_modules", "backend/node_modules", "frontend/node_modules"]) mkdirSync(join(root, d), { recursive: true });
    for (const [f, v] of Object.entries({ "bun.lock": "L1", "package.json": "{}", "backend/package.json": "{}", "frontend/package.json": "{}" })) writeFileSync(join(root, f), v);
    writeFileSync(join(root, "node_modules", "sentinel"), "kept");
    return root;
  }
  const stubs = `fetch_home_commons() { :; }; prime_deno_cache() { :; }`;
  const callLines = () => (existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean) : []);

  test("deps_hash follows the lockfile, every package.json and the Bun version, and nothing else", () => {
    const root = tree("h1"); const h = () => bash(`deps_hash "${root}" "${fakeBun}" darwin arm64`).stdout.toString().trim();
    const base = h(); expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(h()).toBe(base);
    writeFileSync(join(root, "README.md"), "changed"); expect(h()).toBe(base);
    for (const f of ["bun.lock", "package.json", "backend/package.json", "frontend/package.json"]) { const keep = readFileSync(join(root, f), "utf8"); writeFileSync(join(root, f), keep + "x"); expect(h()).not.toBe(base); writeFileSync(join(root, f), keep); }
    expect(bash(`deps_hash "${root}" "${fakeBun}" darwin x64`).stdout.toString().trim()).not.toBe(base);
  });

  test("deps_reusable needs the marker, an equal hash and all three node_modules folders", () => {
    const root = tree("r1"); const ask = () => bash(`deps_reusable "${root}" "${fakeBun}" darwin arm64`).exitCode;
    expect(ask()).toBe(1); // no marker
    writeFileSync(join(root, ".deps-hash"), `${bash(`deps_hash "${root}" "${fakeBun}" darwin arm64`).stdout.toString().trim()}\n`);
    expect(ask()).toBe(0);
    writeFileSync(join(root, "bun.lock"), "L2"); expect(ask()).toBe(1); // lockfile changed: the hash differs
    writeFileSync(join(root, "bun.lock"), "L1"); expect(ask()).toBe(0);
    rmSync(join(root, "frontend", "node_modules"), { recursive: true }); expect(ask()).toBe(1); // a folder is missing
  });

  test("build_app with kept dependencies verifies them in place: no removal, no fresh install, the build still runs", () => {
    const root = tree("b1"); rmSync(calls, { force: true });
    const r = bash(`${stubs}; build_app "${root}" "${fakeBun}" yes HASHNOW`);
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    expect(readFileSync(join(root, "node_modules", "sentinel"), "utf8")).toBe("kept");
    const l = callLines();
    expect(l.some((x) => x.includes("install --frozen-lockfile"))).toBe(true);
    expect(l.some((x) => x.includes("install --production"))).toBe(false);
    expect(l.some((x) => x.endsWith(":: run build"))).toBe(true);
    expect(r.stdout.toString()).toContain("kept and verified");
  });

  test("build_app falls back to the fresh install when the kept dependencies do not verify, and records the hash after it", () => {
    const root = tree("b2"); rmSync(calls, { force: true });
    const r = bash(`${stubs}; build_app "${root}" "${fakeBun}" yes HASHNOW`, { FAKE_VERIFY_FAIL: "1" });
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    expect(existsSync(join(root, "node_modules", "sentinel"))).toBe(false); // removed, then reinstalled by the fake
    const l = callLines();
    expect(l.some((x) => x.includes("install --production"))).toBe(true);
    expect(r.stdout.toString()).toContain("did not verify");
    expect(readFileSync(join(root, ".deps-hash"), "utf8").trim()).toBe("HASHNOW");
  });

  test("build_app without the reuse flag (gated mode, a rollback, a changed hash) always installs fresh", () => {
    const root = tree("b3"); rmSync(calls, { force: true }); writeFileSync(join(root, ".deps-hash"), "OLD\n");
    const r = bash(`${stubs}; build_app "${root}" "${fakeBun}" no HASHNOW`);
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(root, "node_modules", "sentinel"))).toBe(false);
    expect(callLines().some((x) => x.includes("install --production"))).toBe(true);
    expect(readFileSync(join(root, ".deps-hash"), "utf8").trim()).toBe("HASHNOW");
  });

  test("a failed fresh install leaves no hash behind, so the next ship cannot trust half a tree", () => {
    const root = tree("b4"); writeFileSync(join(root, ".deps-hash"), "OLD\n");
    const failing = join(scratch, "bun-fail"); writeFileSync(failing, "#!/bin/bash\n[[ \"$1\" == --version ]] && { echo 1; exit 0; }\nexit 1\n", { mode: 0o755 });
    const r = bash(`${stubs}; build_app "${root}" "${failing}" no HASHNOW`);
    expect(r.exitCode).not.toBe(0);
    expect(existsSync(join(root, ".deps-hash"))).toBe(false);
  });

  test("the quarantine walk skips node_modules only when dependencies are kept", () => {
    const root = tree("q1"); for (const d of ["docs", "data", ".deno", ".bun"]) mkdirSync(join(root, d), { recursive: true });
    const log = join(scratch, "xattr.calls"); rmSync(log, { force: true });
    const run = (reuse: string) => bash(`xattr() { echo "$*" >> ${JSON.stringify(log)}; }; INSTALL_DEPS_REUSE=${reuse} clear_quarantine_and_sign darwin "${root}"`);
    run("yes"); const kept = readFileSync(log, "utf8");
    expect(kept).toContain(join(root, "docs")); expect(kept).not.toContain(join(root, "data")); expect(kept).not.toContain(join(root, ".deno")); expect(kept.split("\n").filter((l) => l.endsWith(`${root}/node_modules`))).toEqual([]);
    rmSync(log, { force: true }); run("no");
    expect(readFileSync(log, "utf8").trim()).toBe(`-dr com.apple.quarantine ${root}`);
  });

  test("DIRECT-FAST-08: a direct install's quarantine walk skips the Stack, data, rolled-back data, backups and kept folders; other installs walk the whole root", () => {
    const root = tree("q2"); const dirs = ["docs", "stack", "data", "data.rolled-back-20261027-195415", "backups", "received-backups", "upgrade-backups", "data-scratch", ".deno", ".bun", "scripts"];
    for (const d of dirs) mkdirSync(join(root, d), { recursive: true });
    const log = join(scratch, "xattr2.calls"); rmSync(log, { force: true });
    const run = (env: string) => bash(`xattr() { echo "$*" >> ${JSON.stringify(log)}; }; ${env} clear_quarantine_and_sign darwin "${root}"`);
    run("INSTALL_QUARANTINE_LIGHT=yes"); const walked = readFileSync(log, "utf8").trim().split("\n").map((l) => l.replace("-dr com.apple.quarantine ", ""));
    expect(walked.sort()).toEqual(["backend", "bun.lock", "docs", "frontend", "package.json", "scripts"].map((n) => join(root, n)).sort());
    rmSync(log, { force: true }); run("INSTALL_QUARANTINE_LIGHT=no");
    expect(readFileSync(log, "utf8").trim()).toBe(`-dr com.apple.quarantine ${root}`);
    expect(readFileSync(INSTALL_SH, "utf8")).toContain('INSTALL_QUARANTINE_LIGHT="$direct_install" clear_quarantine_and_sign');
  });

  test("rsync keeps .deno, the root node_modules and the hash marker, and main wires the reuse decision to the direct request only", () => {
    const text = readFileSync(INSTALL_SH, "utf8");
    for (const keep of ["--exclude=/.deno", "--exclude=/node_modules", "--exclude=/.deps-hash"]) expect(text).toContain(keep);
    expect(text).toContain('if [ "$direct_install" = "yes" ] && deps_reusable');
    expect(text).toContain('if [ "$direct_install" = "yes" ]; then\n        log "Direct mode: the data copy');
  });

  test("DIRECT-FAST-05: a direct build runs build:app (no type check); gated, rollback and a tree without the script run the full build", () => {
    const ran = (fast: string, pkg: string) => {
      const root = tree(`f${fast}${pkg.length}`); writeFileSync(join(root, "frontend", "package.json"), pkg); rmSync(calls, { force: true });
      const r = bash(`${stubs}; build_app "${root}" "${fakeBun}" no H ${fast}`); expect(r.exitCode, r.stderr.toString()).toBe(0);
      return callLines().filter((x) => x.includes(":: run ")).map((x) => x.split(":: ")[1]);
    };
    const withApp = `{"scripts":{"build":"tsc --noEmit && vite build","build:app":"bun scripts/copy-ort.mjs && vite build"}}`;
    expect(ran("yes", withApp)).toEqual(["run build:app"]);
    expect(ran("no", withApp)).toEqual(["run build"]);
    expect(ran("yes", `{"scripts":{"build":"tsc --noEmit && vite build"}}`)).toEqual(["run build"]);
  });

  test("the repo's frontend has build:app with the same prebuild and vite build but no tsc, and main passes the direct decision to it", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "frontend", "package.json"), "utf8")).scripts;
    expect(pkg["build:app"]).toBe("bun run prebuild && vite build");
    expect(pkg.build).toBe("tsc --noEmit && vite build");
    expect(pkg.prebuild).toBe("bun scripts/copy-ort.mjs");
    expect(readFileSync(INSTALL_SH, "utf8")).toContain('build_app "$install_root" "$bun_bin" "$reuse_deps" "$deps_now" "$direct_install"');
    expect(readFileSync(INSTALL_SH, "utf8")).toContain('[ "${MAIPAI_INSTALL_DIRECT:-}" = "yes" ]'); // the re-exec keeps the direct decision
  });
});

// DIRECT-FAST-06: the Stack service is left alone when its build, its service definition and its health are unchanged.
describe("an unchanged Stack stays running (DIRECT-FAST-06)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "maipai-keep-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const bash = (script: string, env: Record<string, string> = {}) => Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; ${script}`], { env: { ...process.env, ...env } });
  const bin = (root: string) => join(root, "stack", bash("render_stack_binary_name linux x64").stdout.toString().trim());
  const fp = (root: string, user = "sage", port = "8770", bunBin = "/b/bun") => bash(`stack_service_fp ${user} "${bin(root)}" "${root}/stack/data" ${port} ${bunBin}`).stdout.toString().trim();
  function install(name: string, opts: { tag?: boolean; fp?: string | null; port?: string } = {}) {
    const root = join(scratch, name); const stack = join(root, "stack"); mkdirSync(join(stack, "data"), { recursive: true });
    writeFileSync(bin(root), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(stack, ".user"), "sage\n"); writeFileSync(join(stack, ".port"), `${opts.port ?? "8770"}\n`);
    if (opts.tag !== false) writeFileSync(join(stack, ".stack-tag"), `${bash('printf %s "$STACK_TAG"').stdout.toString()}\n`);
    const f = opts.fp === undefined ? fp(root) : opts.fp;
    if (f !== null) writeFileSync(join(stack, ".service-fp"), `${f}\n`);
    return root;
  }
  const keepable = (root: string, answers = "true", bunBin = "/b/bun", env: Record<string, string> = {}) => bash(`stack_answers_on() { ${answers}; }; stack_keepable "${root}" linux x64 ${bunBin}`, env).exitCode;

  test("the service fingerprint changes with the user, binary, data folder, port and Bun path, and with nothing else", () => {
    const root = install("fp1"); const base = fp(root);
    expect(base).toMatch(/^[0-9a-f]{64}$/); expect(fp(root)).toBe(base);
    expect(fp(root, "marlow")).not.toBe(base); expect(fp(root, "sage", "8771")).not.toBe(base); expect(fp(root, "sage", "8770", "/other/bun")).not.toBe(base);
    expect(bash(`stack_service_fp sage "/elsewhere/stack" "${root}/stack/data" 8770 /b/bun`).stdout.toString().trim()).not.toBe(base);
  });

  test("stack_keepable: yes only for the same tag, binary, fingerprint and an answering Stack", () => {
    expect(keepable(install("k1"))).toBe(0);
    expect(keepable(install("k2", { tag: false }))).toBe(1); // never built here by this installer
    expect(keepable(install("k3", { fp: null }))).toBe(1); // first install after this change: bounce once, record the fingerprint
    expect(keepable(install("k4", { fp: "deadbeef" }))).toBe(1); // service definition differs
    expect(keepable(install("k5"), "true", "/new/bun")).toBe(1); // Bun path changed
    expect(keepable(install("k6"), "false")).toBe(1); // not answering: restart it the normal way
    expect(keepable(install("k7"), "true", "/b/bun", { MAIPAI_REBUILD_STACK: "1" })).toBe(1);
    const stale = install("k8"); writeFileSync(join(stale, "stack", ".stack-tag"), "0000000\n"); expect(keepable(stale)).toBe(1); // another STACK_TAG
    const nobin = install("k9"); rmSync(bin(nobin)); expect(keepable(nobin)).toBe(1);
  });

  const stubs = `fetch_stack_source() { echo FETCH; }; build_stack_binary() { echo BUILD; }; install_stack_service() { echo SERVICE; }; stack_status() { :; }`;
  test("setup_stack with STACK_KEEP=yes leaves the service alone while it answers, and restarts it the normal way when it does not", () => {
    const root = install("s1");
    const kept = bash(`${stubs}; stack_answers_on() { true; }; STACK_KEEP=yes setup_stack "${root}" /b/bun linux x64 no reuse`).stdout.toString();
    expect(kept).toContain("leaving it running"); expect(kept).not.toContain("SERVICE");
    const down = bash(`${stubs}; stack_answers_on() { false; }; STACK_KEEP=yes setup_stack "${root}" /b/bun linux x64 no reuse`).stdout.toString();
    expect(down).toContain("SERVICE"); expect(down).not.toContain("leaving it running");
    const normal = bash(`${stubs}; stack_answers_on() { true; }; setup_stack "${root}" /b/bun linux x64 no reuse`).stdout.toString();
    expect(normal).toContain("SERVICE"); expect(normal).not.toContain("BUILD");
  });

  test("main stops the Stack only when it is not kept, install_stack_service records the fingerprint after the health check, and the keep needs the direct decision", () => {
    const text = readFileSync(INSTALL_SH, "utf8");
    expect(text).toContain('if [ "$direct_install" = "yes" ] && [ "${MAIPAI_REBUILD_STACK:-}" != "1" ] && stack_keepable');
    expect(text).toContain('if [ "$STACK_KEEP" != "yes" ] && [ -n "$existing_stack_user" ] && [ -x "$existing_binary" ]; then');
    const svc = text.slice(text.indexOf("install_stack_service() {"));
    expect(svc.indexOf("set-setting.ts engines.stack.url")).toBeLessThan(svc.indexOf("stack_service_fp"));
  });
});

