// VIDEO-LORA-03 hardening: which clips were started with a style. A clip's request keeps the style ids it was made with. The match is `instr` on the quoted id,
// never LIKE, so an id with `_` or `%` in it matches only itself (a wildcard would lock or keep another style's clips).
import { sqlite } from "@/db";

/** The video jobs whose request names this style, optionally only those in these states. */
export function clipsUsingStyle(id: string, states?: readonly string[]): Array<{ id: string; files: string }> {
  const quoted = `"${id}"`;
  if (!states) return sqlite.query("SELECT id, files FROM video_jobs WHERE instr(request, ?) > 0").all(quoted) as Array<{ id: string; files: string }>;
  const marks = states.map(() => "?").join(",");
  return sqlite.query(`SELECT id, files FROM video_jobs WHERE state IN (${marks}) AND instr(request, ?) > 0`).all(...states, quoted) as Array<{ id: string; files: string }>;
}
