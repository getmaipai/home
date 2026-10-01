export interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Float32Array;
  durationSeconds: number;
  dataOffset: number;
}

export function parseWav(bytes: Uint8Array): ParsedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (): never => { throw new Error("Unsupported or invalid WAV: expected PCM16 or IEEE float32 RIFF/WAVE data"); };
  if (bytes.byteLength < 44 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.subarray(8, 12)) !== "WAVE") return fail();
  let offset = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt ") {
      if (start + 16 > bytes.byteLength) return fail();
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bitsPerSample = view.getUint16(start + 14, true);
    } else if (id === "data") { dataOffset = start; break; }
    if (size === 0xffffffff || size === 0) break;
    offset = start + size + (size & 1);
  }
  if (dataOffset < 0 || channels < 1 || sampleRate < 1 || !((format === 1 && bitsPerSample === 16) || (format === 3 && bitsPerSample === 32))) return fail();
  const stride = channels * (bitsPerSample / 8);
  const frames = Math.floor((bytes.byteLength - dataOffset) / stride);
  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      const position = dataOffset + (frame * channels + channel) * (bitsPerSample / 8);
      sum += format === 1 ? view.getInt16(position, true) / 32768 : view.getFloat32(position, true);
    }
    samples[frame] = sum / channels;
  }
  return { sampleRate, channels, bitsPerSample, samples, durationSeconds: frames / sampleRate, dataOffset };
}

export function clipFraction(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let clipped = 0;
  for (const sample of samples) if (Math.abs(sample) >= 0.999) clipped++;
  return clipped / samples.length;
}

export function edgeSilence(samples: Float32Array, sampleRate: number): { leadingSeconds: number; trailingSeconds: number } {
  if (sampleRate <= 0) throw new Error("sampleRate must be positive");
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]!) < 0.01) first++;
  let last = samples.length - 1;
  while (last >= 0 && Math.abs(samples[last]!) < 0.01) last--;
  return { leadingSeconds: first / sampleRate, trailingSeconds: (samples.length - 1 - last) / sampleRate };
}

export interface LineMetrics { durationSeconds: number; clipFraction: number; leadingSeconds: number; trailingSeconds: number; firstAudioMs: number }
export interface LineComparison {
  durationRatio: number; durationOk: boolean; clipOk: boolean; silenceOk: boolean; firstAudioRatio: number; firstAudioOk: boolean;
}
export interface ProofRow { line: number; text: string; home: LineMetrics; stack: LineMetrics; comparison: LineComparison }

export function compareLine(home: LineMetrics, stack: LineMetrics): LineComparison {
  const durationRatio = stack.durationSeconds / home.durationSeconds;
  const firstAudioRatio = stack.firstAudioMs / home.firstAudioMs;
  return {
    durationRatio,
    durationOk: durationRatio >= 0.95 && durationRatio <= 1.05,
    clipOk: home.clipFraction < 0.001 && stack.clipFraction < 0.001,
    silenceOk: home.leadingSeconds <= 0.6 && home.trailingSeconds <= 0.6 && stack.leadingSeconds <= 0.6 && stack.trailingSeconds <= 0.6 && stack.leadingSeconds <= home.leadingSeconds + 0.25 && stack.trailingSeconds <= home.trailingSeconds + 0.25,
    firstAudioRatio,
    firstAudioOk: firstAudioRatio <= 1.25,
  };
}

export function summarize(rows: ProofRow[]) {
  const checks = ["durationOk", "clipOk", "silenceOk", "firstAudioOk"] as const;
  const ratios = (key: "durationRatio" | "firstAudioRatio") => {
    const sorted = rows.map((row) => row.comparison[key]).sort((a, b) => a - b);
    const median = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.ceil((sorted.length - 1) / 2)]!) / 2 : 0;
    return { median, worst: sorted.length ? Math.max(...sorted) : 0 };
  };
  const counts = Object.fromEntries(checks.map((key) => [key, { ok: rows.filter((row) => row.comparison[key]).length, notOk: rows.filter((row) => !row.comparison[key]).length }]));
  return { counts, durationRatio: ratios("durationRatio"), firstAudioRatio: ratios("firstAudioRatio"), passed: rows.every((row) => checks.every((key) => row.comparison[key])) };
}

export function renderTable(rows: ProofRow[]): string {
  const lines = ["#  text summary", ...rows.map((row) => `${String(row.line).padStart(2)}  dur ${row.comparison.durationRatio.toFixed(3)} ${row.comparison.durationOk ? "OK" : "FAIL"}  clip ${row.comparison.clipOk ? "OK" : "FAIL"}  silence ${row.comparison.silenceOk ? "OK" : "FAIL"}  first ${row.comparison.firstAudioRatio.toFixed(3)} ${row.comparison.firstAudioOk ? "OK" : "FAIL"}  ${row.text}`)];
  const result = summarize(rows);
  lines.push(`Summary: ${result.passed ? "PASS" : "FAIL"}; duration median ${result.durationRatio.median.toFixed(3)}, worst ${result.durationRatio.worst.toFixed(3)}; first audio median ${result.firstAudioRatio.median.toFixed(3)}, worst ${result.firstAudioRatio.worst.toFixed(3)}`);
  return lines.join("\n");
}
