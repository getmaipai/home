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
//   --shards N   shard count; default from MAIPAI_GATE_SHARDS, else chosen
//                from cores and free memory (chooseShardCount)
//   --record     rewrites scripts/gate/test-timings.json for this workspace
//                from the junit reports of this run
import { Glob } from "bun";
import { cpus, freemem, tmpdir, totalmem } from "node:os";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type Timings = Record<string, number>;

const TEST_GLOB = "**/*{.test,_test,.spec,_spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}";

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
 * Shard count: MAIPAI_GATE_SHARDS wins when set to a positive integer.
 * Otherwise half the cores (the Stack engine and the other legs need the
 * rest), capped by free memory at `gbPerShard` each (measured: ~0.4 GB per backend shard), never below 1 or above
 * the file count, and 6 at most (the Stack engine and the other suite need the rest). The memory budget keeps a 24 GB laptop that also runs the
 * Stack engine out of swap.
 */
export function chooseShardCount(opts: {
  env?: string | undefined;
  cores: number;
  freeGb: number;
  files: number;
  gbPerShard?: number;
}): number {
  const forced = Number.parseInt(opts.env ?? "", 10);
  if (Number.isInteger(forced) && forced > 0) return Math.min(forced, Math.max(1, opts.files));
  const byCores = Math.floor(opts.cores / 2);
  const byMem = Math.floor(opts.freeGb / (opts.gbPerShard ?? 0.8));
  return Math.max(1, Math.min(byCores, byMem, opts.files, 6));
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
}

export async function run(opts: RunOptions): Promise<number> {
  const dir = resolve(opts.dir);
  const label = opts.dir.replace(/\/$/, "").split("/").pop() ?? "tests";
  const timingsPath = opts.timingsPath ?? join(import.meta.dir, "test-timings.json");
  const allTimings: Record<string, Timings> = existsSync(timingsPath) ? JSON.parse(readFileSync(timingsPath, "utf8")) : {};
  const files = discoverTests(dir, opts.root ?? ".");
  if (files.length === 0) {
    console.log(`shard: no test files under ${dir}`);
    return 0;
  }
  const freeGb = (freemem() + 0) / 1024 ** 3;
  const n = opts.shards ?? chooseShardCount({ env: process.env.MAIPAI_GATE_SHARDS, cores: cpus().length, freeGb: Math.max(freeGb, availableGb()), files: files.length });
  const plan = balance(files, allTimings[label] ?? {}, n);
  const started = Date.now();
  const scratch = mkdtempSync(join(tmpdir(), "maipai-gate-shards-"));
  console.log(`shard: ${label}: ${files.length} files in ${plan.length} shards (cores ${cpus().length}, ${(totalmem() / 1024 ** 3).toFixed(0)} GB)`);

  interface Live {
    index: number;
    proc: ReturnType<typeof Bun.spawn>;
    logPath: string;
    junit: string;
    done: Promise<number>;
    files: string[];
  }
  const live: Live[] = [];
  let firstFail: { shard: Live; code: number } | null = null;
  const stopAll = (except?: Live) => {
    for (const s of live) if (s !== except) killTree(s.proc.pid);
  };

  plan.forEach((shardFiles, index) => {
    const tmp = join(scratch, `s${index}`);
    Bun.spawnSync(["mkdir", "-p", tmp]);
    const logPath = join(scratch, `s${index}.log`);
    const junit = join(scratch, `s${index}.xml`);
    const args = ["test", "--bail", ...(opts.record ? [`--reporter=junit`, `--reporter-outfile=${junit}`] : []), ...(opts.extraArgs ?? []), ...shardFiles.map((f) => (f.startsWith("./") ? f : `./${f}`))];
    const proc = Bun.spawn(["bun", ...args], {
      cwd: dir,
      env: { ...process.env, TMPDIR: tmp },
      stdout: Bun.file(logPath),
      stderr: Bun.file(logPath),
    });
    const shard: Live = { index, proc, logPath, junit, files: shardFiles, done: Promise.resolve(0) };
    shard.done = proc.exited.then((code) => {
      if (code !== 0 && !firstFail) {
        firstFail = { shard, code };
        stopAll(shard);
      }
      return code;
    });
    live.push(shard);
  });

  const onSignal = () => {
    stopAll();
    rmSync(scratch, { recursive: true, force: true });
    process.exit(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  await Promise.all(live.map((s) => s.done));

  const elapsed = (Date.now() - started) / 1000;
  let code = 0;
  const failure = firstFail as { shard: Live; code: number } | null;
  if (failure) {
    code = failure.code;
    const out = existsSync(failure.shard.logPath) ? readFileSync(failure.shard.logPath, "utf8") : "";
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
      const sm = parseSummary(readFileSync(s.logPath, "utf8"));
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

/** Reclaimable memory in GB (free + inactive + speculative pages on macOS, MemAvailable on Linux). */
export function availableGb(): number {
  try {
    if (process.platform === "darwin") {
      const out = Bun.spawnSync(["vm_stat"]).stdout.toString();
      const page = Number(/page size of (\d+) bytes/.exec(out)?.[1] ?? 16384);
      const pages = (k: string) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(out)?.[1] ?? 0);
      const reclaimable = ((pages("Pages free") + pages("Pages inactive") + pages("Pages speculative")) * page) / 1024 ** 3;
      // The kernel's own free percentage also counts what it can compress or purge.
      const level = Number(Bun.spawnSync(["sysctl", "-n", "kern.memorystatus_level"]).stdout.toString().trim());
      return Math.max(reclaimable, Number.isFinite(level) ? (level / 100) * (totalmem() / 1024 ** 3) : 0);
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
  const code = await run({ dir, root: get("--root"), shards, record: own.includes("--record"), extraArgs });
  console.log(`shard: exit ${code}`);
  process.exit(code);
}
