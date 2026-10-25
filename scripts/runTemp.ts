import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const RUN_TEMP_PATTERN = /^maipai-run-(\d+)-.+$/;
const MAX_SWEEP_REMOVALS = 200;

function sweepStaleRunTemps(parent: string): void {
  const minutes = Number(process.env.MAIPAI_RUN_TEMP_SWEEP_MINUTES ?? "120");
  if (!Number.isFinite(minutes) || minutes <= 0) return;

  let entries;
  try {
    entries = readdirSync(parent);
  } catch (error) {
    console.error(`[temp sweep] could not read ${parent}: ${String(error)}`);
    return;
  }

  const cutoff = Date.now() - minutes * 60_000;
  let removed = 0;
  for (const entry of entries) {
    if (removed >= MAX_SWEEP_REMOVALS) break;
    const match = RUN_TEMP_PATTERN.exec(entry);
    if (!match) continue;

    const pid = Number(match[1]);
    const path = join(parent, entry);
    try {
      const info = statSync(path);
      if (!info.isDirectory() || info.mtimeMs >= cutoff) continue;
      try {
        process.kill(pid, 0);
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
      }
      rmSync(path, { recursive: true, force: true });
      removed++;
    } catch (error) {
      console.error(`[temp sweep] could not remove ${path}: ${String(error)}`);
    }
  }
}

/** Give one process a private OS temp root and remove it on every normal exit. */
export function installRunTempRoot(parentOverride?: string): string {
  if (process.env.MAIPAI_RUN_TEMP_ROOT) return process.env.MAIPAI_RUN_TEMP_ROOT;
  const parent = parentOverride ?? tmpdir();
  const root = mkdtempSync(join(parent, `maipai-run-${process.pid}-`));
  sweepStaleRunTemps(parent);
  process.env.MAIPAI_RUN_TEMP_ROOT = root;
  process.env.TMPDIR = root;
  process.env.TMP = root;
  process.env.TEMP = root;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (error) {
      console.error(`[temp cleanup] could not remove ${root}: ${String(error)}`);
    }
  };
  process.once("exit", cleanup);
  process.once("beforeExit", cleanup);
  process.once("SIGINT", () => {
    cleanup();
    setImmediate(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    cleanup();
    setImmediate(() => process.exit(143));
  });
  return root;
}

installRunTempRoot();
