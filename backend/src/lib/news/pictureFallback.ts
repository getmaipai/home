// NEWS-PICTURE-FALLBACK-01: a story with no picture of its own shows its publisher's icon, large, centered on a quiet card, never the
// camera placeholder. The icon comes through the hub's own favicon fetch (lib/favicons.ts), the browser never calls the publisher.
import sharp from "sharp";
import { createHash } from "node:crypto";
import { getFavicon, validateFaviconHost } from "@/lib/favicons";
import { hostOf } from "./cards";
import type { NewsPictureWidth } from "./pictures";
import type { ShelfItem } from "@/lib/shelf/shelfStore";

/** The largest PNG inside an .ico file (sharp cannot open an .ico; most modern ones carry PNG entries), or null. */
export function pngFromIco(bytes: Uint8Array): Uint8Array | null {
  if (bytes.byteLength < 22 || bytes[0] !== 0 || bytes[1] !== 0 || bytes[2] !== 1 || bytes[3] !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let best: Uint8Array | null = null;
  let bestSize = -1;
  for (let i = 0; i < view.getUint16(4, true); i++) {
    const at = 6 + i * 16;
    if (at + 16 > bytes.byteLength) break;
    const size = view.getUint32(at + 8, true);
    const offset = view.getUint32(at + 12, true);
    const entry = bytes.subarray(offset, offset + size);
    const isPng = entry.byteLength > 8 && entry[0] === 0x89 && entry[1] === 0x50 && entry[2] === 0x4e && entry[3] === 0x47;
    const side = (bytes[at] || 256);
    if (isPng && side > bestSize) { best = entry; bestSize = side; }
  }
  return best;
}

export async function publisherIconPicture(item: Pick<ShelfItem, "canonical_url">, width: NewsPictureWidth): Promise<{ bytes: Uint8Array; etag: string } | null> {
  const host = hostOf(item.canonical_url);
  if (!host) return null;
  try {
    const validation = await validateFaviconHost(host);
    if (!validation.ok) return null;
    const icon = await getFavicon(validation.host, undefined, new Date(), "large");
    if (!icon.found) return null;
    const height = Math.round((width * 9) / 16);
    const size = Math.round(height * 0.5);
    const source = Buffer.from(pngFromIco(icon.bytes) ?? icon.bytes);
    const meta = await sharp(source).metadata();
    if ((meta.width ?? 0) < 16 || (meta.height ?? 0) < 16) return null; // a 1x1 placeholder is not an icon
    const glyph = await sharp(source).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const bytes = new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r: 38, g: 38, b: 42 } } })
      .composite([{ input: glyph, gravity: "centre" }]).webp({ quality: 82 }).toBuffer());
    return { bytes, etag: `"${createHash("sha1").update(bytes).digest("hex").slice(0, 24)}"` };
  } catch {
    return null; // an icon sharp cannot read (an .ico) leaves the card as it was
  }
}
