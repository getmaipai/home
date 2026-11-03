// VIDEO-STUDIO-07: how long a sound file is, read from its own header, for the Studio's songs and voice lines (the page needs the length to draw a piece and to
// stop a trim at the end). WAV (`data` size and byte rate), MP4 and M4A (`mvhd` time scale and duration) and MP3 (a Xing or Info frame count, else the bitrate of the
// first frame) are read; anything else is unknown (null), never a guess.
const tag4 = (b: Uint8Array, at: number): string => String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);
const round = (n: number): number => Math.round(n * 100) / 100;

export function wavSeconds(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (tag4(bytes, 0) !== "RIFF" || tag4(bytes, 8) !== "WAVE") return null;
  let byteRate = 0;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const size = view.getUint32(at + 4, true);
    if (tag4(bytes, at) === "fmt ") byteRate = view.getUint32(at + 16, true);
    if (tag4(bytes, at) === "data") {
      // A streamed WAV can carry an open-ended size (0 or 0xFFFFFFFF): the rest of the file is the sound.
      const length = size === 0 || size === 0xffffffff || at + 8 + size > bytes.byteLength ? bytes.byteLength - (at + 8) : size;
      return byteRate > 0 ? round(length / byteRate) : null;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/** The `mvhd` box of an MP4 or M4A: duration over time scale. */
export function mp4Seconds(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const scan = (start: number, end: number): number | null => {
    let at = start;
    while (at + 8 <= end) {
      let size = view.getUint32(at);
      const type = tag4(bytes, at + 4);
      let header = 8;
      if (size === 1 && at + 16 <= end) { size = Number(view.getBigUint64(at + 8)); header = 16; }
      if (size === 0) size = end - at;
      if (size < header || at + size > end) return null;
      if (type === "mvhd") {
        const version = bytes[at + header]!;
        const base = at + header + 4;
        if (version === 1 && base + 28 <= end) { const scale = view.getUint32(base + 16); return scale > 0 ? round(Number(view.getBigUint64(base + 20)) / scale) : null; }
        if (base + 16 <= end) { const scale = view.getUint32(base + 8); return scale > 0 ? round(view.getUint32(base + 12) / scale) : null; }
        return null;
      }
      if (type === "moov") return scan(at + header, at + size);
      at += size;
    }
    return null;
  };
  return scan(0, bytes.byteLength);
}

const MP3_BITRATES: Record<string, number[]> = {
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export function mp3Seconds(bytes: Uint8Array): number | null {
  let at = 0;
  if (tag4(bytes, 0).startsWith("ID3") && bytes.byteLength > 10) at = 10 + (((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f));
  for (; at + 4 < bytes.byteLength && at < 1 << 20; at += 1) {
    if (bytes[at] !== 0xff || (bytes[at + 1]! & 0xe0) !== 0xe0) continue;
    const version = (bytes[at + 1]! >> 3) & 3;
    const layer = (bytes[at + 1]! >> 1) & 3;
    const bitrateIndex = bytes[at + 2]! >> 4;
    const rateIndex = (bytes[at + 2]! >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue;
    const rate = MP3_RATES[version]![rateIndex]!;
    const kbps = MP3_BITRATES[version === 3 ? "v1l3" : "v2l3"]![bitrateIndex]!;
    const samplesPerFrame = version === 3 ? 1152 : 576;
    // A Xing or Info frame says how many frames the file has.
    const side = version === 3 ? ((bytes[at + 3]! >> 6) === 3 ? 17 : 32) : ((bytes[at + 3]! >> 6) === 3 ? 9 : 17);
    const x = at + 4 + side;
    if (x + 12 <= bytes.byteLength && (tag4(bytes, x) === "Xing" || tag4(bytes, x) === "Info")) {
      const flags = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(x + 4);
      if (flags & 1) return round((new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(x + 8) * samplesPerFrame) / rate);
    }
    return round(((bytes.byteLength - at) * 8) / (kbps * 1000));
  }
  return null;
}

/** The length in seconds of a WAV, M4A/MP4 or MP3 file, or null when the header does not say. */
export function audioSeconds(bytes: Uint8Array): number | null {
  const found = wavSeconds(bytes) ?? mp4Seconds(bytes) ?? mp3Seconds(bytes);
  return found !== null && found > 0 ? found : null;
}
