import { describe, test, expect, setDefaultTimeout } from "bun:test";
setDefaultTimeout(30_000);
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import * as installFixtures from "./installFixtures";
const { INSTALL_SH, ENGINE_HELPER, PAIR_RESPONSE, readChild, startPairServer, stopPairServer, bashCall, runScript } = installFixtures;

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
      disk_plan_file_for() { echo /plan.json; }
      check_plan_disk() { t "check_plan_disk $2 $3"; }
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
        "check_plan_disk recommended full",
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
      expect(lines).toContain("check_plan_disk recommended home");
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
        require_root() { :; }; check_required_tools() { :; }; check_console_session() { :; }; disk_plan_file_for() { echo /plan.json; }; check_plan_disk() { :; }
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
      expect(lines).toContain("check_plan_disk recommended home");
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
    expect(bash("valid_release_tag v0.1.0 && valid_release_tag v1.2.3-rc1 && valid_release_tag sha-0123abc && ! valid_release_tag sha-xyz && ! valid_release_tag main && ! valid_release_tag search-assist-weights-v2").exitCode).toBe(0);
  });

  test("source mirror clones, refreshes, accepts main commits and refuses side commits", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-source-mirror-"));
    try {
      const remote = join(root, "remote.git"), clone = join(root, "clone"), mirror = join(root, "mirror.git");
      const git = (dir: string, ...args: string[]) => Bun.spawnSync(["git", "-C", dir, ...args]);
      expect(Bun.spawnSync(["git", "init", "--bare", "--initial-branch=main", remote]).exitCode).toBe(0);
      expect(Bun.spawnSync(["git", "clone", remote, clone]).exitCode).toBe(0);
      git(clone, "config", "user.name", "Install Test"); git(clone, "config", "user.email", "install@example.test");
      writeFileSync(join(clone, "hello.txt"), "main\n"); git(clone, "add", "."); git(clone, "commit", "-m", "main"); git(clone, "push", "origin", "main");
      const sha = git(clone, "rev-parse", "HEAD").stdout.toString().trim();
      const env = { ...process.env, MAIPAI_SOURCE_REMOTE: remote, MAIPAI_SOURCE_MIRROR: mirror };
      const sourced = (command: string) => Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; ${command}`], { env });
      expect(sourced(`ensure_source_mirror ${sha}`).exitCode).toBe(0);
      expect(sourced(`ensure_source_mirror ${sha}`).exitCode).toBe(0);
      git(clone, "checkout", "-b", "side"); writeFileSync(join(clone, "side.txt"), "side\n"); git(clone, "add", "."); git(clone, "commit", "-m", "side"); git(clone, "push", "origin", "side");
      const side = git(clone, "rev-parse", "HEAD").stdout.toString().trim();
      const refused = sourced(`ensure_source_mirror ${side}`);
      expect(refused.exitCode).not.toBe(0); expect(refused.stderr.toString()).toContain("not on main");
      const dest = join(root, "extract");
      const extracted = sourced(`fetch_release_source sha-${sha.slice(0, 7)} "${dest}"`);
      expect(extracted.exitCode).toBe(0); expect(readFileSync(join(dest, "hello.txt"), "utf8")).toBe("main\n");
      const dryMirror = join(root, "must-not-exist.git");
      const dry = Bun.spawnSync(["bash", INSTALL_SH, "--dry-run", "--commit", sha], { env: { ...env, MAIPAI_SOURCE_MIRROR: dryMirror } });
      expect(dry.exitCode).toBe(0); expect(dry.stdout.toString()).toContain(`sha-${sha.slice(0, 7)}`); expect(existsSync(dryMirror)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
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

  test("check_disk_space (the plain floor) still stops with the amount and what to do", () => {
    const result = bash('free_gb_at() { echo 2; }; check_disk_space /usr/local/maipai-home 3 Home || true; echo "problem=$DISK_PROBLEM"');
    const out = result.stdout.toString() + result.stderr.toString();
    expect(out).toContain("2 GB free");
    expect(out).toContain("Home needs 3 GB");
    expect(bash("free_gb_at() { echo 2; }; check_disk_space /x 3 Home").exitCode).toBe(1);
    expect(bash("free_gb_at() { echo 30; }; check_disk_space /x 3 Home").exitCode).toBe(0);
  });

  // INSTALL-DISK-01: the installer sizes the disk from shared/diskPlan.json, never from numbers in the script.
  const TABLE = join(import.meta.dir, "..", "shared", "diskPlan.json");
  const table = JSON.parse(readFileSync(TABLE, "utf8")) as { installer: Record<string, number>; headroom_warn_bytes: number };
  const GIB = 1_073_741_824;

  test("the script holds no disk sizes of its own: no HOME_REQUIRED_GB or STACK_REQUIRED_GB", () => {
    const text = readFileSync(INSTALL_SH, "utf8");
    expect(text).not.toContain("HOME_REQUIRED_GB");
    expect(text).not.toContain("STACK_REQUIRED_GB");
    expect(bash("echo $DATA_RESERVE_BYTES").stdout.toString().trim()).toBe("2147483648");
    expect(readFileSync(join(import.meta.dir, "..", "shared", "diskPlanMath.ts"), "utf8")).toContain("DATA_RESERVE_BYTES = 2 * GIB");
  });

  test("disk_plan_value reads every figure of the installer block the way the table says", () => {
    for (const [key, value] of Object.entries(table.installer)) expect(bash(`disk_plan_value "${TABLE}" ${key}`).stdout.toString().trim()).toBe(String(value));
    expect(bash(`disk_plan_value "${TABLE}" headroom_warn_bytes`).stdout.toString().trim()).toBe(String(table.headroom_warn_bytes));
    expect(bash(`disk_plan_value "${TABLE}" p99.required_free_bytes`).stdout.toString().trim()).toBe("");
  });

  test("the tier is the level capped by the computer's memory", () => {
    const out = (script: string) => bash(script).stdout.toString().trim();
    expect(out("tier_for_memory_gb 128; tier_for_memory_gb 96; tier_for_memory_gb 64; tier_for_memory_gb 48; tier_for_memory_gb 32; tier_for_memory_gb 24; tier_for_memory_gb 8; tier_for_memory_gb")).toBe("p128\np64\np64\np32\np32\np16\np16\np16");
    expect(out("tier_for_level recommended p64; tier_for_level recommended p128; tier_for_level moderate p128; tier_for_level minimal p128; tier_for_level moderate p16")).toBe("p64\np128\np32\np16\np16");
  });

  test("gb_text rounds a need up and free space down, one decimal under 10 GB", () => {
    expect(bash(`gb_text ${Math.floor(58.1 * GIB)} up; echo; gb_text ${Math.floor(58.9 * GIB)} down; echo; gb_text ${Math.floor(2.01 * GIB)} up; echo; gb_text ${Math.floor(2.09 * GIB)} down`).stdout.toString().trim()).toBe("59\n58\n2.1\n2.0");
  });

  // Stubs a computer: its memory, and a map of folder -> (disk id, free bytes).
  const disks = (memoryGb: number, map: Record<string, [string, number]>) => `
    machine_memory_gb() { echo ${memoryGb}; }
    volume_id_at() { case "$1" in ${Object.entries(map).map(([path, [id]]) => `${path}) echo "${id}";;`).join(" ")} esac; }
    free_bytes_at() { case "$1" in ${Object.entries(map).map(([path, [, free]]) => `${path}) echo ${free};;`).join(" ")} esac; }`;
  const check = (level: string, scope: string, memoryGb: number, map: Record<string, [string, number]>, env = "") => {
    const result = bash(`${disks(memoryGb, map)}\n${env}\nrc=0; check_plan_disk "${TABLE}" ${level} ${scope} darwin /r || rc=$?; echo "rc=$rc"; echo "problem=$DISK_PROBLEM"`);
    return { out: result.stdout.toString() + result.stderr.toString(), rc: Number(/rc=(\d+)/.exec(result.stdout.toString())?.[1]) };
  };
  const one = (free: number): Record<string, [string, number]> => ({ "/r": ["d1", free], "/r/data": ["d1", free], "/r/stack/data": ["d1", free] });

  test("a shortfall stops with the need, the free space, the smaller-plan flags and nothing hard-coded", () => {
    const need = table.installer["p64.required_free_bytes"]! + 2 * GIB;
    const { out, rc } = check("recommended", "full", 64, one(55 * GIB));
    expect(rc).toBe(1);
    expect(out).toMatch(/This computer needs about \d+ GB free for the recommended setup; it has 55 GB\./);
    expect(out).toContain(`about ${Math.ceil(need / GIB)} GB free`);
    expect(out).toContain("--plan moderate or --plan minimal");
  });

  test("the requirement is exact: one byte short stops, the requirement plus the headroom passes quietly", () => {
    const need = table.installer["p64.required_free_bytes"]! + 2 * GIB;
    expect(check("recommended", "full", 64, one(need - 1)).rc).toBe(1);
    const tight = check("recommended", "full", 64, one(need));
    expect(tight.rc).toBe(0);
    expect(tight.out).toContain("Warning: disk space is tight");
    const fine = check("recommended", "full", 64, one(need + table.headroom_warn_bytes));
    expect(fine.rc).toBe(0);
    expect(fine.out).toContain("Disk space:");
    expect(fine.out).not.toContain("tight");
  });

  test("the plan level sets the size: minimal passes where recommended stops, and a small computer is held to its own plan", () => {
    expect(check("recommended", "full", 64, one(40 * GIB)).rc).toBe(1);
    expect(check("minimal", "full", 64, one(40 * GIB)).rc).toBe(0);
    // A 32 GB Mac asking for Recommended is the p32 plan.
    expect(check("recommended", "full", 32, one(table.installer["p32.required_free_bytes"]! + 2 * GIB + table.headroom_warn_bytes)).out).toContain("(the p32 plan)");
  });

  test("a data folder on another disk is judged by that disk, and folders on one disk add up", () => {
    const split = { "/r": ["d1", 500 * GIB], "/r/data": ["d2", 1 * GIB], "/r/stack/data": ["d1", 500 * GIB] } as Record<string, [string, number]>;
    const result = check("recommended", "full", 64, split);
    expect(result.rc).toBe(1);
    expect(result.out).toMatch(/needs about 2\.0 GB free.*it has 1\.0 GB/);
    // The AI on its own big disk, Home and its data on a small one that holds them but not the AI.
    const ai = table.installer["p64.ai_required_free_bytes"]!;
    const home = table.installer["p64.home_required_free_bytes"]!;
    const separate = { "/r": ["d1", home + 2 * GIB + table.headroom_warn_bytes], "/r/data": ["d1", home + 2 * GIB + table.headroom_warn_bytes], "/r/stack/data": ["d2", ai + table.headroom_warn_bytes] } as Record<string, [string, number]>;
    expect(check("recommended", "full", 64, separate).rc).toBe(0);
    expect(check("recommended", "full", 64, one(ai)).rc).toBe(1);
  });

  test("an upgrade or the engine step checks only Home and the AI program, not the models", () => {
    const home = table.installer["p64.home_required_free_bytes"]!;
    const result = check("recommended", "home", 64, one(home + table.headroom_warn_bytes));
    expect(result.rc).toBe(0);
    expect(result.out).toContain("Home and the AI engine");
    expect(check("recommended", "home", 64, one(home - 1)).rc).toBe(1);
  });

  test("an unreadable disk continues with a note instead of blocking", () => {
    const result = bash(`machine_memory_gb() { echo 64; }; volume_id_at() { :; }; free_bytes_at() { :; }; rc=0; check_plan_disk "${TABLE}" recommended full darwin /r || rc=$?; echo "rc=$rc"`);
    expect(result.stdout.toString()).toContain("rc=0");
    expect(result.stdout.toString()).toContain("Could not read the free disk space");
  });

  test("fetch_disk_plan uses a local copy when named, tries the release tag, then main, then gives up quietly", () => {
    expect(bash(`MAIPAI_DISK_PLAN_FILE="${TABLE}" fetch_disk_plan v9`).stdout.toString().trim()).toBe(TABLE);
    const log = join(tmpdir(), `maipai-curl-${process.pid}.log`);
    const urls = bash(`curl() { echo "$*" >> "${log}"; case "$*" in *v9*) return 22;; *) echo '{}' > "$6"; return 0;; esac; }; REPO=o/r; f=$(fetch_disk_plan v9); [ -f "$f" ] && echo got`);
    expect(urls.stdout.toString()).toContain("got");
    const seen = readFileSync(log, "utf8");
    rmSync(log, { force: true });
    expect(seen).toContain("o/r/v9/shared/diskPlan.json");
    expect(seen).toContain("o/r/main/shared/diskPlan.json");
    expect(bash(`curl() { return 22; }; fetch_disk_plan v9; echo "[$?]"`).stdout.toString().trim()).toBe("[0]");
  });

  test("disk_check_level takes --plan, then the saved plan, then recommended", () => {
    const root = mkdtempSync(join(tmpdir(), "maipai-level-"));
    try {
      expect(bash(`disk_check_level moderate ${root}`).stdout.toString().trim()).toBe("moderate");
      expect(bash(`disk_check_level "" ${root}`).stdout.toString().trim()).toBe("recommended");
      mkdirSync(join(root, "data"));
      writeFileSync(join(root, "data", "setup-plan"), "minimal\n");
      expect(bash(`disk_check_level "" ${root}`).stdout.toString().trim()).toBe("minimal");
    } finally { rmSync(root, { recursive: true, force: true }); }
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

