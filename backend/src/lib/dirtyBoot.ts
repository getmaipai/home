// Detects whether the current OS boot followed an unclean shutdown (a hard
// power-off, a kernel panic), and holds the hub's own heavy compute (a real
// spawned chat/embed engine, never the stub or a developer's URL override)
// for a cooldown after one - resuming immediately after a crash-boot risks
// re-triggering the very condition that took the machine down. Ported from
// the archived legacy hub's lib/dirtyBoot.ts (hard-won logic, CLAUDE.md's
// "copy resolvers/drivers/measurements" allowance): "three power-offs in
// one night, each mid plex-cut" is the incident that earned this file,
// docs/BACKLOG.md's "Copy the legacy runtime guards" item.
//
// Windows keeps a real signal (Kernel-Power event 41, logged within
// seconds of the first boot after a dirty shutdown) - legacy's own
// mechanism, unchanged here. Linux and macOS have no equivalent single
// event to query, so both are best-effort per session-f-platform-and-
// trust.md step 3's own text ("the equivalent on Linux and macOS best-
// effort"): a query failure or an unrecognized log shape always reports
// "clean" rather than false-alarming a hold on every boot.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { uptime } from "node:os";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/** How close (ms) the newest crash signal must be to the current boot
 * time to count as "this boot followed a crash". Real signals land
 * within seconds of boot; five minutes absorbs clock jitter and slow
 * boots - legacy's own figure, kept unchanged. */
const BOOT_MATCH_WINDOW_MS = 5 * 60_000;

/** Milliseconds since epoch when the OS booted. */
export function osBootTimeMs(): number {
  return Date.now() - uptime() * 1000;
}

async function run(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 8_000 });
    return stdout;
  } catch {
    return "";
  }
}

// Pure interpretation, split from the OS query itself so each platform's
// parsing logic is unit-testable against synthetic log/XML text without
// needing a real dirty shutdown to have actually happened on whatever
// machine runs the test suite.
export function windowsEventIndicatesUncleanBoot(xml: string, bootTimeMs: number): boolean {
  const stamp = xml.match(/SystemTime='([^']+)'/)?.[1];
  if (!stamp) return false;
  const eventTime = Date.parse(stamp);
  if (!Number.isFinite(eventTime)) return false;
  return Math.abs(eventTime - bootTimeMs) < BOOT_MATCH_WINDOW_MS;
}

async function windowsBootFollowedUncleanShutdown(): Promise<boolean> {
  const xml = await run("wevtutil", ["qe", "System", "/q:*[System[(EventID=41)]]", "/c:1", "/rd:true", "/f:xml"]);
  return windowsEventIndicatesUncleanBoot(xml, osBootTimeMs());
}

// A code review (2026-09-06) found the first version of this function
// parsed `pmset -g log`'s "Shutdown Cause" field and blocklisted a small
// set of "clean" cause codes, treating everything else (including
// unrecognized codes) as unclean. That field is well known to be
// unreliable on modern macOS: "-128" in particular is commonly logged for
// completely ordinary, user-initiated restarts, not just hard faults - a
// blocklist approach would have false-alarmed a 30-minute compute hold
// after routine restarts, the opposite of this file's own "never a false
// alarm" design goal. Macos detection now looks for something
// unambiguous instead: a kernel panic report macOS itself writes to
// /Library/Logs/DiagnosticReports whenever the kernel actually panics,
// timestamped near this boot. This misses a raw hard power-off that
// never triggered a panic (no report exists to find), a real, accepted
// gap for a best-effort, no-false-positive design - Windows's real
// Kernel-Power-41 signal remains the one platform this catches that case
// on.
const MACOS_PANIC_REPORT_DIR = "/Library/Logs/DiagnosticReports";

export interface FileTimestamp {
  name: string;
  mtimeMs: number;
}

export function macosPanicReportsIndicateUncleanBoot(files: FileTimestamp[], bootTimeMs: number): boolean {
  return files.some((f) => /\.panic$/i.test(f.name) && Math.abs(f.mtimeMs - bootTimeMs) < BOOT_MATCH_WINDOW_MS);
}

async function macosBootFollowedUncleanShutdown(): Promise<boolean> {
  try {
    const names = await readdir(MACOS_PANIC_REPORT_DIR);
    const files = await Promise.all(
      names.map(async (name) => ({ name, mtimeMs: (await stat(join(MACOS_PANIC_REPORT_DIR, name))).mtimeMs })),
    );
    return macosPanicReportsIndicateUncleanBoot(files, osBootTimeMs());
  } catch {
    return false;
  }
}

// systemd's journal survives a hard power-off (it's synced to disk
// continuously, not just flushed at a clean shutdown), so the previous
// boot's own log ending abruptly - no clean-shutdown target reached near
// its end - is real evidence that boot never shut down cleanly.
// Best-effort: no journalctl at all (a non-systemd distro) or a
// single-boot journal (nothing to compare against) reports "clean".
//
// A code review (2026-09-06) found the original pattern only matched
// "Reached target ...Shutdown" - newer systemd (254+) split that single
// target into separate Reboot/Power-Off/Halt targets with their own
// wording, so a clean shutdown on a newer distro could have been
// misclassified as unclean. Broadened to every target name and verb
// systemd is documented to use across versions; still an absence-based
// check (a genuinely silent hard power-off logs none of these, which is
// exactly the case this guard exists to catch), so this stays a
// best-effort heuristic, not a guarantee - the residual false-positive
// risk (a real clean shutdown whose last lines never reached disk before
// power actually cut, or a future wording change this list doesn't know
// about yet) is accepted the same way the file's own header already
// accepts one for every non-Windows platform.
const LINUX_CLEAN_SHUTDOWN_PATTERN =
  /Reached target (Shutdown|Reboot|Power-?Off|Halt|System Power Off|System Reboot)|System halted|Power down|Rebooting|Powering off/i;

export function linuxPreviousBootLogIndicatesUncleanShutdown(bootsList: string, previousBootLog: string): boolean {
  if (bootsList.trim().split("\n").filter(Boolean).length < 2) return false;
  if (!previousBootLog) return false;
  return !LINUX_CLEAN_SHUTDOWN_PATTERN.test(previousBootLog);
}

async function linuxBootFollowedUncleanShutdown(): Promise<boolean> {
  const boots = await run("journalctl", ["--list-boots", "-q", "--no-pager"]);
  if (boots.trim().split("\n").filter(Boolean).length < 2) return false;
  const previousBootLog = await run("journalctl", ["-b", "-1", "-n", "50", "-q", "--no-pager"]);
  return linuxPreviousBootLogIndicatesUncleanShutdown(boots, previousBootLog);
}

/** True when this OS boot was preceded by an unclean shutdown. Best-effort
 * on every platform (any query failure reports false - never a false
 * alarm holding compute the household never needed held). */
export async function bootFollowedUncleanShutdown(): Promise<boolean> {
  try {
    if (process.platform === "win32") return await windowsBootFollowedUncleanShutdown();
    if (process.platform === "darwin") return await macosBootFollowedUncleanShutdown();
    if (process.platform === "linux") return await linuxBootFollowedUncleanShutdown();
    return false;
  } catch {
    return false;
  }
}

const CRASH_BOOT_HOLD_MS = 30 * 60_000;

let holdUntilMs: number | null = null;

/** Call once at process boot (index.ts), before any real engine spawn can
 * happen. Fire-and-forget from the caller's side is fine: the OS query
 * this runs takes at most a few seconds, and no real spawn happens before
 * the first chat/embed request arrives anyway. */
export async function initCrashBootHold(): Promise<void> {
  if (await bootFollowedUncleanShutdown()) {
    holdUntilMs = Date.now() + CRASH_BOOT_HOLD_MS;
    console.warn(
      `[dirtyBoot] this boot followed an unclean shutdown - holding real engine spawns until ${new Date(holdUntilMs).toISOString()}`,
    );
  }
}

/** 0 once the hold has lapsed or was never set. */
export function crashBootHoldRemainingMs(): number {
  if (!holdUntilMs) return 0;
  return Math.max(0, holdUntilMs - Date.now());
}

export function isInCrashBootHold(): boolean {
  return crashBootHoldRemainingMs() > 0;
}

/** Every real-engine-spawn gate (llmSupervisor.ts's tiers 2 and 3,
 * embedSupervisor.ts's real spawn) throws through here rather than each
 * writing its own copy of this message - a code review (2026-09-06)
 * found the string duplicated verbatim across two files, one edit away
 * from drifting. A no-op when the hold has lapsed. */
export function assertNotInCrashBootHold(): void {
  if (isInCrashBootHold()) {
    throw new Error(
      "the hub just recovered from an unexpected shutdown and is holding off on real AI models for a few minutes to protect your hardware - try again shortly",
    );
  }
}

/** Test-only: sets or clears the hold directly, the same shape every
 * other module-level-state reset hook in this directory uses - avoids
 * every test needing to fake a real dirty-boot OS signal just to exercise
 * the guard that reads this state. */
export function __setCrashBootHoldForTests(untilMs: number | null): void {
  holdUntilMs = untilMs;
}
