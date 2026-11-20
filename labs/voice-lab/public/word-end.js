// Where to stop the voice so it finishes the word it is in the middle of, instead of being cut off mid-word.
// Looks ahead from the sample being heard now for the first quiet moment (the gap after a word). If the voice is
// already in a gap, it stops at once. If no gap comes within the limit, it stops at the quietest moment in reach,
// so an interruption is never held up by more than `maxMs`.
export function wordEnd(samples, from, sampleRate, maxMs = 450) {
  const frame = Math.max(1, Math.round(sampleRate * 0.02));
  const end = Math.min(samples.length, from + Math.round(sampleRate * maxMs / 1000));
  if (end - from < frame) return samples.length;
  const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += samples[i] * samples[i]; return Math.sqrt(s / Math.max(1, b - a)); };
  const back = Math.max(0, from - Math.round(sampleRate * 0.3));
  const level = Math.max(rms(back, from), rms(from, end));
  const quiet = Math.max(0.003, level * 0.18);
  let best = from, bestRms = Infinity;
  for (let at = from; at + frame <= end; at += frame) {
    const r = rms(at, at + frame);
    if (r < quiet) return at + Math.round(frame / 2);
    // past the first 120 ms, remember the quietest spot as the fallback
    if (at - from >= Math.round(sampleRate * 0.12) && r < bestRms) { bestRms = r; best = at + Math.round(frame / 2); }
  }
  return bestRms === Infinity ? end : best;
}
