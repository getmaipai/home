// MEDIA-LIB-01: a minimal reader for the central directory of a ZIP file, enough to open an EPUB without a zip library.
// Stored and deflated entries only (an EPUB uses nothing else); no ZIP64, no encryption.
import { inflateRawSync } from "node:zlib";

interface ZipEntry {
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

export interface ZipFile {
  names(): string[];
  has(name: string): boolean;
  read(name: string, maxBytes?: number): Promise<Uint8Array | null>;
}

async function bytesAt(path: string, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(path).slice(start, end).arrayBuffer());
}

export async function openZip(path: string): Promise<ZipFile | null> {
  const total = Bun.file(path).size;
  if (total < 22) return null;
  const tailStart = Math.max(0, total - 66_000);
  const tail = await bytesAt(path, tailStart, total);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = tailView.getUint16(eocd + 10, true);
  const directorySize = tailView.getUint32(eocd + 12, true);
  const directoryOffset = tailView.getUint32(eocd + 16, true);
  if (directoryOffset === 0xffffffff || directoryOffset + directorySize > total) return null;
  const directory = await bytesAt(path, directoryOffset, directoryOffset + directorySize);
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let pos = 0;
  for (let n = 0; n < count && pos + 46 <= directory.byteLength; n++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const offset = view.getUint32(pos + 42, true);
    const name = decoder.decode(directory.subarray(pos + 46, pos + 46 + nameLength));
    entries.set(name, { method, compressedSize, size, offset });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    async read(name, maxBytes = 8 * 1024 * 1024) {
      const entry = entries.get(name);
      if (!entry || entry.size > maxBytes) return null;
      const header = await bytesAt(path, entry.offset, entry.offset + 30);
      const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
      if (headerView.getUint32(0, true) !== 0x04034b50) return null;
      const dataStart = entry.offset + 30 + headerView.getUint16(26, true) + headerView.getUint16(28, true);
      const raw = await bytesAt(path, dataStart, dataStart + entry.compressedSize);
      if (entry.method === 0) return raw;
      if (entry.method === 8) {
        try { return new Uint8Array(inflateRawSync(raw)); } catch { return null; }
      }
      return null;
    },
  };
}
