// Sentence-boundary detection for speaking a streaming reply as it
// arrives (2026-09-04): ported from home-legacy.git's
// frontend/src/hooks/useCompanionVoice.ts (the org's "hard-won logic"
// reuse precedent, `.github/CLAUDE.md` principle 8) rather than
// re-derived from scratch. That file's own header comment explains the
// tuning this preserves: flush on the first real sentence terminator, or
// on a clause boundary once a run-on sentence is long enough that
// waiting for a terminator would delay first audio too much - whichever
// comes first. A single newline is a soft wrap, not a boundary. Clause
// boundaries (comma/semicolon/colon/dash) are used only to flush a long
// run-on, never to split a short sentence: the legacy team tried
// clause-splitting the very first chunk more aggressively and reverted
// it after it produced jarring mid-phrase chops ("Oh no," / "that's
// concerning!") - see that file's own comment for the specifics. This
// keeps that decision rather than re-discovering it.

const SENTENCE_BOUNDARY = /[.!?]+(?=\s+[A-Z0-9]|\s*$)|\n{2,}/g;
const CLAUSE_BOUNDARY = /[,;:](?=\s)|\s[-–—](?=\s)/g;
const WHOLE_SENTENCE_MAX = 130; // sentences up to this length play whole (no splitting)
const CLAUSE_FLUSH_MIN = 50; // never flush a clause shorter than this
const CLAUSE_GATE_DEFAULT = WHOLE_SENTENCE_MAX - 20; // 110
// The opener is the single most latency-sensitive chunk (time-to-first-audio
// matters most there), so it gets a slightly lower gate than later chunks.
// DUPLEX-FIRST-CLAUSE-01 (2026-11-11): measured live, the first sound waited for up to 90 to 130 characters of text (1.3 to 2.7 s of
// generation) and then for the voice to speak that whole first chunk (0.8 to 1.9 s). The first chunk of a reply now flushes at the FIRST
// clause boundary at or past 32 characters once 40 are in, so "Oh no," (6) and "that's concerning!" never split but a long opening does.
const CLAUSE_GATE_FIRST_CHUNK = 40;
const CLAUSE_FLUSH_MIN_FIRST_CHUNK = 32;
// FIRST-WORD-SPEECH-01 (2026-11-13): an opening sentence with no comma or full stop in its first 44 characters used to wait for its
// whole sentence (up to 130 characters), so the voice started only after the text had finished typing. Now the opener also flushes at
// the last whole word once 44 characters are in (never before the 28th), so the voice starts on the first few words.
const FIRST_CHUNK_WORD_GATE = 44;
const FIRST_CHUNK_WORD_MIN = 28;

/** End offset of the next speakable chunk in `sub`, or -1 if none yet.
 * `firstChunk` lowers the clause-flush gate for the very first boundary
 * of a fresh reply only. */
export function nextSentenceBoundary(sub: string, firstChunk = false): number {
  SENTENCE_BOUNDARY.lastIndex = 0;
  const term = SENTENCE_BOUNDARY.exec(sub);
  const termEnd = term ? term.index + term[0].length : -1;
  if (termEnd >= 0 && termEnd <= WHOLE_SENTENCE_MAX) return termEnd; // whole sentence wins

  const clauseGate = firstChunk ? CLAUSE_GATE_FIRST_CHUNK : CLAUSE_GATE_DEFAULT;
  if (sub.length >= clauseGate) {
    CLAUSE_BOUNDARY.lastIndex = 0;
    let clauseEnd = -1;
    let m: RegExpExecArray | null;
    const floor = firstChunk ? CLAUSE_FLUSH_MIN_FIRST_CHUNK : CLAUSE_FLUSH_MIN;
    while ((m = CLAUSE_BOUNDARY.exec(sub)) !== null) {
      const e = m.index + m[0].length;
      if (e >= floor && e <= WHOLE_SENTENCE_MAX) {
        clauseEnd = e;
        if (firstChunk) break; // the opener takes the first usable clause, later chunks the last in range
      }
    }
    if (clauseEnd > 0) return clauseEnd;
  }
  if (firstChunk && sub.length >= FIRST_CHUNK_WORD_GATE) {
    const space = sub.lastIndexOf(" ");
    if (space >= FIRST_CHUNK_WORD_MIN) return space;
  }
  return termEnd;
}

/** Splits every whole chunk currently available out of `pending` (text not
 * yet consumed), in order, stopping at the first point with no complete
 * boundary yet. Returns the chunks plus how many characters of `pending`
 * they consumed - the caller advances its own cursor by that amount and
 * keeps the remainder for the next call. `firstChunk` applies only to the
 * very first boundary found, matching nextSentenceBoundary's own rule. */
export function splitReadyChunks(pending: string, firstChunk: boolean): { chunks: string[]; consumed: number } {
  const chunks: string[] = [];
  let consumed = 0;
  let isFirst = firstChunk;
  for (;;) {
    const sub = pending.slice(consumed);
    const end = nextSentenceBoundary(sub, isFirst);
    if (end < 0) break;
    const chunk = sub.slice(0, end).trim();
    if (chunk) chunks.push(chunk);
    consumed += end;
    isFirst = false;
  }
  return { chunks, consumed };
}
