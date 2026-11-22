// The Changes count of a Code session (spec `changes`): files, added lines and removed lines the agent left in /workspace since the last commit. Found during the Code
// end-to-end run (2026-11-21): nothing ever wrote it, so Changes always said 0. It is read INSIDE the sandbox, never by running git on the host: the agent controls the
// repository's own config and hooks, and the sandbox is where that is safe. Counts only; no file name or content leaves this module (rule 6a).
import type { ExecChunk } from "@/lib/codingSandbox";

export type ChangeCounts = { files: number; additions: number; deletions: number };
type ExecFn = (input: { sessionId: string; argv: string[]; cwd?: string; signal: AbortSignal }) => AsyncIterable<ExecChunk>;

// Tracked edits from `git diff --numstat HEAD` ("add<TAB>del<TAB>path", "-" for a binary file), then one "lines<TAB>0<TAB>path" row per untracked file.
const SCRIPT = "git diff --numstat HEAD 2>/dev/null; git ls-files -o --exclude-standard 2>/dev/null | while IFS= read -r f; do printf '%s\\t0\\t%s\\n' \"$(wc -l < \"$f\" 2>/dev/null | tr -d ' ')\" \"$f\"; done";

export function parseChangeCounts(output: string): ChangeCounts {
  const total: ChangeCounts = { files: 0, additions: 0, deletions: 0 };
  for (const line of output.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t.+$/.exec(line);
    if (!m) continue;
    total.files += 1;
    total.additions += m[1] === "-" ? 0 : Number(m[1]);
    total.deletions += m[2] === "-" ? 0 : Number(m[2]);
  }
  return total;
}

/** Null when the sandbox cannot say (no exec, no repository, a timeout): the caller keeps the number it had. */
export async function readChangeCounts(exec: ExecFn | undefined, sessionId: string, timeoutMs = 15_000): Promise<ChangeCounts | null> {
  if (!exec) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs); timer.unref?.();
  try {
    let out = ""; let exit: number | null = null;
    for await (const chunk of exec({ sessionId, argv: ["sh", "-c", SCRIPT], cwd: "/workspace", signal: abort.signal })) {
      if ("exit" in chunk) exit = chunk.exit; else if (chunk.stream === "stdout") out += chunk.text;
    }
    return exit === 0 ? parseChangeCounts(out) : null;
  } catch { return null; } finally { clearTimeout(timer); }
}
