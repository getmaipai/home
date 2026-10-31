/** Length in seconds of an m4a or mp4 file, read from its movie header; null when the header is missing or odd. */
export function m4aSeconds(bytes: Uint8Array): number | null {
  const at = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 65_536))).indexOf("mvhd");
  if (at < 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = at + 4;
  if (start + 28 > bytes.length) return null;
  const version = bytes[start]!;
  const timescale = version === 1 ? view.getUint32(start + 20) : view.getUint32(start + 12);
  const duration = version === 1 ? Number(view.getBigUint64(start + 24)) : view.getUint32(start + 16);
  return timescale > 0 && duration > 0 ? duration / timescale : null;
}
