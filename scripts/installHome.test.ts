import { describe, test, expect, setDefaultTimeout } from "bun:test";
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
