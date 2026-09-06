// A real safety net for the incident Jesse described from the pre-rebuild
// project: a locally-spawned model process grew (or the rest of a shared
// Mac/Windows machine got squeezed) until the whole box went unresponsive.
// No competing local-LLM runner (Ollama, LM Studio, koboldcpp, llama.cpp
// itself) does real enforcement here either - they all estimate memory need
// before loading and hope. Neither macOS nor Windows offers a clean,
// native-code-free hard cap on a spawned child (`ulimit -v` doesn't bound
// RSS, launchd limits are advisory, Windows Job Objects have no maintained
// npm wrapper) - see docs/dev.md's resource-governor entry for the full
// research. So this is deliberately poll-and-kill, not an OS-level cap: it
// watches the numbers this codebase already measures and restarts the chat
// backend before things get catastrophic, reusing llmSupervisor.ts's
// existing restartChatBackend() and enginePostLoadCheck.ts's
// measureProcessMemoryBytes() rather than adding a new dependency or a
// second way of reading process memory.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { getEngineStatus, restartChatBackend } from "@/lib/llmSupervisor";
import { measureProcessMemoryBytes } from "@/lib/enginePostLoadCheck";
import { raiseIssue } from "@/lib/issues";

const execFileAsync = promisify(execFile);

// Two independent triggers, not one, because the reported incident (the
// machine froze) is a system-memory problem, not only a process problem: a
// ceiling based purely on "this process grew past its own baseline" can't
// see "the rest of the shared machine is also under pressure." Trigger A
// runs regardless of which spawn tier is live; trigger B only where a real
// baseline exists (tier 3, the household's selected model).
const DEFAULT_TUNING = {
  pollMs: 5_000,
  systemLowWaterPct: 0.1,
  systemLowWaterFloorBytes: 1_073_741_824, // 1 GiB - keeps a small-RAM box
  // from being allowed to run all the way down to a sliver even though 10%
  // of a small total is itself small.
  systemSustainedPolls: 2, // closer to real danger than trigger B, so it
  // acts faster once it starts breaching
  processSafetyMultiplier: 1.3,
  processMinOverageBytes: 500_000_000, // A tiny model's normal
  // sample-to-sample noise can cross 30% without being remotely dangerous;
  // this absolute floor keeps that from tripping the trigger.
  processSustainedPolls: 3,
};

let tuning = { ...DEFAULT_TUNING };

export function __setGovernorTuningForTestsOnly(overrides: Partial<typeof DEFAULT_TUNING>): void {
  tuning = { ...tuning, ...overrides };
}

export function __resetGovernorTuningForTests(): void {
  tuning = { ...DEFAULT_TUNING };
}

// Bun runs every test file in one process (sidecars.test.ts's own header
// comment), so a governor left running past its owning test would keep
// ticking into whatever runs next. Each one self-retires within one poll
// interval once its watched pid is no longer the live backend (the
// staleness check below), but this gives tests an explicit, immediate way
// to guarantee none are left running, the same shape every other module
// here uses (__resetSidecarsForTests, __resetLlmSupervisorForTests).
const activeTimers = new Set<ReturnType<typeof setInterval>>();

export function __stopAllGovernorsForTests(): void {
  for (const timer of activeTimers) clearInterval(timer);
  activeTimers.clear();
}

function bytesGb(n: number): string {
  return (n / 1_073_741_824).toFixed(2);
}

/** "Available" system memory, not raw OS.freemem() everywhere: macOS
 * deliberately keeps free pages near zero by using spare RAM for file
 * cache/compression, so raw freemem reads low under completely healthy
 * operation and would trip this trigger constantly. `memory_pressure -Q`
 * is the same figure macOS's own jetsam logic uses, reachable as a plain
 * CLI (confirmed real output: "System-wide memory free percentage: NN%"),
 * with `vm_stat`'s free+speculative pages (both immediately reclaimable,
 * unlike inactive) as a fallback if that ever changes shape. Windows'
 * `GlobalMemoryStatusEx` (what `os.freemem()` calls there) already counts
 * the reclaimable standby list as available, so raw freemem is a sound
 * signal there with no extra work. */
async function systemAvailableBytes(): Promise<{ available: number; total: number } | null> {
  const total = os.totalmem();
  if (process.platform !== "darwin") {
    return { available: os.freemem(), total };
  }
  try {
    const { stdout } = await execFileAsync("memory_pressure", ["-Q"], { timeout: 5_000 });
    const pct = stdout.match(/System-wide memory free percentage:\s*(\d+)%/)?.[1];
    if (pct !== undefined) return { available: total * (Number(pct) / 100), total };
  } catch {
    // fall through to vm_stat
  }
  try {
    const { stdout } = await execFileAsync("vm_stat", [], { timeout: 5_000 });
    const pageSize = Number(stdout.match(/page size of (\d+) bytes/)?.[1] ?? 4096);
    const free = Number(stdout.match(/Pages free:\s*(\d+)\./)?.[1] ?? "0");
    const speculative = Number(stdout.match(/Pages speculative:\s*(\d+)\./)?.[1] ?? "0");
    return { available: (free + speculative) * pageSize, total };
  } catch {
    return null; // unmeasurable on this platform - trigger A just sits out this tick
  }
}

export interface ResourceGovernorOptions {
  pid: number;
  hasCuda: boolean;
  /** null when no formula/measured baseline exists (the tier-2 developer
   * override spawn, which carries no model metadata to size against) -
   * trigger B is skipped, trigger A still runs. */
  ceilingBaselineBytes: number | null;
}

/** Starts watching one spawned chat backend. Self-retires (clears its own
 * timer) the moment `getEngineStatus().pid` no longer matches the pid it
 * was given - the whole race-condition guard against a manual restart or
 * model swap racing this loop's own action: no generation counter, no new
 * exported llmSupervisor.ts state, just re-checking the one thing that
 * matters immediately before ever acting, on every tick. */
export function startResourceGovernor(opts: ResourceGovernorOptions): void {
  const processCeiling = opts.ceilingBaselineBytes !== null ? opts.ceilingBaselineBytes * tuning.processSafetyMultiplier : null;
  let systemBreaches = 0;
  let processBreaches = 0;

  const timer: ReturnType<typeof setInterval> = setInterval(() => void tick(), tuning.pollMs);
  activeTimers.add(timer);

  async function stop(): Promise<void> {
    clearInterval(timer);
    activeTimers.delete(timer);
  }

  async function trip(detail: string): Promise<void> {
    await stop();
    await raiseIssue({
      source: "resource-governor",
      key: "chat",
      severity: "error",
      title: "Chat model was restarted to protect this machine",
      detail,
    });
    await restartChatBackend();
  }

  async function tick(): Promise<void> {
    if (getEngineStatus().pid !== opts.pid) {
      await stop();
      return;
    }

    const sys = await systemAvailableBytes();
    if (sys) {
      const floor = Math.max(sys.total * tuning.systemLowWaterPct, tuning.systemLowWaterFloorBytes);
      systemBreaches = sys.available < floor ? systemBreaches + 1 : 0;
      if (systemBreaches >= tuning.systemSustainedPolls) {
        await trip(
          `resource-governor: system memory ran low while the chat model was loaded ` +
            `(${bytesGb(sys.available)}GB available of ${bytesGb(sys.total)}GB, ` +
            `below the ${bytesGb(floor)}GB floor, sustained ${systemBreaches} polls)`,
        );
        return;
      }
    } else {
      systemBreaches = 0;
    }

    if (processCeiling !== null) {
      const measured = await measureProcessMemoryBytes(opts.pid, opts.hasCuda);
      const overage = measured !== null ? measured - opts.ceilingBaselineBytes! : 0;
      const breached = measured !== null && measured > processCeiling && overage >= tuning.processMinOverageBytes;
      processBreaches = breached ? processBreaches + 1 : 0;
      if (processBreaches >= tuning.processSustainedPolls) {
        await trip(
          `resource-governor: chat model's own memory use exceeded its expected ceiling ` +
            `(${bytesGb(measured!)}GB used vs. a ${bytesGb(processCeiling)}GB ceiling ` +
            `${bytesGb(opts.ceilingBaselineBytes!)}GB baseline x${tuning.processSafetyMultiplier}, ` +
            `sustained ${processBreaches} polls)`,
        );
        return;
      }
    }
  }
}
