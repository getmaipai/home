import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// host-tune.sh runs against fake pmset, sysctl, tmutil, defaults, launchctl, systemsetup,
// uname, id and nc on PATH, so no test touches the real Mac. Each fake keeps its state in
// $FAKE and logs every call to $FAKE/calls.
const SCRIPT = join(import.meta.dir, "host-tune.sh");
let fake: string;
let bin: string;
let sysroot: string;
let data: string;
let models: string;
let engines: string;
let media: string;
let cache: string;

function tool(name: string, body: string) {
  const file = join(bin, name);
  writeFileSync(file, `#!/usr/bin/env bash\necho "${name} $*" >> "$FAKE/calls"\n${body}\n`);
  chmodSync(file, 0o755);
}

beforeEach(() => {
  fake = mkdtempSync(join(tmpdir(), "host-tune-"));
  bin = join(fake, "bin"); sysroot = join(fake, "root"); data = join(fake, "data"); models = join(fake, "models");
  engines = join(fake, "engines"); media = join(fake, "media"); cache = join(fake, "cache");
  mkdirSync(bin); mkdirSync(sysroot); mkdirSync(data); mkdirSync(models);
  writeFileSync(join(fake, "pmset"), "sleep 1\ndisksleep 10\ndisplaysleep 10\nautorestart 0\nwomp 0\npowernap 1\n");
  writeFileSync(join(fake, "wired"), "0\n");
  tool("uname", `echo "\${FAKE_OS:-Darwin}"`);
  tool("id", `echo "\${FAKE_UID:-0}"`);
  tool("pmset", `if [ "$1" = "-g" ]; then sed 's/ /  /' "$FAKE/pmset"; exit 0; fi
shift
while [ $# -gt 1 ]; do grep -v "^$1 " "$FAKE/pmset" > "$FAKE/pmset.n"; echo "$1 $2" >> "$FAKE/pmset.n"; mv "$FAKE/pmset.n" "$FAKE/pmset"; shift 2; done`);
  tool("sysctl", `case "$1" in
  -n) case "$2" in hw.memsize) echo \${FAKE_MEM:-137438953472} ;; iogpu.wired_limit_mb) cat "$FAKE/wired" ;; esac ;;
  -w) echo "\${2#*=}" > "$FAKE/wired" ;;
esac`);
  tool("tmutil", `case "$1" in
  isexcluded) if [ -f "$FAKE/excluded" ]; then echo "[Excluded]    $2"; else echo "[Included]    $2"; fi ;;
  addexclusion) touch "$FAKE/excluded" ;;
  removeexclusion) rm -f "$FAKE/excluded" ;;
esac`);
  tool("defaults", `case "$1" in
  read) f="$FAKE/def.$3"; [ -f "$f" ] && cat "$f" || exit 1 ;;
  write) v=0; [ "$4" = "-bool" ] && { [ "$5" = true ] && v=1 || v=0; }; echo "$v" > "$FAKE/def.$3" ;;
esac`);
  tool("launchctl", `[ -n "\${FAKE_LAUNCH_FAIL:-}" ] && exit 1
case "$1" in
  print-disabled) cat "$FAKE/launchd" 2>/dev/null; echo '{'; echo '}' ;;
  print) case "$2" in
    gui/*/com.maipai.display-awake) [ -f "$FAKE/display-job" ] || exit 1; cat "$FAKE/display-job" ;;
    gui/*) exit 0 ;;
  esac ;;
  bootstrap) echo 'state = running' > "$FAKE/display-job" ;;
  bootout) rm -f "$FAKE/display-job" ;;
esac`);
  tool("systemsetup", `[ -n "\${FAKE_SETUP_FAIL:-}" ] && { echo "needs Full Disk Access"; exit 1; }; echo '"com.openssh.sshd" => enabled' > "$FAKE/launchd"`);
  tool("plutil", "exit 0");
  tool("sudo", "exit 99");
  tool("nc", "exit 1");
});
afterEach(() => rmSync(fake, { recursive: true, force: true }));

async function host(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(["bash", SCRIPT, "--data-dir", data, "--models-dir", models, "--engines-dir", engines, "--media-dir", media, "--cache-dir", cache, ...args], {
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, FAKE: fake, MAIPAI_HOST_TUNE_ROOT: sysroot, ...env },
    stdout: "pipe", stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out, err };
}
const calls = () => (existsSync(join(fake, "calls")) ? readFileSync(join(fake, "calls"), "utf8") : "");
type Item = { id: string; title: string; why: string; mode: string; state: string; current: string; proposed: string };
const detect = async (env: Record<string, string> = {}) => JSON.parse((await host(["--json", "detect"], env)).out) as { supported: boolean; items: Item[] };
const byId = (items: Item[], id: string) => items.find((i) => i.id === id)!;

describe("host-tune.sh detect", () => {
  test("lists every item with the contract fields, without root", async () => {
    const { supported, items } = await detect({ FAKE_UID: "501" });
    expect(supported).toBe(true);
    expect(items.map((i) => i.id)).toEqual(expect.arrayContaining(["no-spotlight", "no-timemachine-models", "power", "display-awake", "wired-limit", "no-auto-major-upgrade", "remote-login", "advice-login"]));
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(["current", "id", "mode", "proposed", "state", "title", "why"]);
      expect(["auto", "consent", "advice"]).toContain(item.mode);
      expect(["ok", "needs", "unknown", "applied"]).toContain(item.state);
    }
    expect(byId(items, "power").state).toBe("needs");
    expect(byId(items, "no-spotlight").state).toBe("needs");
    expect(byId(items, "advice-login").mode).toBe("advice");
    expect(calls()).not.toContain("sudo");
  });

  test("wired limit leaves max(12 GB, 15 percent) for macOS: 128 GB gives 111412 MB (15 percent is 19660)", async () => {
    const item = byId((await detect()).items, "wired-limit");
    expect(item.proposed).toContain("111412 MB");
    expect(item.state).toBe("needs");
  });

  test("wired limit keeps a 12 GB floor on a 64 GB Mac and is not needed under 32 GB", async () => {
    expect(byId((await detect({ FAKE_MEM: String(64 * 1024 ** 3) })).items, "wired-limit").proposed).toContain("53248 MB");
    expect(byId((await detect({ FAKE_MEM: String(16 * 1024 ** 3) })).items, "wired-limit").state).toBe("ok");
  });

  test("reports supported=false off macOS", async () => {
    const result = await host(["--json", "detect"], { FAKE_OS: "Linux" });
    expect(JSON.parse(result.out)).toEqual({ supported: false, items: [] });
  });

  test("a quote or backslash in a path cannot break the JSON", async () => {
    const result = await host(["--json", "detect", "--models-dir", join(fake, 'we"ird\\dir')]);
    expect(() => JSON.parse(result.out)).not.toThrow();
  });
});

describe("host-tune.sh apply and revert", () => {
  test("dry-run is the default and changes nothing", async () => {
    const result = await host(["--json", "apply", "no-spotlight"]);
    expect(result.code).toBe(0);
    const body = JSON.parse(result.out);
    expect(body.dryRun).toBe(true);
    expect(body.would.join("\n")).toContain(".metadata_never_index");
    expect(existsSync(join(data, ".metadata_never_index"))).toBe(false);
  });

  test("no-spotlight writes the marker in both Home folders and reverts", async () => {
    const applied = JSON.parse((await host(["--json", "--yes", "apply", "no-spotlight"], { FAKE_UID: "501" })).out);
    expect(applied.item.state).toBe("applied");
    expect(existsSync(join(data, ".metadata_never_index"))).toBe(true);
    expect(existsSync(join(models, ".metadata_never_index"))).toBe(true);
    const reverted = JSON.parse((await host(["--json", "--yes", "revert", "no-spotlight"], { FAKE_UID: "501" })).out);
    expect(reverted.item.state).toBe("needs");
    expect(existsSync(join(models, ".metadata_never_index"))).toBe(false);
  });

  test("no-spotlight covers all five folders, creates the missing ones and touches nothing else", async () => {
    const outside = join(fake, "outside");
    mkdirSync(outside);
    expect(byId((await detect()).items, "no-spotlight").current).toContain("engines, media, cache");
    await host(["--json", "--yes", "apply", "no-spotlight"], { FAKE_UID: "501" });
    for (const dir of [data, models, engines, media, cache]) expect(existsSync(join(dir, ".metadata_never_index"))).toBe(true);
    expect(existsSync(join(outside, ".metadata_never_index"))).toBe(false);
    expect(existsSync(join(fake, ".metadata_never_index"))).toBe(false);
    expect(byId((await detect()).items, "no-spotlight").state).toBe("ok");
    await host(["--json", "--yes", "revert", "no-spotlight"], { FAKE_UID: "501" });
    for (const dir of [data, models, engines, media, cache]) expect(existsSync(join(dir, ".metadata_never_index"))).toBe(false);
  });

  test("no-timemachine-models excludes only the models folder", async () => {
    await host(["--json", "--yes", "apply", "no-timemachine-models"], { FAKE_UID: "501" });
    expect(calls()).toContain(`tmutil addexclusion ${models}`);
    expect(calls()).not.toContain(`addexclusion ${data}`);
    expect(byId((await detect()).items, "no-timemachine-models").state).toBe("ok");
  });

  test("a consent item without root exits 3 and names the exact command", async () => {
    const result = await host(["--json", "--yes", "apply", "power"], { FAKE_UID: "501" });
    expect(result.code).toBe(3);
    const body = JSON.parse(result.out);
    expect(body.code).toBe("needs-root");
    expect(body.error).toContain("sudo bash");
    expect(body.error).toContain("apply power --yes");
    expect(calls()).not.toContain("pmset -a");
  });

  test("power applies the six settings, remembers the old ones and reverts to them", async () => {
    const applied = JSON.parse((await host(["--json", "--yes", "apply", "power"])).out);
    expect(applied.item.state).toBe("applied");
    expect(calls()).toContain("pmset -a sleep 0 disksleep 0 displaysleep 10 autorestart 1 womp 1 powernap 0");
    const reverted = JSON.parse((await host(["--json", "--yes", "revert", "power"])).out);
    expect(reverted.item.state).toBe("needs");
    const now = readFileSync(join(fake, "pmset"), "utf8");
    expect(now).toContain("sleep 1");
    expect(now).toContain("disksleep 10");
    expect(now).toContain("powernap 1");
  });

  test("wired-limit sets the value, writes a boot daemon, and revert removes both", async () => {
    const applied = JSON.parse((await host(["--json", "--yes", "apply", "wired-limit"])).out);
    expect(applied.item.state).toBe("applied");
    expect(readFileSync(join(fake, "wired"), "utf8").trim()).toBe("111412");
    const plist = join(sysroot, "Library/LaunchDaemons/com.maipai.wired-limit.plist");
    expect(readFileSync(plist, "utf8")).toContain("iogpu.wired_limit_mb=111412");
    expect(calls()).toContain("launchctl bootstrap system");
    await host(["--json", "--yes", "revert", "wired-limit"]);
    expect(readFileSync(join(fake, "wired"), "utf8").trim()).toBe("0");
    expect(existsSync(plist)).toBe(false);
  });

  test("no-auto-major-upgrade turns major upgrades off and security updates on", async () => {
    const applied = JSON.parse((await host(["--json", "--yes", "apply", "no-auto-major-upgrade"])).out);
    expect(applied.item.state).toBe("applied");
    expect(readFileSync(join(fake, "def.AutomaticallyInstallMacOSUpdates"), "utf8").trim()).toBe("0");
    expect(readFileSync(join(fake, "def.CriticalUpdateInstall"), "utf8").trim()).toBe("1");
  });

  test("remote-login turns SSH on, and a refusal says what to do by hand", async () => {
    expect(byId((await detect()).items, "remote-login").state).toBe("needs");
    expect(JSON.parse((await host(["--json", "--yes", "apply", "remote-login"])).out).item.state).toBe("applied");
    const refused = await host(["--json", "--yes", "apply", "remote-login"], { FAKE_SETUP_FAIL: "1" });
    expect(refused.code).toBe(4);
    expect(JSON.parse(refused.out).error).toContain("System Settings");
  });

  test("advice ids and unknown ids are refused with a reason", async () => {
    const advice = await host(["--json", "--yes", "apply", "advice-login"]);
    expect(advice.code).toBe(2);
    expect(JSON.parse(advice.out).code).toBe("advice-only");
    const unknown = await host(["--json", "--yes", "apply", "rm -rf /"]);
    expect(unknown.code).toBe(2);
    expect(JSON.parse(unknown.out).code).toBe("unknown-id");
    expect(calls()).not.toContain("rm");
  });

  test("a failing step stops with the tool's message", async () => {
    tool("tmutil", `echo "not allowed" ; exit 1`);
    const result = await host(["--json", "--yes", "apply", "no-timemachine-models"], { FAKE_UID: "501" });
    expect(result.code).toBe(4);
    expect(JSON.parse(result.out).error).toContain("not allowed");
  });
});

const displayPlist = () => join(sysroot, "Library/LaunchAgents/com.maipai.display-awake.plist");
const userEnv = { FAKE_UID: "501" };
function installDisplayPlist() {
  mkdirSync(join(sysroot, "Library/LaunchAgents"), { recursive: true });
  writeFileSync(displayPlist(), "plist");
}

describe("display-awake login service", () => {
  test("detect needs a plist and a running job, and reports unreadable launchctl", async () => {
    expect(byId((await detect(userEnv)).items, "display-awake").state).toBe("needs");
    installDisplayPlist();
    expect(byId((await detect(userEnv)).items, "display-awake").state).toBe("needs");
    writeFileSync(join(fake, "display-job"), "state = waiting\n");
    expect(byId((await detect(userEnv)).items, "display-awake").state).toBe("needs");
    writeFileSync(join(fake, "display-job"), "  state = running\n");
    expect(byId((await detect(userEnv)).items, "display-awake").state).toBe("ok");
    expect(byId((await detect({ ...userEnv, FAKE_LAUNCH_FAIL: "1" })).items, "display-awake").state).toBe("unknown");
  });

  test("dry-run prints the plist and commands without changing anything", async () => {
    const result = await host(["--json", "apply", "display-awake"], userEnv);
    expect(result.code).toBe(0);
    const body = JSON.parse(result.out);
    expect(body.dryRun).toBe(true);
    expect(body.would).toContain(`write ${displayPlist()}`);
    expect(body.would).toContain(`plutil -lint ${displayPlist()}`);
    expect(body.would).toContain(`launchctl bootstrap gui/501 ${displayPlist()}`);
    expect(existsSync(displayPlist())).toBe(false);
    expect(calls()).not.toContain("launchctl bootstrap");
    expect(calls()).not.toContain("plutil");
  });

  test("apply needs no sudo, validates the plist, reloads idempotently and reverts", async () => {
    const apply = () => host(["--json", "--yes", "apply", "display-awake"], userEnv);
    const result = await apply();
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).item.state).toBe("applied");
    const plist = readFileSync(displayPlist(), "utf8");
    expect(plist).toContain("<key>Label</key><string>com.maipai.display-awake</string>");
    expect(plist).toContain("<key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-d</string><string>-i</string></array>");
    for (const key of ["RunAtLoad", "KeepAlive"]) expect(plist).toContain(`<key>${key}</key><true/>`);
    expect(plist).toContain("<key>ProcessType</key><string>Background</string>");
    expect(calls()).toContain(`plutil -lint ${displayPlist()}`);
    expect(calls()).toContain(`launchctl bootstrap gui/501 ${displayPlist()}`);
    expect((await apply()).code).toBe(0);
    expect(calls()).toContain("launchctl bootout gui/501/com.maipai.display-awake");
    expect(calls()).not.toContain("sudo");
    const dry = await host(["--json", "revert", "display-awake"], userEnv);
    expect(JSON.parse(dry.out).dryRun).toBe(true);
    expect(existsSync(displayPlist())).toBe(true);
    expect((await host(["--yes", "revert", "display-awake"], userEnv)).code).toBe(0);
    expect(existsSync(displayPlist())).toBe(false);
    expect(existsSync(join(fake, "display-job"))).toBe(false);
    expect((await host(["--yes", "revert", "display-awake"], userEnv)).code).toBe(0);
  });

  test("apply refuses root even in dry-run and explains which account to use", async () => {
    for (const flags of [[], ["--yes"]]) {
      const result = await host(["--json", ...flags, "apply", "display-awake"]);
      expect(result.code).toBe(2);
      expect(JSON.parse(result.out).error).toContain("signed-in user without sudo");
    }
    expect(existsSync(displayPlist())).toBe(false);
    expect(calls()).not.toContain("launchctl bootstrap");
  });
});
