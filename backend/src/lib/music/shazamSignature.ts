// MUSIC-ID-05 (docs/design/music-identify-shazam-2026-11-14.md): the acoustic signature a snippet lookup sends instead of audio.
//
// A signature is a list of spectral peaks (time, strength, frequency), never audio: the recording cannot be rebuilt from it. It is
// made here, on this computer, from decoded 16 kHz mono samples, then the signature alone goes to the lookup service.
//
// Attribution: the algorithm and the binary layout follow SongRec by Marin Maillard and contributors (github.com/marin-m/SongRec,
// GPL-3.0-or-later, `src/core/fingerprinting/algorithm.rs` and `signature_format.rs`), itself a reverse-engineering of the Shazam
// client format. This file is an independent TypeScript implementation written from reading that source; Home is AGPL-3.0-or-later,
// which accepts GPL-3.0 code (AGPL section 13). Nothing here is vendored; see docs/dev/music-identify.md.
//
// Rule 6: nothing here throws on odd input; `makeSignature` returns null when there is nothing to sign.

export const SIGNATURE_RATE = 16_000;
const FFT_SIZE = 2048;
const BINS = 1025;
const HOP = 128;
const HISTORY = 256;
/** SongRec signs 12 seconds: shorter input is zero padded, longer input is cut around its middle. */
const SIGN_SECONDS = 12;
const DATA_URI_PREFIX = "data:audio/vnd.shazam.sig;base64,";

export type FrequencyPeak = { pass: number; magnitude: number; bin: number };
/** Four bands: 250 to 520 Hz, 520 to 1450, 1450 to 3500, 3500 to 5500. */
export type Signature = { sampleRate: number; samples: number; bands: [FrequencyPeak[], FrequencyPeak[], FrequencyPeak[], FrequencyPeak[]] };

// ---- The FFT: real input, 2048 points, radix-2 --------------------------------------------------------------------------------------

const HANNING = (() => {
  const window = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (FFT_SIZE + 1));
  return window;
})();

const COS = new Float64Array(FFT_SIZE / 2);
const SIN = new Float64Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i++) { COS[i] = Math.cos((2 * Math.PI * i) / FFT_SIZE); SIN[i] = -Math.sin((2 * Math.PI * i) / FFT_SIZE); }

const REVERSE = (() => {
  const table = new Uint16Array(FFT_SIZE);
  const bits = Math.log2(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    table[i] = r;
  }
  return table;
})();

/** In-place complex FFT of `re`/`im` (length 2048). */
function fft(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = REVERSE[i]!;
    if (j > i) { const tr = re[i]!; re[i] = re[j]!; re[j] = tr; const ti = im[i]!; im[i] = im[j]!; im[j] = ti; }
  }
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1;
    const step = FFT_SIZE / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let k = 0; k < half; k++) {
        const c = COS[k * step]!;
        const s = SIN[k * step]!;
        const a = start + k;
        const b = a + half;
        const tr = re[b]! * c - im[b]! * s;
        const ti = re[b]! * s + im[b]! * c;
        re[b] = re[a]! - tr; im[b] = im[a]! - ti;
        re[a] = re[a]! + tr; im[a] = im[a]! + ti;
      }
    }
  }
}

// ---- Peak finding (SongRec's `SignatureGenerator`) ---------------------------------------------------------------------------------

const FREQ_NEIGHBORS = [-10, -7, -4, -3, 1, 2, 5, 8];
const TIME_NEIGHBORS = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249];

function toU16(value: number): number {
  // Rust's `as u16` from a float saturates; from an integer it wraps. Both callers pass a finite number.
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 65535 ? 65535 : Math.trunc(value);
}

/** Sign 16 kHz mono signed 16-bit samples (little-endian bytes or an Int16Array). Returns null for an empty input. */
export function makeSignature(pcm: Int16Array): Signature | null {
  if (pcm.length < HOP) return null;
  const want = SIGN_SECONDS * SIGNATURE_RATE;
  let input: Int16Array;
  if (pcm.length < want) { input = new Int16Array(want); input.set(pcm); }
  else if (pcm.length > want) { const middle = pcm.length >> 1; input = pcm.subarray(middle - want / 2, middle + want / 2); }
  else input = pcm;

  const signature: Signature = { sampleRate: SIGNATURE_RATE, samples: input.length, bands: [[], [], [], []] };
  const ring = new Int16Array(FFT_SIZE);
  let ringIndex = 0;
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const fftOut: Float32Array[] = Array.from({ length: HISTORY }, () => new Float32Array(BINS));
  const spread: Float32Array[] = Array.from({ length: HISTORY }, () => new Float32Array(BINS));
  let fftIndex = 0;
  let spreadIndex = 0;
  let spreadDone = 0;
  const copy = new Float32Array(BINS);

  for (let offset = 0; offset + HOP <= input.length; offset += HOP) {
    // do_fft: put the 128 new samples in the ring, order it with the newest last, window it, transform it.
    ring.set(input.subarray(offset, offset + HOP), ringIndex);
    ringIndex = (ringIndex + HOP) & (FFT_SIZE - 1);
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = ring[(i + ringIndex) & (FFT_SIZE - 1)]! * HANNING[i]!; im[i] = 0; }
    fft(re, im);
    const row = fftOut[fftIndex]!;
    for (let i = 0; i < BINS; i++) row[i] = Math.max((re[i]! * re[i]! + im[i]! * im[i]!) / (1 << 17), 1e-10);
    fftIndex = (fftIndex + 1) & 255;

    // do_peak_spreading: spread each value over neighbouring bins and over the earlier passes.
    const latest = fftOut[(fftIndex - 1) & 255]!;
    const current = spread[spreadIndex]!;
    current.set(latest);
    for (let p = 0; p <= 1022; p++) current[p] = Math.max(current[p]!, current[p + 1]!, current[p + 2]!);
    copy.set(current);
    for (const former of [1, 3, 6]) {
      const target = spread[(spreadIndex - former) & 255]!;
      for (let p = 0; p <= 1024; p++) if (copy[p]! > target[p]!) target[p] = copy[p]!;
    }
    spreadIndex = (spreadIndex + 1) & 255;
    spreadDone++;

    if (spreadDone >= 46) recognisePeaks(signature, fftOut[(fftIndex - 46) & 255]!, spread[(spreadIndex - 49) & 255]!, spread, spreadIndex, spreadDone - 46);
  }
  return signature;
}

function recognisePeaks(signature: Signature, at46: Float32Array, spread49: Float32Array, spread: Float32Array[], spreadIndex: number, pass: number): void {
  for (let bin = 10; bin <= 1014; bin++) {
    const value = at46[bin]!;
    if (value < 1 / 64 || value < spread49[bin - 1]!) continue;
    let max = 0;
    for (const offset of FREQ_NEIGHBORS) max = Math.max(max, spread49[bin + offset]!);
    if (!(value > max)) continue;
    for (const offset of TIME_NEIGHBORS) max = Math.max(max, spread[(spreadIndex + offset) & 255]![bin - 1]!);
    if (!(value > max)) continue;

    const magnitude = Math.max(Math.log(value), 1 / 64) * 1477.3 + 6144;
    const before = Math.max(Math.log(at46[bin - 1]!), 1 / 64) * 1477.3 + 6144;
    const after = Math.max(Math.log(at46[bin + 1]!), 1 / 64) * 1477.3 + 6144;
    const variation1 = magnitude * 2 - before - after;
    const variation2 = ((after - before) * 32) / variation1;
    if (!(variation1 >= 0) || !Number.isFinite(variation2)) continue;
    const corrected = (bin * 64 + Math.trunc(variation2)) & 0xffff;
    const hz = Math.trunc(corrected * (SIGNATURE_RATE / 2 / 1024 / 64));
    let band: 0 | 1 | 2 | 3;
    if (hz >= 250 && hz <= 519) band = 0;
    else if (hz >= 520 && hz <= 1449) band = 1;
    else if (hz >= 1450 && hz <= 3499) band = 2;
    else if (hz >= 3500 && hz <= 5500) band = 3;
    else continue;
    signature.bands[band].push({ pass, magnitude: toU16(magnitude), bin: corrected });
  }
}

// ---- The binary layout and the data URI ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The signature as the service's binary message: a 48 byte header, then one run of peaks per band. */
export function encodeSignature(signature: Signature): Uint8Array {
  const bandBytes: Array<{ band: number; bytes: Uint8Array }> = [];
  signature.bands.forEach((peaks, band) => {
    if (peaks.length === 0) return;
    const out: number[] = [];
    let pass = 0;
    for (const peak of peaks) {
      if (peak.pass - pass >= 255) {
        out.push(0xff, peak.pass & 0xff, (peak.pass >>> 8) & 0xff, (peak.pass >>> 16) & 0xff, (peak.pass >>> 24) & 0xff);
        pass = peak.pass;
      }
      out.push(peak.pass - pass, peak.magnitude & 0xff, (peak.magnitude >>> 8) & 0xff, peak.bin & 0xff, (peak.bin >>> 8) & 0xff);
      pass = peak.pass;
    }
    bandBytes.push({ band, bytes: Uint8Array.from(out) });
  });
  let total = 48 + 8;
  for (const { bytes } of bandBytes) total += 8 + bytes.length + ((4 - (bytes.length % 4)) % 4);
  const buffer = new Uint8Array(total);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0xcafe2580, true);
  view.setUint32(8, total - 48, true);
  view.setUint32(12, 0x94119c00, true);
  view.setUint32(28, 3 << 27, true); // 16000 Hz
  view.setUint32(40, signature.samples + Math.trunc(signature.sampleRate * 0.24), true);
  view.setUint32(44, (15 << 19) + 0x40000, true);
  view.setUint32(48, 0x40000000, true);
  view.setUint32(52, total - 48, true);
  let cursor = 56;
  for (const { band, bytes } of bandBytes) {
    view.setUint32(cursor, 0x60030040 + band, true);
    view.setUint32(cursor + 4, bytes.length, true);
    buffer.set(bytes, cursor + 8);
    cursor += 8 + bytes.length + ((4 - (bytes.length % 4)) % 4);
  }
  view.setUint32(4, crc32(buffer.subarray(8)), true);
  return buffer;
}

export function signatureUri(signature: Signature): string {
  return DATA_URI_PREFIX + Buffer.from(encodeSignature(signature)).toString("base64");
}

/** Read a binary message back (used by the tests to prove the layout round-trips). Null when it is malformed. */
export function decodeSignature(data: Uint8Array): Signature | null {
  try {
    if (data.length <= 56) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(0, true) !== 0xcafe2580 || view.getUint32(12, true) !== 0x94119c00) return null;
    if (view.getUint32(8, true) !== data.length - 48 || view.getUint32(4, true) !== crc32(data.subarray(8))) return null;
    if (view.getUint32(28, true) >>> 27 !== 3) return null;
    const samples = view.getUint32(40, true) - Math.trunc(SIGNATURE_RATE * 0.24);
    const signature: Signature = { sampleRate: SIGNATURE_RATE, samples, bands: [[], [], [], []] };
    let cursor = 56;
    while (cursor < data.length) {
      const band = view.getUint32(cursor, true) - 0x60030040;
      const size = view.getUint32(cursor + 4, true);
      if (band < 0 || band > 3 || cursor + 8 + size > data.length) return null;
      let pass = 0;
      let at = cursor + 8;
      const end = at + size;
      while (at < end) {
        const offset = data[at++]!;
        if (offset === 0xff) { pass = view.getUint32(at, true); at += 4; continue; }
        pass += offset;
        signature.bands[band as 0 | 1 | 2 | 3].push({ pass, magnitude: view.getUint16(at, true), bin: view.getUint16(at + 2, true) });
        at += 4;
      }
      cursor += 8 + size + ((4 - (size % 4)) % 4);
    }
    return signature;
  } catch {
    return null;
  }
}
