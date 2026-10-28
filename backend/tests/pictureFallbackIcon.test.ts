import { describe, expect, test, beforeEach } from "bun:test";
import sharp from "sharp";
import { __clearFaviconCacheForTests, __setFaviconDnsLookupForTests, __setFaviconFetchForTests } from "@/lib/favicons";
import { publisherIconPicture, pngFromIco } from "@/lib/news/pictureFallback";

beforeEach(() => __clearFaviconCacheForTests());

async function png(side: number): Promise<Buffer> {
  return sharp({ create: { width: side, height: side, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
}

/** An .ico with one PNG entry, the shape Slashdot's 777 byte /favicon.ico has. */
function icoOf(image: Buffer, side: number): Uint8Array {
  const out = Buffer.alloc(22 + image.length);
  out.writeUInt16LE(1, 2); out.writeUInt16LE(1, 4);
  out[6] = side; out[7] = side; out.writeUInt16LE(32, 12);
  out.writeUInt32LE(image.length, 14); out.writeUInt32LE(22, 18);
  image.copy(out, 22);
  return new Uint8Array(out);
}

describe("publisher icon tile", () => {
  test("pngFromIco returns the PNG entry of an .ico, and null for a non-ico", async () => {
    const image = await png(32);
    expect(Buffer.from(pngFromIco(icoOf(image, 32))!).equals(image)).toBe(true);
    expect(pngFromIco(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  test("a site whose only icon is a PNG-in-ico .ico (Slashdot) gets a tile", async () => {
    __setFaviconDnsLookupForTests(async () => ({ address: "93.184.216.34", family: 4 }));
    const ico = icoOf(await png(32), 32);
    __setFaviconFetchForTests(async (url) => url.endsWith("/favicon.ico") ? new Response(ico, { status: 200, headers: { "content-type": "image/x-icon" } }) : new Response(null, { status: 404 }));
    try {
      const tile = await publisherIconPicture({ canonical_url: "https://example.com/story/1" }, 480);
      expect(tile).not.toBeNull();
      expect((await sharp(Buffer.from(tile!.bytes)).metadata()).width).toBe(480);
    } finally { __setFaviconFetchForTests(null); __setFaviconDnsLookupForTests(null); }
  });

  test("a 1x1 placeholder icon gives no tile", async () => {
    __setFaviconDnsLookupForTests(async () => ({ address: "93.184.216.34", family: 4 }));
    const tiny = await png(1);
    __setFaviconFetchForTests(async () => new Response(tiny, { status: 200, headers: { "content-type": "image/png" } }));
    try {
      expect(await publisherIconPicture({ canonical_url: "https://example.com/story/1" }, 480)).toBeNull();
    } finally { __setFaviconFetchForTests(null); __setFaviconDnsLookupForTests(null); }
  });
});

describe("the last stand-in and the bigger BBC thumbnail", () => {
  test("genericPicture is a real webp tile at both card widths", async () => {
    const { genericPicture } = await import("@/lib/news/pictureFallback");
    for (const width of [480, 1280] as const) {
      const tile = await genericPicture(width);
      const meta = await (await import("sharp")).default(Buffer.from(tile.bytes)).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["webp", width, Math.round((width * 9) / 16)]);
    }
  });

  test("a BBC 240 px thumbnail is asked for at 976 px; other addresses are left alone", async () => {
    const { largerVariantOf } = await import("@/lib/news/pictures");
    expect(largerVariantOf("https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/9995/live/a.jpg")).toBe("https://ichef.bbci.co.uk/ace/standard/976/cpsprodpb/9995/live/a.jpg");
    expect(largerVariantOf("https://ichef.bbci.co.uk/ace/standard/976/cpsprodpb/a.jpg")).toBeNull();
    expect(largerVariantOf("https://example.com/ace/standard/240/a.jpg")).toBeNull();
  });
});
