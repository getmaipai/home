// replay-per-question.ts's own pure text transforms, factored out so
// they're testable without spawning a real subprocess: stripping every
// header block but the first when concatenating N subprocesses' own
// stdout into one combined log, and attaching each subprocess's own
// measured RSS to its own [replay-question] row.
const HEADER_BLOCK = /## Run header\n\n```json\n[\s\S]*?\n```\n\n/;

/** Removes replay.ts's own "## Run header" block from one subprocess's
 * stdout - every invocation prints an identical one (bar `date`), so
 * the combined log keeps only the first. */
export function stripHeaderBlock(text: string): string {
  return text.replace(HEADER_BLOCK, "");
}

/** Adds processStartRssKb/processEndRssKb onto the one [replay-question]
 * JSON line a single-question invocation prints, so a question's own
 * memory footprint sits on its own row rather than a separate line a
 * reader has to join back to it. Text with no such line (a thrown
 * setup error before the question was ever reached) passes through
 * unchanged. */
export function attachRss(text: string, startRssKb: number | null, endRssKb: number | null): string {
  return text.replace(/(\[replay-question\] )(\{.*\})/, (_m, prefix: string, json: string) => {
    const row = JSON.parse(json) as Record<string, unknown>;
    row.processStartRssKb = startRssKb;
    row.processEndRssKb = endRssKb;
    return `${prefix}${JSON.stringify(row)}`;
  });
}

/** Parses `vm_stat`'s own text output for free memory, in MB - macOS's
 * "Pages free" line times its own reported page size (16384 bytes on
 * every Mac this has run on so far, never hardcoded: `vm_stat` prints
 * its own page size in the header line every time). Returns null on any
 * parse failure (a future macOS changing the format) rather than
 * throwing - a caller checking free memory as a defensive pre-spawn
 * gate should fail open (proceed) on a parse miss, not hang a 35-
 * question run on a text-format change this function cannot predict. */
export function parseFreeMemoryMb(vmStatOutput: string): number | null {
  const pageSizeMatch = vmStatOutput.match(/page size of (\d+) bytes/);
  const freeMatch = vmStatOutput.match(/Pages free:\s+(\d+)\./);
  if (!pageSizeMatch || !freeMatch) return null;
  const pageSize = Number(pageSizeMatch[1]);
  const pages = Number(freeMatch[1]);
  return (pages * pageSize) / 1024 / 1024;
}
