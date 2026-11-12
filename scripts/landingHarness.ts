// Landing acceptance harness (SINGLE-WRITER-01, 2026-11-12). Runs the real lander, land.sh and pipeline.sh against a scratch repository
// (the lander test fixtures; never the real pipeline, never GitHub) and prints measured results:
//   1. several sessions land at once (different files) plus one conflicting pair: all land in order, GitHub main == pipeline main, no STUCK;
//   2. express priority without starvation: an express entry starts at the next transaction boundary, at most 2 in a row, and a normal
//      entry past the (shortened) wait limit is served;
//   3. queue time and run time per landing, with per-step seconds, from landings.jsonl and pipeline.sh status;
//   4. preview responsiveness: HTTP latency of a stand-in local server (a separate process, like a session's dev hub) at rest and while
//      landings run (and, with --real-check, while this worktree's real `check.sh --pre` runs, the lander's heaviest step).
// usage: bun scripts/landingHarness.ts [--quick] [--real-check] [--json]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLanderFixtures } from "./tests/landerFixtures";

const args = new Set(process.argv.slice(2));
const quick = args.has("--quick");
const fx = createLanderFixtures();
const { scratch, origin, main, data, env, git, makeWorktree, commit, setup, cleanup } = fx;
const sh = (cmd: string[], cwd = main, extra: Record<string, string> = {}) => Bun.spawnSync(cmd, { cwd, env: { ...env, ...extra } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
const landings = () => readFileSync(join(data, "landings.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };
const sleep = (ms: number) => Bun.sleep(ms);

function startLander(extra: Record<string, string>) {
  return Bun.spawn(["bash", join(main, "scripts", "lander.sh"), "serve"], { cwd: main, env: { ...env, MAIPAI_LAND_POLL_SECONDS: "1", ...extra } as Record<string, string>, stdout: "ignore", stderr: "ignore" });
}
async function stopLander(p: ReturnType<typeof startLander>) { p.kill("SIGTERM"); await p.exited; }
async function untilQueueEmpty(maxMs: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const q = sh(["bash", "-c", `ls ${join(data, "queue")}/*.json 2>/dev/null | wc -l`]).stdout.toString().trim();
    if (q === "0" && sh(["test", "-e", join(data, "current-entry")]).exitCode !== 0) return true;
    await sleep(250);
  }
  return false;
}
function queueLand(w: string, express = false) {
  return Bun.spawn(["bash", join(main, "scripts", "land.sh"), "--queue-anyway", ...(express ? ["--express", "--timeout", "120"] : ["--detach"])], { cwd: w, env: env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
}

// A stand-in for a session's private preview: its own process answering HTTP, doing a little work per request like a dev server.
async function startPreview() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const code = `Bun.serve({ port: ${port}, hostname: "127.0.0.1", fetch() { let h = 0; for (let i = 0; i < 20000; i++) h = (h * 31 + i) | 0; return new Response("<html>" + h + "</html>", { headers: { "content-type": "text/html" } }); } }); setInterval(() => {}, 1 << 30);`;
  const p = Bun.spawn(["bun", "-e", code], { stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await sleep(50); } }
  return { p, url: `http://127.0.0.1:${port}/` };
}
async function sampleLatency(url: string, untilDone: () => boolean, minSamples: number) {
  const xs: number[] = [];
  while (xs.length < minSamples || !untilDone()) {
    const t = performance.now(); await (await fetch(url)).text(); xs.push(performance.now() - t);
    await sleep(20);
    if (xs.length > 5000) break;
  }
  return xs;
}

async function main_() {
  setup();
  mkdirSync(join(data, "queue"), { recursive: true });
  const results: Record<string, unknown> = {};
  const preview = await startPreview();
  const idle = await sampleLatency(preview.url, () => true, quick ? 40 : 200);

  // 1. Several sessions at once, plus a conflicting pair on file.txt.
  const n = quick ? 4 : 6;
  const trees: { name: string; w: string }[] = [];
  for (let i = 0; i < n; i++) { const name = `s${i}`; const w = makeWorktree(name); writeFileSync(join(w, `${name}.txt`), `${name}\n`); commit(w, `session ${name}`); trees.push({ name, w }); }
  for (const name of ["c1", "c2"]) { const w = makeWorktree(name); writeFileSync(join(w, "file.txt"), `line one\n${name} rewrote line two\nline three\n`); commit(w, `conflicting ${name}`); trees.push({ name, w }); }
  const lander = startLander({ MAIPAI_LAND_BACKUP_SECONDS: "2" });
  let landingDone = false;
  const busy = sampleLatency(preview.url, () => landingDone, quick ? 40 : 200);
  const realCheck = args.has("--real-check") ? Bun.spawn(["bash", "scripts/check.sh", "--pre"], { cwd: join(import.meta.dir, ".."), env: { ...process.env, GATE_HEAVY_HELD: "1" }, stdout: "ignore", stderr: "ignore" }) : null;
  const t1 = Date.now();
  await Promise.all(trees.map((t) => queueLand(t.w).exited));
  await untilQueueEmpty(120_000);
  // The bounced half of the pair rebases in its own worktree (keeps both edits) and lands again, as a session would.
  const bounced = landings().filter((l) => l.status === "bounced").map((l) => l.branch);
  for (const b of bounced) {
    const t = trees.find((x) => `wt/${x.name}` === b)!;
    sh(["git", "fetch", "-q", "origin"], t.w);
    const base = git(main, "rev-parse", "refs/pipeline/main");
    sh(["git", "-c", "user.name=t", "-c", "user.email=t@example.test", "rebase", base], t.w);
    writeFileSync(join(t.w, "file.txt"), `line one\nc1 rewrote line two\n${t.name} rewrote line two\nline three\n`);
    sh(["git", "add", "file.txt"], t.w); sh(["git", "-c", "core.editor=true", "-c", "user.name=t", "-c", "user.email=t@example.test", "rebase", "--continue"], t.w);
    await queueLand(t.w).exited;
  }
  await untilQueueEmpty(120_000);
  await sleep(3500); // one backup batch
  landingDone = true;
  const busyXs = await busy;
  if (realCheck) { realCheck.kill(); await realCheck.exited; }
  await stopLander(lander);
  const rows = landings();
  const status1 = sh(["bash", join(main, "scripts", "pipeline.sh"), "status"]).stdout.toString();
  results.sessions = {
    sessions: trees.length, landed: rows.filter((r) => r.status === "landed").length, bounced_first_try: bounced, seconds: Math.round((Date.now() - t1) / 1000),
    github_equals_pipeline: git(origin, "rev-parse", "refs/heads/main") === git(main, "rev-parse", "refs/pipeline/main"),
    stuck: /STUCK/.test(status1), order: rows.filter((r) => r.status === "landed").map((r) => r.branch),
  };

  // 2. Express priority and fairness, with the normal wait limit shortened to 4 s.
  const before = rows.length;
  const mk = (name: string) => { const w = makeWorktree(name); writeFileSync(join(w, `${name}.txt`), `${name}\n`); commit(w, name); return w; };
  const n1 = mk("n1"), x1 = mk("x1"), x2 = mk("x2"), x3 = mk("x3"), n2 = mk("n2");
  writeFileSync(join(data, "express-streak"), "0\n");
  const fair = { MAIPAI_LAND_NORMAL_MAX_WAIT: "9", MAIPAI_LAND_CHECK_CMD: "sleep 2 && bash scripts/check.sh --pre", MAIPAI_LAND_BACKUP_SECONDS: "2" };
  Object.assign(env, fair);
  const lander2 = startLander(fair);
  await queueLand(n1).exited; await queueLand(n2).exited;
  // The express entries arrive while n1's transaction is running: they must wait for its end, then go ahead of n2.
  for (let i = 0; i < 100 && sh(["test", "-s", join(data, "current-entry")]).exitCode !== 0; i++) await sleep(100);
  const runningWhenQueued = readFileSync(join(data, "current-entry"), "utf8").split("\t")[0];
  const xs = [queueLand(x1, true)]; await sleep(50); xs.push(queueLand(x2, true)); await sleep(50); xs.push(queueLand(x3, true));
  await Promise.all(xs.map((p) => p.exited));
  await untilQueueEmpty(120_000);
  await stopLander(lander2);
  for (const k of Object.keys(fair)) delete (env as Record<string, string | undefined>)[k];
  const fairRows = landings().slice(before).filter((r) => r.status === "landed");
  const seq = fairRows.map((r) => `${r.express ? "X" : "N"}:${r.branch.replace("wt/", "")}`);
  let run = 0, maxRun = 0; for (const r of fairRows) { run = r.express ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
  const runningRow = fairRows.find((r) => r.branch === runningWhenQueued);
  const firstX = fairRows.find((r) => r.express);
  results.fairness = {
    order: seq, max_express_in_a_row: maxRun, normal_waits_s: fairRows.filter((r) => !r.express).map((r) => r.queue_seconds),
    express_queued_while: runningWhenQueued, running_entry_finished_at: runningRow?.finished_at, first_express_started_at: firstX?.started_at,
    express_waited_for_transaction_end: !!(runningRow && firstX && firstX.started_at >= runningRow.finished_at),
  };

  // 3. Queue and run time per landing.
  results.timings = landings().filter((r) => r.status === "landed").map((r) => ({ branch: r.branch, express: r.express, requested_at: r.requested_at, started_at: r.started_at, finished_at: r.finished_at, queue_s: r.queue_seconds, run_s: r.run_seconds, phases: r.phases }));
  results.status_lines = sh(["bash", join(main, "scripts", "pipeline.sh"), "status"]).stdout.toString().split("\n").filter((l) => / landed /.test(l)).slice(-3);

  // 4. Preview latency at rest and while landing.
  results.preview_ms = {
    idle: { n: idle.length, median: +pct(idle, 50).toFixed(1), p95: +pct(idle, 95).toFixed(1) },
    landing: { n: busyXs.length, median: +pct(busyXs, 50).toFixed(1), p95: +pct(busyXs, 95).toFixed(1), real_check_running: !!realCheck },
  };
  preview.p.kill();
  return results;
}

const results = await main_().finally(() => { if (!args.has("--keep")) cleanup(); });
if (args.has("--json")) console.log(JSON.stringify(results));
else console.log(JSON.stringify(results, null, 2));
export {};
