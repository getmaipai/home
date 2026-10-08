import "../runTemp";
// GATE-SPEED-01 (a): runs one workspace's bun test files as N parallel bun
// processes ("shards"), split by measured duration, with the same pass/fail
// meaning as a single `bun test`: exit 0 only if every file passed, otherwise
// the first failing shard's exit code, one printed summary, and the failing
// test named. Fail fast: the first failure stops the other shards.
//
// Why processes and not bun's own concurrency: a test file's preload
// (backend/tests/preload.ts) sets process-wide env (data dir, ports) at
// import time, so files only isolate from each other across processes.
// Each shard gets its own TMPDIR, so every mkdtemp the preload and the tests
// make lands in a folder this run deletes when it ends (the gate no longer
// leaves temp folders behind, TEST-TMP-LEAK-01).
//
// Usage: bun scripts/gate/shardTests.ts --dir backend [--root tests]
//          [--shards N] [--record] [-- extra bun test args]
//   --shards N   requested ceiling; the engine/OS memory budget and CPU cap
//                still apply (chooseShardCount)
//   --record     rewrites scripts/gate/test-timings.json for this workspace
//                from the junit reports of this run
import { Glob } from "bun";
import { cpus, freemem, tmpdir, totalmem } from "node:os";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import flakesFile from "./flakes.json";

export type Timings = Record<string, number>;

const TEST_GLOB = "**/*{.test,_test,.spec,_spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}";
export type FlakeEntry = { workspace: string; file: string; test: string; owner: string; date_added: string; deadline: string; cause: string; log: string; issue: number };
export type FlakeLedger = { version: 2; flakes: FlakeEntry[]; serial: Record<string, { file: string; reason: string }[]>; skipped: { workspace: string; file: string }[] };

export function validateLedger(value: unknown, today = new Date().toISOString().slice(0, 10)): FlakeLedger {
  if (!value || typeof value !== "object") throw new Error("flake ledger must be an object");
  const ledger = value as FlakeLedger;
  if (ledger.version !== 2 || !Array.isArray(ledger.flakes) || !ledger.serial || !Array.isArray(ledger.skipped)) throw new Error("flake ledger must use schema version 2 with flakes, serial, and skipped");
  if (ledger.skipped.length !== 0) throw new Error("flake ledger skipped must stay empty");
  const causes = new Set(["clock", "port", "network", "shared-state", "load-timeout", "order", "random", "unknown"]);
  const live = ledger.flakes.filter((entry) => entry.deadline >= today);
  if (live.length > 8) throw new Error(`flake ledger has ${live.length} live entries; maximum is 8`);
  for (const entry of ledger.flakes) {
    if (!entry.workspace || !entry.file || !entry.test || !entry.owner || !entry.log || !Number.isInteger(entry.issue) || entry.issue < 1 || !causes.has(entry.cause)) throw new Error(`invalid flake ledger entry: ${JSON.stringify(entry)}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date_added) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.deadline)) throw new Error(`flake dates must be YYYY-MM-DD: ${entry.file} ${entry.test}`);
    const days = (Date.parse(`${entry.deadline}T00:00:00Z`) - Date.parse(`${entry.date_added}T00:00:00Z`)) / 86400000;
    if (days < 0 || days > 7 || entry.date_added > today) throw new Error(`flake deadline must be within seven days of a non-future date: ${entry.file} ${entry.test}`);
  }
  return ledger;
}

const flakes = validateLedger(flakesFile);
const SERIAL_FILES: Record<string, string[]> = Object.fromEntries(
  Object.entries(flakes.serial).map(([workspace, entries]) => [workspace, entries.map(({ file }) => file)]),
);
const SKIPPED_FILES: Record<string, string[]> = Object.fromEntries(
  Object.entries(flakes.skipped.reduce<Record<string, string[]>>((byWorkspace, entry) => {
    (byWorkspace[entry.workspace] ??= []).push(entry.file);
    return byWorkspace;
  }, {})).map(([workspace, files]) => [workspace, files]),
);

/** Test files bun would discover under `root` of `dir`, as paths relative to `dir`, sorted. */
export function discoverTests(dir: string, root = "."): string[] {
  const base = join(dir, root);
  const out: string[] = [];
  for (const f of new Glob(TEST_GLOB).scanSync({ cwd: base, onlyFiles: true })) {
    if (f.includes("node_modules/") || f.startsWith("dist/") || f.includes("/dist/")) continue;
    out.push(root === "." ? f : `${root}/${f}`);
  }
  return out.sort();
}

/**
 * Longest-processing-time-first bin packing: heaviest file to the lightest
 * shard. A file with no recorded time gets the median of the recorded ones
 * (a new file is an average file until `--record` measures it). Within a shard
 * the heaviest files run first, so a shard never ends on its biggest file.
 */
export function balance(files: string[], timings: Timings, n: number): string[][] {
  const known = files.map((f) => timings[f]).filter((t): t is number => typeof t === "number").sort((a, b) => a - b);
  const median = known.length ? (known[Math.floor(known.length / 2)] as number) : 1;
  const weight = (f: string) => timings[f] ?? median;
  const shards = Array.from({ length: Math.max(1, n) }, () => ({ load: 0, files: [] as string[] }));
  for (const f of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    let lightest = shards[0] as (typeof shards)[number];
    for (const s of shards) if (s.load < lightest.load) lightest = s;
    lightest.files.push(f);
    lightest.load += weight(f);
  }
  // A file with no recorded time runs first in its shard: a brand-new test
  // is the likeliest to fail, and a red gate should say so in seconds.
  const unknownFirst = (a: string, b: string) => Number(timings[a] !== undefined) - Number(timings[b] !== undefined);
  return shards.map((s) => s.files.sort(unknownFirst)).filter((s) => s.length > 0);
}

/**
 * The requested shard count can never exceed the budget: reclaimable pages
 * are capped by total memory minus the Stack and OS/editor reserves, then
 * divided by the sampled peak of a prior worker or a conservative bootstrap
 * value. Worker count is also capped at half the cores and six, with at least
 * one worker when current memory pressure allows a new launch.
 */
export function chooseShardCount(opts: {
  env?: string | undefined;
  cores: number;
  /** Reclaimable pages, not the kernel's optimistic availability percentage. */
  freeGb: number;
  totalGb?: number;
  engineGb?: number;
  osReserveGb?: number;
  files: number;
  gbPerShard?: number;
}): number {
  const reclaimableGb = Math.min(opts.freeGb, Math.max(0, (opts.totalGb ?? Number.POSITIVE_INFINITY) - (opts.engineGb ?? 0) - (opts.osReserveGb ?? 0)));
  const gbPerShard = opts.gbPerShard ?? 1.25;
  const byCores = Math.max(1, Math.floor(opts.cores / 2));
  const byMem = Math.max(1, Math.floor(reclaimableGb / gbPerShard));
  const safeMaximum = Math.max(1, Math.min(byCores, byMem, opts.files, 6));
  const forced = Number.parseInt(opts.env ?? "", 10);
  if (Number.isInteger(forced) && forced > 0) return Math.min(forced, safeMaximum);
  return safeMaximum;
}

export type ResourceSnapshot = { reclaimableGb: number; totalGb: number; pressureLevel: number };

export function processTreeRssGb(rootPid: number): number {
  const res = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,rss="]);
  if (res.exitCode !== 0) return 0;
  const rows = res.stdout.toString().split(/\r?\n/).flatMap((line) => {
    const values = line.trim().split(/\s+/).map(Number);
    const [pid, ppid, rssKb] = values;
    return Number.isInteger(pid) && Number.isInteger(ppid) && Number.isFinite(rssKb)
      ? [{ pid: pid as number, ppid: ppid as number, rssKb: rssKb as number }]
      : [];
  });
  const children = new Map<number, typeof rows>();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  let rssKb = 0;
  const visit = (pid: number) => {
    for (const row of children.get(pid) ?? []) {
      rssKb += row.rssKb;
      visit(row.pid);
    }
  };
  const root = rows.find((row) => row.pid === rootPid);
  if (!root) return 0;
  rssKb += root.rssKb;
  visit(rootPid);
  return rssKb / 1024 ** 2;
}

/** Atomically reserves one shared worker slot across all gate runners on this machine. */
export function reserveWorkerSlot(directory: string, capacity: number, ownerPid = process.pid): string | null {
  mkdirSync(directory, { recursive: true });
  const perl = `
    use Fcntl qw(:flock O_CREAT O_EXCL O_WRONLY);
    my ($dir, $owner, $capacity) = @ARGV;
    open(my $lock, ">>", "$dir/.mutex") or die "worker slots: open mutex: $!\\n";
    flock($lock, LOCK_EX) or die "worker slots: lock mutex: $!\\n";
    my @live;
    for my $path (glob("$dir/slot-*")) {
      open(my $record, "<", $path) or next;
      my $pid = <$record> // "";
      close($record);
      $pid =~ s/\\s+\\z//;
      if ($pid =~ /^\\d+$/ && kill(0, $pid)) { push @live, $path; }
      else { unlink($path); }
    }
    exit 75 if @live >= $capacity;
    my $path = "$dir/slot-$owner-$$";
    sysopen(my $record, $path, O_CREAT | O_EXCL | O_WRONLY, 0600) or die "worker slots: create slot: $!\\n";
    print $record "$owner\\n";
    close($record);
    print "$path\\n";
  `;
  const result = Bun.spawnSync(["perl", "-e", perl, directory, String(ownerPid), String(capacity)]);
  if (result.exitCode === 75) return null;
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || `worker slots: could not reserve in ${directory}`);
  return result.stdout.toString().trim();
}

export function workerSlotCount(directory: string): number {
  mkdirSync(directory, { recursive: true });
  const perl = `
    use Fcntl qw(:flock);
    my ($dir) = @ARGV;
    open(my $lock, ">>", "$dir/.mutex") or die "worker slots: open mutex: $!\\n";
    flock($lock, LOCK_EX) or die "worker slots: lock mutex: $!\\n";
    my $count = 0;
    for my $path (glob("$dir/slot-*")) {
      open(my $record, "<", $path) or next;
      my $pid = <$record> // "";
      close($record);
      $pid =~ s/\\s+\\z//;
      if ($pid =~ /^\\d+$/ && kill(0, $pid)) { $count += 1; }
      else { unlink($path); }
    }
    print "$count\\n";
  `;
  const result = Bun.spawnSync(["perl", "-e", perl, directory]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || `worker slots: could not count ${directory}`);
  return Number(result.stdout.toString().trim());
}

export function parseStackBudget(data: unknown): number {
  if (!data || typeof data !== "object" || !Array.isArray((data as { loaded?: unknown }).loaded)) return 8;
  let bytes = 0;
  for (const loaded of (data as { loaded: unknown[] }).loaded) {
    if (!loaded || typeof loaded !== "object") return 8;
    const entry = loaded as { peakBytes?: unknown; measured?: unknown };
    if (typeof entry.peakBytes !== "number" || !Number.isFinite(entry.peakBytes) || entry.peakBytes < 0 || entry.measured !== true) return 8;
    bytes += entry.peakBytes;
  }
  return bytes / 1024 ** 3;
}

export async function engineResidentGb(stackUrl = process.env.MAIPAI_STACK_URL ?? "http://127.0.0.1:8770/stack/v1/hardware/budget"): Promise<number> {
  try {
    const response = await fetch(stackUrl, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return 8;
    return parseStackBudget(await response.json());
  } catch {
    return 8;
  }
}

export function memoryPressureLevel(): number {
  if (process.platform !== "darwin") return 0;
  const result = Bun.spawnSync(["sysctl", "-n", "kern.memorystatus_vm_pressure_level"]);
  const level = Number(result.stdout.toString().trim());
  return result.exitCode === 0 && Number.isFinite(level) ? level : 0;
}

export function resourceSnapshot(): ResourceSnapshot {
  return { reclaimableGb: availableGb(), totalGb: totalmem() / 1024 ** 3, pressureLevel: memoryPressureLevel() };
}

export interface Summary {
  pass: number;
  fail: number;
  tests: number;
  files: number;
}

/** Reads bun test's closing lines (" 12 pass", " 0 fail", "Ran 12 tests across 3 files."). */
export function parseSummary(output: string): Summary {
  const num = (re: RegExp) => Number(re.exec(output)?.[1] ?? 0);
  const footers = [...output.matchAll(/^Ran (\d+) tests? across (\d+) files?\./gm)];
  const footer = footers.at(-1);
  return {
    pass: num(/^\s*(\d+) pass\b/m),
    fail: num(/^\s*(\d+) fail\b/m),
    tests: Number(footer?.[1] ?? 0),
    files: Number(footer?.[2] ?? 0),
  };
}

/** A shard's whole log: what its tests printed to stdout, then bun's own
 * stderr report, which ends with the summary parseSummary() reads. */
export function readShardLog(logPath: string): string {
  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
  return `${read(`${logPath}.out`)}\n${read(logPath)}`;
}

/** The `(fail) ...` lines of a bun test log: the test names that went red. */
export function failedTests(output: string): string[] {
  return output.split("\n").filter((l) => l.startsWith("(fail)"));
}

/** Per-file seconds from a junit report: the sum of each file's testcase times. */
export function junitFileSeconds(xml: string): Timings {
  const out: Timings = {};
  for (const m of xml.matchAll(/<testcase\b[^>]*?\btime="([\d.]+)"[^>]*?\bfile="([^"]+)"/g)) {
    const file = m[2] as string;
    out[file] = (out[file] ?? 0) + Number(m[1]);
  }
  for (const k of Object.keys(out)) out[k] = Math.round((out[k] as number) * 100) / 100;
  return out;
}

function descendants(pid: number): number[] {
  const res = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid="]);
  const kids = new Map<number, number[]>();
  for (const line of res.stdout.toString().split("\n")) {
    const [p, pp] = line.trim().split(/\s+/).map(Number);
    if (!p || pp === undefined) continue;
    kids.set(pp, [...(kids.get(pp) ?? []), p]);
  }
  const all: number[] = [];
  const walk = (x: number) => {
    for (const k of kids.get(x) ?? []) {
      all.push(k);
      walk(k);
    }
  };
  walk(pid);
  return all;
}

function killTree(pid: number): void {
  for (const p of [...descendants(pid).reverse(), pid]) {
    try {
      process.kill(p, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

export interface RunOptions {
  dir: string;
  root?: string;
  shards?: number;
  record?: boolean;
  extraArgs?: string[];
  timingsPath?: string;
  ledger?: FlakeLedger;
  failureLog?: string;
  changedFiles?: string[];
  resourceProbe?: () => ResourceSnapshot | Promise<ResourceSnapshot>;
  engineGb?: number;
  gbPerShard?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  peakFile?: string;
  workerSlotsDir?: string;
}

export async function run(opts: RunOptions): Promise<number> {
  const dir = resolve(opts.dir);
  const label = opts.dir.replace(/\/$/, "").split("/").pop() ?? "tests";
  const timingsPath = opts.timingsPath ?? join(import.meta.dir, "test-timings.json");
  const allTimings: Record<string, Timings> = existsSync(timingsPath) ? JSON.parse(readFileSync(timingsPath, "utf8")) : {};
  const discovered = discoverTests(dir, opts.root ?? ".");
  const ledger = validateLedger(opts.ledger ?? flakes);
  const serial = SERIAL_FILES[label] ?? [];
  const skipped = SKIPPED_FILES[label] ?? [];
  const files = discovered.filter((f) => !serial.includes(f) && !skipped.includes(f));
  const serialFiles = discovered.filter((f) => serial.includes(f));
  if (files.length === 0 && serialFiles.length === 0) {
    console.log(`shard: no test files under ${dir}`);
    return 0;
  }
  const probe = opts.resourceProbe ?? resourceSnapshot;
  const workerSlotsDir = opts.workerSlotsDir;
  const initialResources = await probe();
  const engineGb = opts.engineGb ?? await engineResidentGb();
  const peakFile = opts.peakFile ?? (process.env.MAIPAI_GATE_SHARD_PEAKS_DIR ? join(process.env.MAIPAI_GATE_SHARD_PEAKS_DIR, `${label}.json`) : undefined);
  let shardPeakGb = opts.gbPerShard ?? 1.25;
  if (peakFile && existsSync(peakFile)) {
    try {
      const saved = Number(JSON.parse(readFileSync(peakFile, "utf8")).peakGb);
      if (Number.isFinite(saved) && saved > 0) shardPeakGb = Math.max(shardPeakGb, saved);
    } catch { /* use the conservative bootstrap peak */ }
  }
  const initialReservedGb = workerSlotsDir ? workerSlotCount(workerSlotsDir) * shardPeakGb : 0;
  const maxWorkers = files.length === 0 ? 0 : chooseShardCount({
    env: process.env.MAIPAI_GATE_SHARDS,
    cores: cpus().length,
    freeGb: initialResources.reclaimableGb + initialReservedGb,
    totalGb: initialResources.totalGb,
    engineGb,
    osReserveGb: 3,
    files: files.length,
    gbPerShard: shardPeakGb,
  });
  const requestedWorkers = opts.shards === undefined ? maxWorkers : Math.max(1, Math.min(opts.shards, maxWorkers));
  const n = files.length === 0 ? 0 : requestedWorkers;
  const plan = balance(files, allTimings[label] ?? {}, n);
  const started = Date.now();
  const scratch = mkdtempSync(join(tmpdir(), "maipai-gate-shards-"));
  console.log(`shard: ${label}: ${files.length} parallel files in ${plan.length} shards; ${serialFiles.length} serial; ${skipped.length} skipped (workers capped by ${shardPeakGb.toFixed(2)} GB measured/bootstrap peak, engine reserve ${engineGb.toFixed(2)} GB, pressure ${initialResources.pressureLevel})`);

  interface Live {
    index: number;
    proc: ReturnType<typeof Bun.spawn>;
    logPath: string;
    junit: string;
    done: Promise<number>;
    files: string[];
  }
  const live: Live[] = [];
  const active = new Set<Live>();
  let firstFail: { shard: Live; code: number; line?: string } | null = null;
  let maxObservedPeakGb = 0;
  const flakyCandidates = new Map<string, { entry: FlakeEntry; line: string }>();
  const liveEntries = ledger.flakes.filter((entry) => entry.deadline >= new Date().toISOString().slice(0, 10));
  const changedFiles = opts.changedFiles ?? changedTestFiles(dir, liveEntries);
  const eligible = (entry: FlakeEntry) => entry.workspace === label && !changedFiles.includes(entry.file);
  const uniqueTestFile = (entry: FlakeEntry) => {
    const leaf = entry.test.split(" > ").at(-1) ?? entry.test;
    const quotedTitle = new RegExp(`\\b(?:test|it)\\s*\\(\\s*(["'\x60])${leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`);
    return discovered.filter((file) => quotedTitle.test(readFileSync(join(dir, file), "utf8")));
  };
  const recordFlaky = (entry: FlakeEntry, line: string) => {
    if (opts.failureLog ?? process.env.GATE_FAILURE_LOG) appendFileSync(opts.failureLog ?? process.env.GATE_FAILURE_LOG as string, `flaky\t${entry.workspace}/${entry.file} > ${entry.test}\t${entry.owner}\t${entry.deadline}\t${line}\n`);
  };
  const cleanFailureName = (line: string) => line.replace(/^\(fail\)\s*/, "").replace(/\s+\[[^\]]+\]\s*$/, "").trim();
  const isListed = (line: string, shardFiles: string[]) => {
    const name = cleanFailureName(line);
    const found = liveEntries.filter((entry) => eligible(entry) && shardFiles.includes(entry.file) && entry.test === name && uniqueTestFile(entry).length === 1 && uniqueTestFile(entry)[0] === entry.file);
    return found.length === 1 ? found[0] : undefined;
  };
  const stopAll = (except?: Live) => {
    for (const s of active) if (s !== except) killTree(s.proc.pid);
  };

  const launchShard = (shardFiles: string[], index: number, slot: string | undefined) => {
    const tmp = join(scratch, `s${index}`);
    Bun.spawnSync(["mkdir", "-p", tmp]);
    const logPath = join(scratch, `s${index}.log`);
    const junit = join(scratch, `s${index}.xml`);
    const args = ["test", ...(opts.record ? [`--reporter=junit`, `--reporter-outfile=${junit}`] : []), ...(opts.extraArgs ?? []), ...shardFiles.map((f) => (f.startsWith("./") ? f : `./${f}`))];
    const proc = Bun.spawn(["bun", ...args], {
      cwd: dir,
      env: { ...process.env, TMPDIR: tmp },
      // Two sinks on one path each write from offset 0 and overwrite each
      // other (a test that prints to stdout clobbered bun's own summary on
      // stderr, so a green shard read as "ran 1 of 9 files"): stdout gets
      // its own file and readShardLog() joins them, the summary last.
      stdout: "pipe",
      stderr: "pipe",
    });
    const shard: Live = { index, proc, logPath, junit, files: shardFiles, done: Promise.resolve(0) };
    active.add(shard);
    setSlotOwner(slot, proc.pid);
    let shardPeakGb = processTreeRssGb(proc.pid);
    maxObservedPeakGb = Math.max(maxObservedPeakGb, shardPeakGb);
    const sampler = setInterval(() => {
      shardPeakGb = Math.max(shardPeakGb, processTreeRssGb(proc.pid));
      maxObservedPeakGb = Math.max(maxObservedPeakGb, shardPeakGb);
    }, 1000);
    const drain = async (stream: ReadableStream<Uint8Array>, path: string) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        appendFileSync(path, chunk);
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("(fail)")) continue;
          const entry = isListed(line, shardFiles);
          if (entry) flakyCandidates.set(`${entry.workspace}/${entry.file}\0${entry.test}`, { entry, line });
          else if (!firstFail) {
            firstFail = { shard, code: 1, line };
            stopAll(shard);
          }
        }
      }
      if (pending.startsWith("(fail)")) {
        const entry = isListed(pending, shardFiles);
        if (entry) flakyCandidates.set(`${entry.workspace}/${entry.file}\0${entry.test}`, { entry, line: pending });
        else if (!firstFail) { firstFail = { shard, code: 1, line: pending }; stopAll(shard); }
      }
    };
    shard.done = Promise.all([drain(proc.stdout, `${logPath}.out`), drain(proc.stderr, logPath), proc.exited]).then(([, , code]) => {
      const failures = failedTests(readShardLog(logPath));
      const allListed = failures.length > 0 && failures.every((line) => isListed(line, shardFiles));
      if (code !== 0 && !allListed && !firstFail) { firstFail = { shard, code }; stopAll(shard); }
      return code;
    }).finally(() => {
      clearInterval(sampler);
      shardPeakGb = Math.max(shardPeakGb, processTreeRssGb(proc.pid));
      maxObservedPeakGb = Math.max(maxObservedPeakGb, shardPeakGb);
      active.delete(shard);
      releaseSlot(slot);
    });
    live.push(shard);
  };

  const onSignal = () => {
    stopAll();
    rmSync(scratch, { recursive: true, force: true });
    process.exit(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const pause = opts.sleep ?? ((milliseconds: number) => Bun.sleep(milliseconds));
  const waitForPressureRelief = async () => {
    while (true) {
      const resources = await probe();
      if (resources.pressureLevel < 2) return;
      console.log(`shard: pressure ${resources.pressureLevel}; pausing new workers`);
      await pause(1000);
    }
  };
  const reserveSharedSlot = (capacity: number) => workerSlotsDir ? reserveWorkerSlot(workerSlotsDir, capacity) : undefined;
  const setSlotOwner = (slot: string | undefined, pid: number) => {
    if (!slot) return;
    const replacement = join(dirname(slot), `.worker-slot-owner-${process.pid}`);
    writeFileSync(replacement, `${pid}\n`);
    renameSync(replacement, slot);
  };
  const releaseSlot = (slot: string | undefined) => {
    if (slot) rmSync(slot, { force: true });
  };
  const reserveForSingleWorker = async () => {
    while (true) {
      const resources = await probe();
      if (resources.pressureLevel >= 2) {
        console.log(`shard: pressure ${resources.pressureLevel}; pausing new workers`);
        await pause(1000);
        continue;
      }
      const reservedGb = workerSlotsDir ? workerSlotCount(workerSlotsDir) * shardPeakGb : 0;
      const capacity = chooseShardCount({ cores: cpus().length, freeGb: resources.reclaimableGb + reservedGb, totalGb: resources.totalGb, engineGb, osReserveGb: 3, files: 6, gbPerShard: shardPeakGb });
      const slot = reserveSharedSlot(capacity);
      if (slot !== null) return slot;
      console.log("shard: waiting for a shared worker slot");
      await pause(1000);
    }
  };
  let nextShard = 0;
  while (nextShard < plan.length || active.size > 0) {
    if (firstFail) break;
    const resources = await probe();
    if (firstFail) break;
    const currentCap = chooseShardCount({
      cores: cpus().length,
      freeGb: resources.reclaimableGb + (workerSlotsDir ? workerSlotCount(workerSlotsDir) * shardPeakGb : 0),
      totalGb: resources.totalGb,
      engineGb,
      osReserveGb: 3,
      files: Math.max(1, plan.length),
      gbPerShard: shardPeakGb,
    });
    const globalCap = chooseShardCount({
      cores: cpus().length,
      freeGb: resources.reclaimableGb + (workerSlotsDir ? workerSlotCount(workerSlotsDir) * shardPeakGb : 0),
      totalGb: resources.totalGb,
      engineGb,
      osReserveGb: 3,
      files: 6,
      gbPerShard: shardPeakGb,
    });
    if (resources.pressureLevel >= 2 || active.size >= currentCap || nextShard >= plan.length) {
      if (active.size > 0) {
        await Promise.race([...active].map((shard) => shard.done));
      } else if (nextShard < plan.length) {
        console.log(`shard: pressure ${resources.pressureLevel}; pausing new workers`);
        await pause(1000);
      }
      continue;
    }
    const slot = reserveSharedSlot(globalCap);
    if (slot === null) {
      console.log("shard: waiting for a shared worker slot");
      if (active.size > 0) await Promise.race([...active].map((shard) => shard.done));
      else await pause(1000);
      continue;
    }
    launchShard(plan[nextShard] as string[], nextShard, slot);
    nextShard += 1;
  }
  await Promise.all(live.map((s) => s.done));

  // Real network tests and UI fetch mocks run alone after parallel shards to
  // avoid cross-file multicast and process-global fetch interference.
  for (const file of serialFiles) {
    if (firstFail) break;
    const slot = await reserveForSingleWorker();
    const proc = Bun.spawn(["bun", "test", file.startsWith("./") ? file : `./${file}`], {
      cwd: dir,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    setSlotOwner(slot, proc.pid);
    let serialPeakGb = processTreeRssGb(proc.pid);
    const serialSampler = setInterval(() => {
      serialPeakGb = Math.max(serialPeakGb, processTreeRssGb(proc.pid));
      maxObservedPeakGb = Math.max(maxObservedPeakGb, serialPeakGb);
    }, 1000);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    releaseSlot(slot);
    clearInterval(serialSampler);
    serialPeakGb = Math.max(serialPeakGb, processTreeRssGb(proc.pid));
    maxObservedPeakGb = Math.max(maxObservedPeakGb, serialPeakGb);
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    if (code !== 0) {
      const failures = failedTests(`${stdout}\n${stderr}`);
      const allListed = failures.length > 0 && failures.every((line) => isListed(line, [file]));
      if (allListed) for (const line of failures) { const entry = isListed(line, [file]); if (entry) flakyCandidates.set(`${entry.workspace}/${entry.file}\0${entry.test}`, { entry, line }); }
      else firstFail = { shard: { index: plan.length, proc, logPath: "", junit: "", files: [file], done: Promise.resolve(code) }, code, line: failures[0] };
    }
  }

  // Rerun each listed, unchanged test once, by its exact name, after all
  // shards have finished. Expired entries were excluded above and therefore
  // fail fast as ordinary failures.
  if (!firstFail) for (const { entry, line } of flakyCandidates.values()) {
    const slot = await reserveForSingleWorker();
    const exactName = `^${entry.test.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
    const proc = Bun.spawn(["bun", "test", entry.file, "-t", exactName], { cwd: dir, env: process.env, stdout: "pipe", stderr: "pipe" });
    setSlotOwner(slot, proc.pid);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const rerunCode = await proc.exited;
    releaseSlot(slot);
    if (rerunCode !== 0) {
      process.stdout.write(stdout);
      process.stderr.write(stderr);
      firstFail = { shard: { index: plan.length, proc, logPath: "", junit: "", files: [entry.file], done: Promise.resolve(rerunCode) }, code: rerunCode, line };
      break;
    }
    console.log(`FLAKY ${entry.workspace}/${entry.file} > ${entry.test} (passed on one isolated rerun)`);
    recordFlaky(entry, line);
  }

  if (peakFile && maxObservedPeakGb > 0) {
    try {
      mkdirSync(dirname(peakFile), { recursive: true });
      writeFileSync(peakFile, `${JSON.stringify({ peakGb: maxObservedPeakGb, measuredAt: new Date().toISOString(), platform: process.platform })}\n`);
      console.log(`shard: sampled peak ${maxObservedPeakGb.toFixed(2)} GB per worker; budget floor ${shardPeakGb.toFixed(2)} GB; saved ${peakFile}`);
    } catch (error) {
      console.warn(`shard: could not save measured worker peak: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const elapsed = (Date.now() - started) / 1000;
  let code = 0;
  const failure = firstFail as { shard: Live; code: number; line?: string } | null;
  if (failure) {
    code = failure.code;
    const out = failure.shard.logPath ? readShardLog(failure.shard.logPath) : (failure.line ?? "");
    const lines = out.split("\n");
    console.log(`== shard ${failure.shard.index + 1}/${plan.length} FAILED (exit ${code}); the other shards were stopped. Its last 120 lines:`);
    console.log(lines.slice(-120).join("\n"));
    const failed = failedTests(out);
    console.log(`shard: ${label}: FAILED after ${elapsed.toFixed(1)}s, ${failed.length} failing test(s):`);
    for (const l of failed) console.log(`  ${l}`);
    // A failure that does not repeat alone usually depends on which files
    // shared the process: name them, in run order, to reproduce it.
    console.log(`shard: files in the failing shard, in run order: ${failure.shard.files.join(" ")}`);
  } else {
    const total: Summary = { pass: 0, fail: 0, tests: 0, files: 0 };
    for (const s of live) {
      const sm = parseSummary(readShardLog(s.logPath));
      total.pass += sm.pass;
      total.fail += sm.fail;
      total.tests += sm.tests;
      total.files += sm.files;
    }
    console.log(`shard: ${label}: ${total.pass} pass, ${total.fail} fail`);
    console.log(`Ran ${total.tests} tests across ${total.files} files in ${plan.length} shards. [${elapsed.toFixed(1)}s]`);
    if (total.files !== files.length) {
      console.log(`shard: ${label}: expected ${files.length} files but bun ran ${total.files}; a shard did not finish cleanly`);
      code = 1;
    }
    if (opts.record && code === 0) {
      const merged: Timings = {};
      for (const s of live) Object.assign(merged, junitFileSeconds(existsSync(s.junit) ? readFileSync(s.junit, "utf8") : ""));
      for (const f of files) merged[f] ??= 0.1;
      allTimings[label] = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
      writeFileSync(timingsPath, `${JSON.stringify(allTimings, null, 1)}\n`);
      console.log(`shard: recorded ${files.length} timings for ${label} in ${timingsPath}`);
    }
  }
  rmSync(scratch, { recursive: true, force: true });
  return code;
}

function changedTestFiles(dir: string, entries: FlakeEntry[]): string[] {
  if (!entries.length) return [];
  const base = process.env.GATE_DIFF_BASE;
  if (!base) return entries.map((entry) => entry.file);
  const result = Bun.spawnSync(["git", "diff", "--name-only", base, "--", ...entries.map((entry) => entry.file)], { cwd: dir });
  const untracked = Bun.spawnSync(["git", "ls-files", "--others", "--exclude-standard", "--", ...entries.map((entry) => entry.file)], { cwd: dir });
  if (result.exitCode !== 0 || untracked.exitCode !== 0) return entries.map((entry) => entry.file);
  return [...new Set([...result.stdout.toString().split(/\r?\n/), ...untracked.stdout.toString().split(/\r?\n/)].filter(Boolean))];
}

/** Reclaimable memory in GB (free + inactive + speculative + purgeable pages on macOS). */
export function availableGb(): number {
  try {
    if (process.platform === "darwin") {
      const out = Bun.spawnSync(["vm_stat"]).stdout.toString();
      const page = Number(/page size of (\d+) bytes/.exec(out)?.[1] ?? 16384);
      const pages = (k: string) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(out)?.[1] ?? 0);
      const reclaimable = ((pages("Pages free") + pages("Pages inactive") + pages("Pages speculative") + pages("Pages purgeable")) * page) / 1024 ** 3;
      return reclaimable;
    }
    const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync("/proc/meminfo", "utf8"));
    if (m) return Number(m[1]) / 1024 ** 2;
  } catch {
    /* fall through */
  }
  return freemem() / 1024 ** 3;
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const sep = argv.indexOf("--");
  const own = sep === -1 ? argv : argv.slice(0, sep);
  const extraArgs = sep === -1 ? [] : argv.slice(sep + 1);
  const get = (k: string) => {
    const i = own.indexOf(k);
    return i === -1 ? undefined : own[i + 1];
  };
  const dir = get("--dir");
  if (!dir) {
    console.error("usage: bun scripts/gate/shardTests.ts --dir <workspace> [--root tests] [--shards N] [--record] [-- bun test args]");
    process.exit(2);
  }
  const shards = get("--shards") ? Number(get("--shards")) : undefined;
  const code = await run({ dir, root: get("--root"), shards, record: own.includes("--record"), extraArgs, workerSlotsDir: process.env.MAIPAI_GATE_WORKER_SLOTS_DIR });
  console.log(`shard: exit ${code}`);
  process.exit(code);
}
