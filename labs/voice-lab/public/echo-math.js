export function rms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function dbfs(level) {
  return 20 * Math.log10(Math.max(level, 1e-12));
}

function centeredCorrelation(signal, reference, offset) {
  let xy = 0, xx = 0, yy = 0, sx = 0, sy = 0;
  const n = Math.min(reference.length, signal.length - offset);
  if (n < Math.min(32, reference.length)) return 0;
  for (let i = 0; i < n; i++) { sx += signal[offset + i]; sy += reference[i]; }
  const mx = sx / n, my = sy / n;
  for (let i = 0; i < n; i++) {
    const x = signal[offset + i] - mx, y = reference[i] - my;
    xy += x * y; xx += x * x; yy += y * y;
  }
  return xx && yy ? xy / Math.sqrt(xx * yy) : 0;
}

export function findDelay(signal, reference, sampleRate, expectedMs = 0, rangeMs = Infinity) {
  const start = Math.max(0, Math.floor((expectedMs - rangeMs) * sampleRate / 1000));
  const end = Math.min(signal.length - reference.length, Math.ceil((expectedMs + rangeMs) * sampleRate / 1000));
  let best = { delaySamples: -1, delayMs: NaN, corr: 0 };
  for (let offset = start; offset <= end; offset++) {
    const corr = centeredCorrelation(signal, reference, offset);
    if (Math.abs(corr) > Math.abs(best.corr)) best = { delaySamples: offset, delayMs: offset * 1000 / sampleRate, corr };
  }
  return best;
}

export function chirp(sampleRate, durationSeconds = 1) {
  const length = Math.round(sampleRate * durationSeconds), out = new Float32Array(length);
  const f0 = 300, f1 = 3000, duration = length / sampleRate;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * (f0 * t + (f1 - f0) * t * t / (2 * duration));
    const fade = Math.min(1, i / (sampleRate * .02), (length - 1 - i) / (sampleRate * .02));
    out[i] = .6 * Math.max(0, fade) * Math.sin(phase);
  }
  return out;
}

export function measureClip(signal, reference, sampleRate, delayMs, options = {}) {
  const { delaySamples, delayMs: foundDelay, corr } = findDelay(signal, reference, sampleRate, delayMs, options.searchMs ?? 150);
  if (delaySamples < 0 || corr < (options.threshold ?? .18)) return { heard: false, corr, delayMs: NaN, clipLevel: 0, residualLevel: rms(signal) };
  const length = Math.min(reference.length, signal.length - delaySamples);
  const window = Math.max(1, Math.round(sampleRate * .25));
  let matchedEnergy = 0, referenceEnergy = 0, totalWeight = 0, residualEnergy = 0, residualCount = 0;
  for (let base = 0; base < length; base += window) {
    const n = Math.min(window, length - base);
    let xy = 0, yy = 0, xx = 0;
    for (let i = 0; i < n; i++) {
      const x = signal[delaySamples + base + i], y = reference[base + i];
      xy += x * y; yy += y * y; xx += x * x;
    }
    if (!yy) continue;
    const gain = xy / yy;
    const weight = yy;
    matchedEnergy += gain * gain * yy * weight;
    referenceEnergy += yy * weight;
    totalWeight += weight;
    for (let i = 0; i < n; i++) {
      const residual = signal[delaySamples + base + i] - gain * reference[base + i];
      residualEnergy += residual * residual; residualCount++;
    }
  }
  const clipLevel = referenceEnergy ? Math.sqrt(matchedEnergy / referenceEnergy) : 0;
  return { heard: true, corr, delayMs: foundDelay, clipLevel, residualLevel: Math.sqrt(residualEnergy / Math.max(1, residualCount)), weight: totalWeight };
}

export function relativeDb(level, referenceLevel) { return 20 * Math.log10(Math.max(level, 1e-12) / Math.max(referenceLevel, 1e-12)); }

export function speechLevel(samples, reference, sampleRate, delayMs) {
  const measured = findDelay(samples, reference, sampleRate, delayMs, 150);
  const start = Math.max(0, measured.delaySamples);
  const n = Math.min(reference.length, samples.length - start);
  const residual = new Float32Array(Math.max(0, n));
  let xy = 0, yy = 0;
  for (let i = 0; i < n; i++) { xy += samples[start + i] * reference[i]; yy += reference[i] ** 2; }
  const gain = yy ? xy / yy : 0;
  for (let i = 0; i < n; i++) residual[i] = samples[start + i] - gain * reference[i];
  return rms(residual);
}

export function doubleTalkDelta(levelA, levelB) { return relativeDb(levelB, levelA); }
