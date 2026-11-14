// MUSIC-ID-01: the one place Home finds fpcalc, preferring a local PATH copy before the Stack-managed binary.
import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { stackDataDir } from "@/lib/localStackService";

/** fpcalc from PATH (plus the standard Homebrew locations), then the Stack's newest version, then the explicit override. */
export function findFpcalc(stackData?: string, path?: string): string | null {
  const extra = process.env.MAIPAI_FPCALC_PATH_ONLY === "1" ? [] : ["/opt/homebrew/bin", "/usr/local/bin"];
  const searchPath = path === undefined
    ? [process.env.PATH ?? "", ...extra].join(delimiter)
    : [path, ...(path ? extra : [])].join(delimiter);
  const onPath = Bun.which("fpcalc", { PATH: searchPath });
  if (onPath) return onPath;
  try {
    const root = join(stackData ?? stackDataDir(), "engines", "fpcalc");
    for (const version of readdirSync(root).sort().reverse()) {
      const candidate = join(root, version, "fpcalc");
      if (existsSync(candidate)) return candidate;
    }
  } catch { /* no Stack engine folder */ }
  return process.env.MAIPAI_FPCALC_PATH ?? null;
}
