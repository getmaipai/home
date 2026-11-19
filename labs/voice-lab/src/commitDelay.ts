const unfinished = /(?:\b(?:and|but|so|because|or|um|uh|like|the|a|to|of|with|my|i|if|when|that|which)|,)\s*$/i;
export function commitDelay(transcript: string, probability: number, startMs = 900): number {
  return probability < 0.3 || unfinished.test(transcript.trim()) ? Math.min(1800, startMs + 900) : startMs;
}
