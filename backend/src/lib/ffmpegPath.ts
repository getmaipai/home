// MP-09: the one place Home finds ffmpeg. The Stack lists ffmpeg as a required tool (Audio and video tools) and
// keeps it under `<stack data>/engines/ffmpeg/<version>/ffmpeg`; a PATH copy still wins so a developer's own build
// is used when there is one. Music mixing, voice shifting and picture keyframes all call this and nothing else.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stackDataDir } from "@/lib/localStackService";

/** ffmpeg on the PATH, else the one the Stack manages (newest version name last), else null. `stackData` and `path` are for tests (a fake Stack data folder and PATH). */
export function findFfmpeg(stackData?: string, path?: string): string | null {
  const onPath = path === undefined ? Bun.which("ffmpeg") : Bun.which("ffmpeg", { PATH: path });
  if (onPath) return onPath;
  try {
    const root = join(stackData ?? stackDataDir(), "engines", "ffmpeg");
    for (const version of readdirSync(root).sort().reverse()) { const candidate = join(root, version, "ffmpeg"); if (existsSync(candidate)) return candidate; }
  } catch { /* no Stack engine folder: no ffmpeg */ }
  return null;
}
