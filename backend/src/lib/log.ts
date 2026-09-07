// Fix A5 (docs/dev.md's "Chat reliability: the 2026-09-07 incident and
// the five fixes"): a small, size-and-days-rotated append target on disk
// (getmaipai/.github's docs/ENGINEERING.md, Logging section: "retention
// is by size and days"), for the specific structured line this incident
// actually needed and found missing - turnEngine.ts's own `[turn]` line
// (Fix A4), the only hub-originated per-turn signal that existed at
// diagnosis time. Deliberately NOT a blanket console.log/warn/error
// mirror: a code review on this fix's first cut (2026-09-07) caught that
// shape teeing all ~47 pre-existing console.* call sites across the
// codebase to disk unconditionally, with no redaction step anywhere -
// exactly the "a secret, token, PII value... never lands" a real log
// pipeline has to guarantee (docs/ENGINEERING.md, same section), which
// nothing here does for arbitrary call-site content. `appendLogLine()`
// is the one exported primitive; a caller decides what's safe to persist
// and builds its own line - `logTurnLine()` in turnEngine.ts is the one
// real caller today, and it already omits the utterance and reply text.
import { appendFileSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { logsDir, ensureDataDir } from "@/lib/paths";

const LOG_FILE = "hub.log";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_AGE_DAYS = 14;
const DAY_MS = 86_400_000;

function logFilePath(): string {
  return join(logsDir, LOG_FILE);
}

/** Deletes a rotated `hub.log.<timestamp>` file once it's older than
 * MAX_AGE_DAYS - the "days" half of "retention is by size and days";
 * MAX_BYTES (below) is the "size" half, which is what actually triggers a
 * rotation in the first place. Never touches the live `hub.log` itself. */
function pruneOldRotations(): void {
  let entries: string[];
  try {
    entries = readdirSync(logsDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - MAX_AGE_DAYS * DAY_MS;
  for (const name of entries) {
    if (name === LOG_FILE || !name.startsWith(`${LOG_FILE}.`)) continue;
    const full = join(logsDir, name);
    try {
      if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
    } catch {
      // Already gone, or a permissions blip - best-effort, never worth
      // this function's own caller failing over.
    }
  }
}

function rotateIfNeeded(): void {
  const path = logFilePath();
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return; // no file yet - nothing to rotate
  }
  if (size < MAX_BYTES) return;
  const rotated = `${path}.${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    renameSync(path, rotated);
  } catch {
    // A concurrent rotation (there is only ever one hub process writing
    // this file) or a filesystem hiccup - the file just keeps growing
    // this tick rather than losing whatever line is about to be written.
  }
  pruneOldRotations();
}

/** Appends one line (a trailing newline is added) to `data/logs/hub.log`,
 * rotating first when the file has grown past MAX_BYTES. Best-effort: a
 * write failure here is swallowed, never thrown - the same "logging must
 * never turn a successful turn into a reported failure" posture
 * turnEngine.ts's own logTurnSafely() already holds for the database
 * half of turn logging; this is one more thing that can fail on the way
 * to disk, not a new hard dependency for the reply that already
 * succeeded. A `statSync` + (rarely) a rename on every call is a real,
 * accepted cost - a home hub's own log volume never approaches where
 * that overhead would be noticeable, and the alternative (a background
 * timer polling file size) adds a second moving part for no real gain
 * at this scale. The caller owns what's safe to write - see this file's
 * own header for why that's deliberate. */
export function appendLogLine(line: string): void {
  try {
    ensureDataDir(logsDir);
    rotateIfNeeded();
    appendFileSync(logFilePath(), `${line}\n`, { mode: 0o600 });
  } catch {
    // best-effort - see this function's own doc comment
  }
}
