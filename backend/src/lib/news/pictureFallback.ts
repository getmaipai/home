// NEWS-PICTURE-FALLBACK-01: a story with no picture of its own shows its publisher's icon, large, centered on a quiet card, never the
// camera placeholder. The icon comes through the hub's own favicon fetch (lib/favicons.ts), the browser never calls the publisher.
import sharp from "sharp";
import { createHash } from "node:crypto";
import { getFavicon, iconImageBytes, pngFromIco, validateFaviconHost } from "@/lib/favicons";
import { hostOf } from "./cards";
import type { NewsPictureWidth } from "./pictures";
import type { ShelfItem } from "@/lib/shelf/shelfStore";
import { bumpNewsCounter } from "./newsCounters";

export { pngFromIco };

export async function publisherIconPicture(item: Pick<ShelfItem, "canonical_url">, width: NewsPictureWidth): Promise<{ bytes: Uint8Array; etag: string } | null> {
  const host = hostOf(item.canonical_url);
  if (!host) return null;
  try {
    const validation = await validateFaviconHost(host);
    if (!validation.ok) return null;
    const icon = await getFavicon(validation.host, undefined, new Date(), "large");
    if (!icon.found) { bumpNewsCounter("picture_icon_missing"); return null; }
    const height = Math.round((width * 9) / 16);
    const size = Math.round(height * 0.5);
    const image = await iconImageBytes(icon.bytes);
    if (!image) { bumpNewsCounter("picture_icon_unreadable"); return null; }
    const source = Buffer.from(image);
    const meta = await sharp(source).metadata();
    if ((meta.width ?? 0) < 16 || (meta.height ?? 0) < 16) { bumpNewsCounter("picture_icon_unreadable"); return null; } // a 1x1 placeholder is not an icon
    const glyph = await sharp(source).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const bytes = new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r: 38, g: 38, b: 42 } } })
      .composite([{ input: glyph, gravity: "centre" }]).webp({ quality: 82 }).toBuffer());
    return { bytes, etag: `"${createHash("sha1").update(bytes).digest("hex").slice(0, 24)}"` };
  } catch {
    bumpNewsCounter("picture_icon_unreadable");
    return null; // an icon sharp cannot read (an .ico) leaves the card as it was
  }
}

/** The last stand-in, for a story whose picture and publisher icon are both unavailable: the same quiet card with a plain page glyph
 * (drawn as shapes, so it needs no font on the hub). The picture route never answers 404 for a released story, so a screen never logs
 * a failed picture and never falls back to the kit's camera. */
export async function genericPicture(width: NewsPictureWidth): Promise<{ bytes: Uint8Array; etag: string }> {
  const height = Math.round((width * 9) / 16);
  const side = Math.round(height * 0.4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 100 100" fill="none" stroke="#8a8a93" stroke-width="5" stroke-linecap="round">`
    + `<rect x="18" y="10" width="64" height="80" rx="8"/><path d="M32 32h36M32 46h36M32 60h22"/></svg>`;
  const glyph = await sharp(Buffer.from(svg)).png().toBuffer();
  const bytes = new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r: 38, g: 38, b: 42 } } })
    .composite([{ input: glyph, gravity: "centre" }]).webp({ quality: 82 }).toBuffer());
  return { bytes, etag: `"${createHash("sha1").update(bytes).digest("hex").slice(0, 24)}"` };
}
