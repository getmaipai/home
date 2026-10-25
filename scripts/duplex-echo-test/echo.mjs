export function rms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function toDb(ratio) {
  return ratio <= 0 ? -Infinity : 20 * Math.log10(ratio);
}

export function windowedLevels(samples, sampleRate, windowMs = 100) {
  const size = Math.max(1, Math.round(sampleRate * windowMs / 1000));
  const levels = [];
  for (let start = 0; start + size <= samples.length; start += size) {
    levels.push(rms(samples.subarray ? samples.subarray(start, start + size) : samples.slice(start, start + size)));
  }
  return levels;
}

export function summarize(levels, noiseFloor) {
  if (!levels.length) return { meanDb: 0, worstDb: 0 };
  const dbLevels = levels.map(level => toDb(level / Math.max(noiseFloor, 1e-12)));
  return {
    meanDb: dbLevels.reduce((sum, level) => sum + level, 0) / dbLevels.length,
    worstDb: Math.max(...dbLevels),
  };
}

export function verdict(db) {
  if (db < 6) return "echo is cancelled";
  if (db <= 15) return "partly cancelled";
  return "not cancelled";
}
