// CANARY-01: a small WAV reader for the loopback check (PCM 16-bit and 32-bit float, first channel).
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let format = 0, channels = 1, sampleRate = 0, bits = 16;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    let size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      if (size === 0 || size === 0xffffffff || body + size > bytes.length) size = bytes.length - body; // streamed WAVs
      const bytesPer = bits / 8;
      const frames = Math.floor(size / (bytesPer * channels));
      if (!sampleRate || frames <= 0) return null;
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const at = body + i * bytesPer * channels;
        if (format === 3 && bits === 32) samples[i] = view.getFloat32(at, true);
        else if (format === 1 && bits === 16) samples[i] = view.getInt16(at, true) / 32768;
        else return null;
      }
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return null;
}
