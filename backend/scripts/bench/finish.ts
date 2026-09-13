// CHAT-22: the last line of every bench, split from setup.ts so a test
// can import it without tripping setup.ts's import-time guard (which
// exits the process the moment it runs outside a bench's own
// environment).

export interface BenchSummary {
  /** How many cases actually ran (rows, or rows times repeats). Zero is
   * a failed run, never a clean one. */
  executed: number;
  /** What answered: the engine tier and model the bench resolved, for
   * the record ("url, qwen3-8b-instruct-q4-k-m"). */
  engine?: string;
}

/** The last line of every bench: prints the identity and case count,
 * then exits. Zero executed cases exit 1 (a bench that ran nothing has
 * proved nothing, whatever its summary printed); a failed setup already
 * exited 2 above. The explicit exit is also what stops the process
 * hanging on the timers the turn engine's imports start (FAST-06's
 * finding). `exit` is injectable so a test can observe the code. */
export function finishBench(summary: BenchSummary, exit: (code: number) => void = (code) => process.exit(code)): void {
  const engine = summary.engine ?? `${process.env.MAIPAI_LLAMA_SERVER_URL} (chat), ${process.env.MAIPAI_EMBED_URL} (embed)`;
  console.log(`\nbench finished: engine ${engine}; executed ${summary.executed} cases; data directory ${process.env.MAIPAI_DATA_DIR} (disposable)`);
  if (!Number.isFinite(summary.executed) || summary.executed <= 0) {
    console.error("bench failed: zero cases executed, which cannot count as a pass.");
    exit(1);
    return;
  }
  exit(0);
}
