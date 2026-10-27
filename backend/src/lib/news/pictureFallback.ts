// NEWS-PICTURE-FALLBACK-01: a story with no picture of its own shows its publisher's icon, large, centered on a quiet card, never the
// camera placeholder. The icon comes through the hub's own favicon fetch (lib/favicons.ts), the browser never calls the publisher.
import sharp from "sharp";
import { createHash } from "node:crypto";
import { getFavicon, validateFaviconHost } from "@/lib/favicons";
import { hostOf } from "./cards";
import type { NewsPictureWidth } from "./pictures";
import type { ShelfItem } from "@/lib/shelf/shelfStore";

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
    const glyph = await sharp(Buffer.from(icon.bytes)).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const bytes = new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r: 38, g: 38, b: 42 } } })
      .composite([{ input: glyph, gravity: "centre" }]).webp({ quality: 82 }).toBuffer());
    return { bytes, etag: `"${createHash("sha1").update(bytes).digest("hex").slice(0, 24)}"` };
  } catch {
    return null; // an icon sharp cannot read (an .ico) leaves the card as it was
  }
}
