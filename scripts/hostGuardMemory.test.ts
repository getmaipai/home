// HOST-GUARD-07..09: the host guard's memory probe, evidence capture and bounded self-repair. Every case runs the real script with the
// test seams (MAIPAI_HG_*): every system tool is a fake in a temp folder (MAIPAI_HG_BIN), the clock is fixed (MAIPAI_HG_NOW), and the
// "restart" is a fake launchctl that only records its arguments. Nothing here restarts, captures or reads anything real.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "studio", "host-guard", "maipai-host-guard");
const mac = process.platform === "darwin";
const me = userInfo();
const temps: string[] = [];
const T0 = 1_800_000_000;

const top = (rows: string[]) => ["Processes: 700 total, 3 running", "PhysMem: 120G used", "", "PID    COMMAND          MEM   CMPRS", ...rows].join("\n") + "\n";
const BIG = top(["103    fseventsd        66G   63G  ", "71096  splash           17G   0B   ", "1064   Claude Helper (R 1914M 623M"]);
const MID = top(["103    fseventsd        20G   18G  ", "71096  splash           17G   0B   "]);
const SMALL = top(["71096  splash           17G   0B   ", "103    fseventsd        40M   0B   "]);
const AFTER = top(["71096  splash           17G   0B   ", "4242   fseventsd        12M   0B   "]);
const fsevMb = (mb: number) => top([`103    fseventsd        ${mb}M   ${Math.floor(mb / 2)}M`, "71096  splash           17G   0B   "]);

const FAKES: Record<string, string> = {
  sysctl: `case "$*" in *pressure_level*) cat "$HG_FAKE/pressure" ;; *memorystatus_level*) echo 30 ;; *swapusage*) echo 'total = 17408.00M  used = 17126.00M  free = 282.00M  (encrypted)' ;; *) echo "vm.swapusage: fake" ;; esac`,
  vm_stat: `printf 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\\nPages free:      93220.\\nPages occupied by compressor:   3845789.\\n'`,
  top: `cat "$HG_FAKE/top"`,
  log: `case "$*" in *"Resolve user group list"*) n=$(cat "$HG_FAKE/calls" 2>/dev/null || echo 0); i=0; while [ $i -lt $n ]; do echo "2026-11-12 04:00:00.000 A  fseventsd[103:1] (libsystem_info.dylib) Resolve user group list"; i=$((i+1)); done ;;
  *fseventsd*) [ -e "$HG_FAKE/log-hang" ] && sleep 300; printf '2026-11-12 04:00:00.000 E  fseventsd[103:1] could not open\\n2026-11-12 04:00:01.000 A  fseventsd[103:1] (libsystem_info.dylib) Resolve user group list\\n2026-11-12 04:00:02.000 Df fseventsd[103:1] events dropped, must scan\\n' ;;
  *) echo "2026-11-12 04:00:00.000 Df mds[1:1] something" ;; esac`,
  launchctl: `if [ "$1" = kickstart ]; then echo "$*" >> "$HG_FAKE/kickstarts"; [ -f "$HG_FAKE/top-after" ] && cp "$HG_FAKE/top-after" "$HG_FAKE/top"; exit 0; fi; printf '\\tstate = running\\n\\truns = 3\\n'`,
  pgrep: `[ -e "$HG_FAKE/no-fsev" ] || echo 103`,
  vmmap: `[ -e "$HG_FAKE/vmmap-fail" ] && exit 1; printf 'Path:            /System/Library/secret/fseventsd\\nPhysical footprint:         66.0G\\nMalloc Small                     116.2G   810.0M   803.9M    64.7G       0K       0K       0K    29906\\nTOTAL                            504.1G     1.2G   865.3M    65.1G\\n'`,
  footprint: `echo "fseventsd [103]: 64-bit    Footprint: 66 GB"`,
  heap: `printf 'Process:         fseventsd [103]\nAll zones: 955166 nodes malloced - 116.2G\nZone DefaultMallocZone_0x1: 955166 nodes - 116.2G\n'`,
  leaks: `echo "Process 103: 955166 leaks for 121000000000 total leaked bytes."`,
  fs_usage: `for i in 1 2 3; do echo "12:00:00.1 open F=3 /Users/someone/Developer/github.com/getmaipai/wt/home-foo/src/secret-name.ts 0.0001 bun.123"; done; echo "12:00:00.2 stat64 /Users/someone/x/node_modules/a/b.js 0.0001 node.9"; sleep 30`,
  lsof: `case "$*" in *fsevents*) printf 'p1\\ncmds\\np2\\ncfseventsd\\n' ;; *) printf 'p1\\ncbun\\nf1\\nf2\\np2\\ncnode\\nf1\\n' ;; esac`,
};

interface Box { state: string; data: string; fake: string; bin: string; log: string }
function box(repair: Record<string, unknown> | null = { mode: "live" }): Box {
  const root = mkdtempSync(join(tmpdir(), "hostguard-mem-"));
  temps.push(root);
  const b: Box = { state: join(root, "state"), data: join(root, "data"), fake: join(root, "fake"), bin: join(root, "bin"), log: join(root, "log") };
  for (const d of [b.state, b.data, b.fake, b.bin]) mkdirSync(d, { recursive: true });
  writeFileSync(join(b.state, "config.json"), JSON.stringify({ owner: me.username, uid: me.uid, data_dir: b.data }));
  writeFileSync(join(b.state, "tuning.json"), JSON.stringify({ mode: "dry" }));
  if (repair) writeFileSync(join(b.state, "repair.json"), JSON.stringify(repair));
  for (const [name, body] of Object.entries(FAKES)) { const p = join(b.bin, name); writeFileSync(p, `#!/bin/bash\n${body}\n`); chmodSync(p, 0o755); }
  set(b, { pressure: "1", top: SMALL });
  return b;
}
const set = (b: Box, files: Record<string, string>) => { for (const [k, v] of Object.entries(files)) writeFileSync(join(b.fake, k), v); };
function mem(b: Box, at: number, extra: Record<string, string> = {}) {
  return Bun.spawnSync(["/bin/bash", SCRIPT, "memory"], {
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: process.env.HOME ?? "/", MAIPAI_HG_TEST: "1", MAIPAI_HG_STATE: b.state, MAIPAI_HG_LOG: b.log,
      MAIPAI_HG_BIN: b.bin, MAIPAI_HG_NOW: String(at), MAIPAI_HG_VERIFY_DELAY: "0", MAIPAI_HG_FS_USAGE_SECONDS: "1", HG_FAKE: b.fake, ...extra },
    stdout: "pipe", stderr: "pipe",
  });
}
const status = (b: Box) => JSON.parse(readFileSync(join(b.state, "memory.json"), "utf8"));
const audit = (b: Box) => (existsSync(join(b.state, "repair-audit.log")) ? readFileSync(join(b.state, "repair-audit.log"), "utf8") : "");
const kicks = (b: Box) => (existsSync(join(b.fake, "kickstarts")) ? readFileSync(join(b.fake, "kickstarts"), "utf8").trim().split("\n").filter(Boolean) : []);
const captures = (b: Box) => (existsSync(join(b.state, "fsevents-captures")) ? readdirSync(join(b.state, "fsevents-captures")) : []);

afterAll(() => { for (const t of temps) rmSync(t, { recursive: true, force: true }); });

describe.skipIf(!mac)("host guard memory probe and self-repair", () => {
  test("the probe sees a daemon with a small resident size but a huge compressed footprint, and writes a readable status", () => {
    const b = box({ mode: "off" });
    set(b, { pressure: "2", top: BIG, calls: "600" });
    expect(mem(b, T0).exitCode).toBe(0);
    const s = status(b);
    expect(s).toMatchObject({ version: 1, checked_at: T0, pressure: 2, free_pct: 30, swap_used_mb: 17126, swap_total_mb: 17408, compressor_mb: 60090, repair_mode: "off" });
    expect(s.fseventsd).toMatchObject({ pid: 103, footprint_mb: 67584, compressed_mb: 64512, growth_10min_mb: -1, group_list_per_min: 600 });
    expect(s.top[2]).toEqual({ pid: 1064, name: "Claude Helper (R", footprint_mb: 1914, compressed_mb: 623 });
    expect(s.summary).toContain("file-event service 66.0 GB (63.0 GB compressed)");
    expect(statSync(join(b.state, "memory.json")).mode & 0o777).toBe(0o644);
    expect(readFileSync(join(b.state, "memory.csv"), "utf8").split("\n")[1]).toStartWith(`${T0},2,30,17126,17408,60090,67584,64512,`);
    expect(kicks(b)).toEqual([]);
  });

  test("an action that is not on the allowlist is refused and nothing runs", () => {
    const b = box();
    set(b, { pressure: "2", top: BIG });
    mem(b, T0, { MAIPAI_HG_REMEDIES: "rm-rf" });
    expect(audit(b)).toContain("id=rm-rf decision=refused not on the allowlist");
    expect(kicks(b)).toEqual([]);
  });

  test("a huge daemon: the first pass captures the evidence, then restarts only the file-event daemon and says so", () => {
    const b = box();
    set(b, { pressure: "2", top: BIG, "top-after": AFTER, calls: "100" });
    mem(b, T0);
    expect(kicks(b)).toEqual(["kickstart -k system/com.apple.fseventsd"]);
    const caps = captures(b);
    expect(caps.length).toBe(1);
    const dir = join(b.state, "fsevents-captures", caps[0]!);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "vmmap.txt")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, "vmmap-full.txt"), "utf8")).toContain("Malloc Small");
    expect(existsSync(join(dir, "COMPLETE"))).toBe(true);
    const digestText = readFileSync(join(b.state, "fsevents-digest.json"), "utf8");
    const digest = JSON.parse(digestText);
    expect(digest).toMatchObject({ complete: true, pid: 103, vmmap_footprint: "66.0G", top_footprint_mb: 67584, walked: false });
    expect(existsSync(join(dir, "leaks.txt"))).toBe(false);
    expect(digest.log_2h).toMatchObject({ fseventsd_lines: 3, errors: 1, group_list_calls: 1, dropped_or_rescan_lines: 1 });
    expect(digest.fs_usage.by_path).toContainEqual(["wt/home-foo", 3]);
    expect(digest.fs_usage.by_process).toContainEqual(["bun", 3]);
    expect(digestText).not.toContain("secret");
    expect(statSync(join(b.state, "fsevents-digest.json")).mode & 0o777).toBe(0o644);
    const restarted = JSON.parse(readFileSync(join(b.state, "fsevents-restarted"), "utf8"));
    expect(restarted).toMatchObject({ restarted_at: T0, before_mb: 67584, after_mb: 12, result: "ok" });
    const s = status(b);
    expect(s.notice).toBe("Chat is slower for a few minutes while the system tidies up.");
    expect(s.last_restart_result).toBe("ok");
    expect(audit(b)).toContain("id=restart-fseventsd decision=ran result=ok");
  });

  test("no restart without evidence: a failed capture below the emergency size refuses the restart", () => {
    const b = box();
    set(b, { pressure: "2", top: MID, "vmmap-fail": "" });
    mem(b, T0); mem(b, T0 + 60);
    expect(kicks(b)).toEqual([]);
    expect(audit(b)).toContain("id=capture-fseventsd decision=failed");
    expect(audit(b)).toContain("decision=refused no complete evidence capture in the last 30 minutes");
    const c = box();
    set(c, { pressure: "2", top: MID, "vmmap-fail": "" });
    mem(c, T0, { MAIPAI_HG_REMEDIES: "restart-fseventsd" });
    expect(kicks(c)).toEqual([]);
    expect(audit(c)).toContain("decision=refused the evidence capture did not complete");
  });

  test("above the emergency size a quick capture runs and the restart goes ahead even if the capture is incomplete", () => {
    const b = box();
    set(b, { pressure: "2", top: BIG, "top-after": AFTER, "vmmap-fail": "" });
    mem(b, T0);
    expect(kicks(b).length).toBe(1);
    expect(audit(b)).toContain("quick capture incomplete; restarting anyway");
  });

  test("the restart cooldown is 12 hours, with a fake clock", () => {
    const b = box();
    set(b, { pressure: "2", top: BIG });
    mem(b, T0);
    expect(kicks(b).length).toBe(1);
    mem(b, T0 + 3600);
    expect(kicks(b).length).toBe(1);
    expect(audit(b)).toContain("id=restart-fseventsd decision=skipped cooldown (720 min)");
    mem(b, T0 + 11 * 3600);
    expect(kicks(b).length).toBe(1);
    mem(b, T0 + 13 * 3600);
    expect(kicks(b).length).toBe(2);
  }, 30_000);

  test("a small daemon (4 to 8 GB) is captured with heap and leaks and not restarted", () => {
    const b = box();
    set(b, { pressure: "1", top: fsevMb(5000) });
    mem(b, T0);
    expect(kicks(b)).toEqual([]);
    const digest = JSON.parse(readFileSync(join(b.state, "fsevents-digest.json"), "utf8"));
    expect(digest).toMatchObject({ complete: true, walked: true, leaks: "955166 leaks for 121000000000 total leaked bytes." });
    expect(digest.heap[0]).toContain("All zones: 955166 nodes");
    expect(audit(b)).toContain("id=capture-fseventsd decision=ran complete (full)");
  });

  test("growth of 2 GB in 10 minutes restarts and 1 GB sets the source throttle; the lookup rate alone never triggers", () => {
    const b = box();
    set(b, { pressure: "1", top: fsevMb(1000), calls: "50000" });
    mem(b, T0);
    for (let i = 1; i <= 9; i++) { set(b, { top: fsevMb(1000 + 250 * i) }); mem(b, T0 + 60 * i); }
    expect(kicks(b)).toEqual([]);
    expect(existsSync(join(b.state, "source-throttle"))).toBe(false);
    set(b, { top: fsevMb(3500), "top-after": AFTER }); mem(b, T0 + 600);
    expect(kicks(b)).toEqual(["kickstart -k system/com.apple.fseventsd"]);
    expect(audit(b)).toContain("trigger=growth 2500 MB in 10 min");
    expect(JSON.parse(readFileSync(join(b.state, "source-throttle"), "utf8"))).toMatchObject({ since: T0 + 600 });
    expect(status(b).summary).toContain("test workers halved");
    // After the restart the new process has no growth; the throttle clears after 10 calm minutes.
    for (let i = 1; i <= 9; i++) mem(b, T0 + 600 + 60 * i);
    expect(existsSync(join(b.state, "source-throttle"))).toBe(true);
    mem(b, T0 + 600 + 600);
    expect(existsSync(join(b.state, "source-throttle"))).toBe(false);
  }, 60_000);

  test("dry mode only logs: no capture, no restart, no flag", () => {
    const b = box({ mode: "dry" });
    set(b, { pressure: "2", top: BIG });
    for (let i = 0; i <= 21; i++) mem(b, T0 + 60 * i);
    expect(kicks(b)).toEqual([]);
    expect(captures(b)).toEqual([]);
    expect(existsSync(join(b.state, "dev-shed"))).toBe(false);
    expect(audit(b)).toContain("id=restart-fseventsd decision=dry would run");
    expect(audit(b)).toContain("id=dev-shed decision=dry would run");
  }, 60_000);

  test("the kill switch file turns every repair off and clears a dev-shed flag", () => {
    const b = box();
    set(b, { pressure: "2", top: BIG });
    writeFileSync(join(b.state, "dev-shed"), JSON.stringify({ version: 1, since: T0, updated_at: T0, reason: "x" }));
    mkdirSync(join(b.data, "host-guard"), { recursive: true });
    writeFileSync(join(b.data, "host-guard", "OFF"), "");
    mem(b, T0);
    expect(kicks(b)).toEqual([]);
    expect(captures(b)).toEqual([]);
    expect(existsSync(join(b.state, "dev-shed"))).toBe(false);
    expect(audit(b)).toContain("decision=skipped kill switch is set");
    expect(status(b).kill_switch).toBe(true);
  });

  test("dev-shed is set after 20 minutes at pressure 2 and cleared after 5 calm minutes", () => {
    const b = box();
    set(b, { pressure: "2", top: SMALL });
    for (let i = 0; i < 20; i++) mem(b, T0 + 60 * i);
    expect(existsSync(join(b.state, "dev-shed"))).toBe(false);
    mem(b, T0 + 1200);
    const flag = JSON.parse(readFileSync(join(b.state, "dev-shed"), "utf8"));
    expect(flag).toMatchObject({ since: T0 + 1200, updated_at: T0 + 1200 });
    expect(statSync(join(b.state, "dev-shed")).mode & 0o777).toBe(0o644);
    mem(b, T0 + 1260);
    expect(JSON.parse(readFileSync(join(b.state, "dev-shed"), "utf8"))).toMatchObject({ since: T0 + 1200, updated_at: T0 + 1260 });
    expect(status(b).summary).toContain("heavy development work paused");
    set(b, { pressure: "1" });
    for (let i = 0; i < 5; i++) mem(b, T0 + 1320 + 60 * i);
    expect(existsSync(join(b.state, "dev-shed"))).toBe(true);
    mem(b, T0 + 1320 + 300);
    expect(existsSync(join(b.state, "dev-shed"))).toBe(false);
    expect(kicks(b)).toEqual([]);
  }, 60_000);

  test("repair.json values are clamped and an unknown mode falls back to live", () => {
    const b = box({ mode: "reboot-everything", fsevents_compressed_gb: 1 });
    // 1 GB is below the 4 GB floor, so a 3 GB daemon is not restarted.
    set(b, { pressure: "2", top: fsevMb(3072) });
    mem(b, T0);
    expect(kicks(b)).toEqual([]);
    expect(status(b).repair_mode).toBe("live");
  });

  test("the root daemon's run never touches the memory pass in tests unless the tools are faked", () => {
    const b = box();
    Bun.spawnSync(["/bin/bash", SCRIPT, "run"], { env: { PATH: "/usr/bin:/bin", MAIPAI_HG_TEST: "1", MAIPAI_HG_STATE: b.state, MAIPAI_HG_LOG: b.log, MAIPAI_HG_NO_ASUSER: "1", MAIPAI_HG_MIN_UPTIME: "0", MAIPAI_HG_QUIET: "yes", MAIPAI_HG_NO_TELEMETRY: "1" } });
    expect(existsSync(join(b.state, "memory.json"))).toBe(false);
  }, 60_000);
});
