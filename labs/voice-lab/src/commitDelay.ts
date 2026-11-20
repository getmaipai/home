const unfinished = /(?:\b(?:and|but|so|because|or|um|uh|like|the|a|to|of|with|my|i|if|when|that|which)|,)\s*$/i;
/** A finished sentence the recognizer closed with ? . or ! (three words or more): the turn model is often unsure about short questions ("Why do cats purr?" scored 0.02), so wait only a short beat, not the full timeout. If the person goes on, the committed speech is resumed (resume_committed). */
export const SENTENCE_END_COMMIT_MS = 500;
const closed = /[?.!]["')\]]*\s*$/;
export function commitDelay(transcript: string, probability: number, startMs = 900): number {
  const t = transcript.trim(); if (closed.test(t) && t.split(/\s+/).length >= 3 && !unfinished.test(t)) return Math.min(startMs, SENTENCE_END_COMMIT_MS);
  return probability < 0.3 || unfinished.test(transcript.trim()) ? Math.min(1800, startMs + 900) : startMs;
}
