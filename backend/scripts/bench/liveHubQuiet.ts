// U2d's own protocol for the one bench that is allowed to touch the
// household's live chat engine at 127.0.0.1:8788 (every other bench in
// this directory uses a side instance on a spare port, never 8788's -
// replay.ts's own header still says so, and still means it for every
// mode but the one this file exists for): one request at a time, and a
// 30s quiet wait after any new "[turn]" line in home/data/logs/hub.log
// (real household activity - this script's own turns never write that
// line when run against a bench data directory, so any new one during
// a run is a real person, not this bench). Shared by
// interimRuleMeasure.ts and replay.ts's --hub-live so the wait logic is
// declared once, not copied.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const DEFAULT_HUB_LOG = join(import.meta.dir, "..", "..", "..", "data", "logs", "hub.log");

function currentTurnLineCount(hubLog: string): number {
  try {
    return readFileSync(hubLog, "utf-8").split("\n").filter((l) => l.startsWith("[turn]")).length;
  } catch {
    return 0;
  }
}

const CD_PREFIX_RE = /\bcd\s+(\S+)\s*&&/;

/** The worktree a running scripts/check.sh/bun test/vite build process
 * started from, WITHOUT lsof - the coordinator's own warning (this
 * host hangs in the kernel under load on an lsof call) ruled it out
 * after the first version of this file used it. A bare `bash
 * scripts/check.sh` never shows its own cwd on the command line, but
 * the Claude Code session wrapper that launched it does (`cd
 * /path/to/worktree && bash scripts/check.sh ...`), and `pgrep -f`
 * already matches that OUTER wrapper too, since "scripts/check.sh"
 * appears in its own full argv string - `ps -o command=` reads back
 * exactly what pgrep matched against, no second lookup needed. A
 * matching pid whose own line carries no `cd ... &&` (the plain child
 * process, not its wrapper) is reported with an empty path - never
 * silently ignorable by MAIPAI_BENCH_IGNORE_GATE_CWD below, since an
 * empty string never matches a substring filter. */
function gatePidsByCwd(): Map<number, string> {
  const cwds = new Map<number, string>();
  let pids: string[];
  try {
    pids = execSync("pgrep -f '[s]cripts/check.sh|[b]un test|[v]ite build'", { encoding: "utf-8" }).trim().split("\n").filter(Boolean);
  } catch {
    return cwds; // pgrep exits 1 when nothing matches
  }
  for (const pidStr of pids) {
    try {
      const command = execSync(`ps -o command= -p ${pidStr}`, { encoding: "utf-8" }).trim();
      cwds.set(Number(pidStr), CD_PREFIX_RE.exec(command)?.[1] ?? "");
    } catch {
      // a pid that exited between pgrep and ps - not a live gate
    }
  }
  return cwds;
}

/** CLAUDE.md's own gate rule, applied to a live-hub bench too: "one
 * full gate at a time," never beside a bench holding the same shared
 * engines. Exits the process rather than waiting - a bench against a
 * real household engine is not the capped wait loop a code gate gets,
 * it simply refuses to start while one is running.
 *
 * MAIPAI_BENCH_IGNORE_GATE_CWD (comma-separated substrings) excludes a
 * worktree's gate from this check - for the one situation this needs
 * to happen at all: the coordinator has already said a specific
 * worktree's gate doesn't count for this run (its own short targeted
 * test runs, not a real gate). Never set as a standing default; the
 * operator sets it per invocation, for the worktree named that turn. */
export function refuseIfGateRunning(scriptName: string): void {
  const ignore = (process.env.MAIPAI_BENCH_IGNORE_GATE_CWD ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const busy = [...gatePidsByCwd()].filter(([, cwd]) => !ignore.some((substr) => cwd.includes(substr)));
  if (busy.length > 0) {
    console.error(`${scriptName} refused: a gate (scripts/check.sh, bun test, or vite build) is already running (${busy.map(([pid, cwd]) => `${pid} in ${cwd}`).join(", ")}). Never beside a gate.`);
    process.exit(2);
  }
}

/** SEARCH-HEALTH-01: a fixture always binds `127.0.0.1`/`localhost`
 * (every `startFakeSearxng()` in this directory does); anything else
 * is the household's real instance. Exported separately from
 * `refuseRealSearxngWithoutClearance` below so its own classification
 * logic has a direct test, never only exercised through a
 * `process.exit`-ing guard. */
export function isLocalFixtureUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return true; // an unparseable URL fails at the real call site, not here
  }
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

/** SEARCH-HEALTH-01 (docs/dev.md's "Live bench protocol", 2026-09-24):
 * a bench sending real queries to the household's own SearXNG - the
 * exact traffic that got it rate-limited tonight - needs the
 * coordinator's own clearance, every time, never a standing default.
 * `MAIPAI_BENCH_REAL_SEARXNG_CLEARED=1` is that clearance, set per
 * invocation for the one cleared run, the same shape
 * `MAIPAI_BENCH_IGNORE_GATE_CWD` above already uses. */
export function refuseRealSearxngWithoutClearance(scriptName: string, searxngUrl: string): void {
  if (isLocalFixtureUrl(searxngUrl) || process.env.MAIPAI_BENCH_REAL_SEARXNG_CLEARED === "1") return;
  console.error(`${scriptName} refused: MAIPAI_SEARXNG_URL (${searxngUrl}) points at a real instance, not a local fixture, and MAIPAI_BENCH_REAL_SEARXNG_CLEARED=1 is not set. A real run needs the coordinator's own clearance and stays at a person's pace once cleared (docs/dev.md's "Live bench protocol").`);
  process.exit(2);
}

/** Resolves before the log has gone quiet for one 2s poll window;
 * every new "[turn]" line seen along the way re-arms a 30s wait. */
export async function waitForHubQuiet(hubLog: string = process.env.MAIPAI_HUB_LOG ?? DEFAULT_HUB_LOG, onWaiting?: (msg: string) => void): Promise<void> {
  let before = currentTurnLineCount(hubLog);
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const after = currentTurnLineCount(hubLog);
    if (after === before) return;
    onWaiting?.(`[live-hub-quiet] a new [turn] line appeared (real household activity) - waiting 30s quiet`);
    before = after;
    await new Promise((r) => setTimeout(r, 30000));
    before = currentTurnLineCount(hubLog);
  }
}
