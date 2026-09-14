#!/usr/bin/env bun
// EVAL-07 replay, one OS process per question instead of one process for
// the whole run: found live, 2026-09-14 (docs/BACKLOG.md's own EVAL-07
// item carries the finding for a later fix) - three single-process
// oracle-v0 runs in a row were killed by macOS for low memory, each
// getting further than the last with no other process's own
// interference to explain it. resetReplayDatabase()'s own wipe is
// logical (DELETE statements against SQLite); it never returns the
// process's own resident memory to the OS, only a process EXIT does.
// This script spawns a fresh `bun run replay.ts --only <id>` per
// question instead, so the OS reclaims everything between questions -
// same seed, same order as the manifest itself (never re-derived), so
// this is exactly as reproducible as one process would have been.
//
// Each subprocess's own peak memory footprint (maximum resident set
// size, sampled by polling `ps -o rss=` on its own pid from just after
// spawn to just before it exits - macOS has no cheaper way to see a
// live process's own RSS mid-run) is attached to that question's own
// [replay-question] row as processStartRssKb/processEndRssKb, so the
// growth this script exists to route around is also a number on
// record, not just an assumption.
//
// Usage: bun run backend/scripts/bench/datasets/replay-per-question.ts
// --dataset longmemeval-oracle-v0
import { readFileSync, appendFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stripHeaderBlock, attachRss, parseFreeMemoryMb } from "./replayPerQuestionLog";

// The defensive check the coordinator asked for after this script's own
// per-process redesign still got killed for low memory: the per-
// process footprint itself was small and properly released (found
// live, 2026-09-14 - question 1 of that run used 264MB and exited
// clean). Turned out the kills themselves were the harness's own
// background-task monitor stopping a tracked task when free memory
// looked low, not macOS killing the process - free memory on this
// machine sits near ~90MB as its own steady state whenever the 8B
// engine's mapped model pages are touched (macOS reclaims that
// instantly on demand; it was never real pressure). Running detached
// (nohup, disowned, watched via Monitor - never a harness-tracked
// foreground wait) is the actual fix; this guard is now a much
// cheaper belt-and-suspenders, not the primary defense - a 90MB
// steady state under the original 400MB/120s settings meant this
// waited its full two minutes before EVERY question, 35 times, over
// an hour of nothing. Lowered accordingly, 2026-09-14, same machine
// session - a run already in flight when this changed keeps the
// settings it started with (nothing here hot-reloads a running
// process); only a later run picks up the new numbers.
const MIN_FREE_MB = 400;
const MAX_WAIT_MS = 10_000;
const WAIT_POLL_MS = 5_000;

function freeMemoryMb(): number | null {
  const proc = Bun.spawnSync(["vm_stat"]);
  return parseFreeMemoryMb(proc.stdout.toString());
}

async function waitForMemory(): Promise<void> {
  const start = Date.now();
  let free = freeMemoryMb();
  let waited = false;
  // A parse failure fails open (proceed immediately) rather than
  // waiting on a number this function can never see change.
  while (free !== null && free < MIN_FREE_MB) {
    waited = true;
    const elapsedMs = Date.now() - start;
    console.error(`[replay-per-question] waiting for memory: free ${free.toFixed(0)}MB < ${MIN_FREE_MB}MB (${(elapsedMs / 1000).toFixed(0)}s elapsed)`);
    if (elapsedMs >= MAX_WAIT_MS) {
      console.error(`[replay-per-question] gave up waiting after ${(elapsedMs / 1000).toFixed(0)}s (still ${free.toFixed(0)}MB free) - proceeding anyway`);
      return;
    }
    await Bun.sleep(WAIT_POLL_MS);
    free = freeMemoryMb();
  }
  if (waited && free !== null && free >= MIN_FREE_MB) {
    console.error(`[replay-per-question] free memory now ${free.toFixed(0)}MB, proceeding`);
  }
}

function datasetFromArgv(argv: readonly string[]): string {
  const at = argv.indexOf("--dataset");
  return at >= 0 ? (argv[at + 1] ?? "longmemeval-oracle-v0") : "longmemeval-oracle-v0";
}

const dataset = datasetFromArgv(process.argv);
const manifestFile = dataset === "longmemeval-oracle-v0" ? "oracle-v0-manifest.json" : (() => {
  console.error(`replay-per-question setup refused: no manifest known for --dataset "${dataset}" (only longmemeval-oracle-v0 today)`);
  process.exit(2);
})();

const manifestPath = join(import.meta.dir, manifestFile);
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { entries: { questionId: string }[] };
const ids = manifest.entries.map((e) => e.questionId);

const backendDir = join(import.meta.dir, "..", "..", "..");
const outDir = join(backendDir, "..", "data-scratch", "eval");
mkdirSync(outDir, { recursive: true });
const combinedLogPath = join(outDir, `replay-${dataset}-per-question.log`);
writeFileSync(combinedLogPath, "");

function rssKbOf(pid: number): number | null {
  const proc = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)]);
  const text = proc.stdout.toString().trim();
  return text ? Number(text) : null;
}

interface QuestionResult {
  questionId: string;
  startRssKb: number | null;
  endRssKb: number | null;
  exitCode: number | null;
}

const results: QuestionResult[] = [];
let headerWritten = false;

for (const [i, id] of ids.entries()) {
  await waitForMemory();
  console.error(`[replay-per-question] ${i + 1}/${ids.length} starting ${id}`);
  // setup.ts (imported inside replay.ts) refuses to run without its
  // own fresh, empty MAIPAI_DATA_DIR under the OS temp root - a fixed
  // one reused across questions would fail its own "never reuses a
  // directory" check the second time around, so each subprocess gets
  // its own, removed once that subprocess exits.
  const dataDir = mkdtempSync(join(tmpdir(), "maipai-replay-per-question-"));
  const proc = Bun.spawn(
    ["bun", "run", "scripts/bench/datasets/replay.ts", "--dataset", dataset, "--only", id],
    { cwd: backendDir, env: { ...process.env, MAIPAI_DATA_DIR: dataDir }, stdout: "pipe", stderr: "pipe" },
  );

  const startRssKb = rssKbOf(proc.pid);
  let lastRssKb = startRssKb;
  const poll = setInterval(() => {
    const r = rssKbOf(proc.pid);
    if (r !== null) lastRssKb = r;
  }, 3000);

  const [stdoutText, stderrText] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  clearInterval(poll);
  const endRssKb = lastRssKb;

  console.error(`[replay-per-question] ${i + 1}/${ids.length} ${id} done (exit ${exitCode}, RSS ${startRssKb ?? "?"}KB -> ${endRssKb ?? "?"}KB)`);
  // Loud per-question, not just in the end-of-run summary: a setup
  // refusal (a bad env var, a stale data dir) fails every question the
  // same way in seconds, and a summary read only after all 35 "finish"
  // is how that went unnoticed the first time this script ran.
  if (exitCode !== 0) console.error(`[replay-per-question] ${id} exited ${exitCode} - stderr: ${stderrText.slice(0, 500)}`);

  let block = stdoutText;
  if (headerWritten) block = stripHeaderBlock(block);
  else headerWritten = true;
  block = attachRss(block, startRssKb, endRssKb);

  appendFileSync(combinedLogPath, block);
  if (stderrText.trim()) appendFileSync(combinedLogPath, `[replay-per-question stderr, ${id}]\n${stderrText}\n`);

  rmSync(dataDir, { recursive: true, force: true });
  results.push({ questionId: id, startRssKb, endRssKb, exitCode });
}

const failed = results.filter((r) => r.exitCode !== 0);
console.log(`\nWrote combined per-question log to ${combinedLogPath}`);
console.log(`${results.length} questions run, ${failed.length} process(es) exited non-zero${failed.length ? `: ${failed.map((r) => r.questionId).join(", ")}` : ""}`);
const rssDeltas = results.filter((r) => r.startRssKb !== null && r.endRssKb !== null).map((r) => r.endRssKb! - r.startRssKb!);
if (rssDeltas.length > 0) {
  const meanKb = rssDeltas.reduce((a, b) => a + b, 0) / rssDeltas.length;
  console.log(`per-process RSS growth (end - start): mean ${(meanKb / 1024).toFixed(1)}MB, min ${(Math.min(...rssDeltas) / 1024).toFixed(1)}MB, max ${(Math.max(...rssDeltas) / 1024).toFixed(1)}MB`);
}
