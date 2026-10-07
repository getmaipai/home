import { lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logsDir } from "@/lib/paths";

const PURGE_MARKER = ".legacy-hub-log-purge-v1";

export interface PurgedHubLog {
  name: string;
  bytes: number;
}

export interface HubLogPurgeResult {
  alreadyPurged: boolean;
  removed: PurgedHubLog[];
}

/** Remove the free-text hub log files left by versions before typed logging. */
export function purgeLegacyHubLogs(directory: string = logsDir): HubLogPurgeResult {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const markerPath = join(directory, PURGE_MARKER);
  try {
    const markerStats = lstatSync(markerPath);
    if (!markerStats.isFile()) throw new Error(`Invalid hub log purge marker: ${markerPath}`);
    return { alreadyPurged: true, removed: [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const removed: PurgedHubLog[] = [];
  for (const entry of readdirSync(directory).sort()) {
    if (!entry.startsWith("hub.log")) continue;
    const path = join(directory, entry);
    const fileStats = lstatSync(path);
    if (!fileStats.isFile() && !fileStats.isSymbolicLink()) continue;
    unlinkSync(path);
    removed.push({ name: entry, bytes: fileStats.size });
  }

  writeFileSync(markerPath, "complete\n", { flag: "wx", mode: 0o600 });
  return { alreadyPurged: false, removed };
}
