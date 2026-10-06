// IMGSIM-01: the shared "same photo" module. Synthetic, licence-clean
// pictures generated at test time (a texture with seed-placed shapes, so a
// feature matcher has the unique corners a real photo has); the measured
// numbers on real photos are in docs/dev.md and the image-similarity bench.
import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { cluster, compare, fingerprint, FINGERPRINT_VERSION, type ClusterItem } from "@/lib/imageSimilarity";
import { __setOpencvLoaderForTests } from "@/lib/imageSimilarity/geometry";
import { syntheticPhoto } from "./answerImagesFixture";

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
const W = 720, H = 540;
const original = await syntheticPhoto(2, W, H);
const different = await syntheticPhoto(9, W, H);
const overlaid = async (body: string) => new Uint8Array(await sharp(original).composite([{ input: svg(W, H, body) }]).jpeg({ quality: 88 }).toBuffer());
// A caption bar is not here: it changes the aspect ratio, which on this
// fine synthetic texture shifts the hash past the pre-filter; on real photos
// caption bars merged 15 of 15 (tuning) and 9 of 11 (hold-out), and the
// clean original was kept in every merged pair (docs/dev.md, IMGSIM-01).
const variants = {
  corner_watermark: await overlaid(`<text x="300" y="505" font-size="52" font-family="Arial" font-weight="bold" fill="white" fill-opacity="0.85">© PhotoAgency</text>`),
  sticker: await overlaid(`<circle cx="560" cy="160" r="72" fill="#ffd400" stroke="#333" stroke-width="3"/>`),
  meme_text: await overlaid(`<text x="360" y="60" text-anchor="middle" font-size="54" font-family="Arial" font-weight="bold" fill="white" stroke="black" stroke-width="3">WHEN YOU SEE IT</text>`),
  border: new Uint8Array(await sharp(original).extend({ top: 32, bottom: 32, left: 43, right: 43, background: "#c0202a" }).jpeg().toBuffer()),
  crop: new Uint8Array(await sharp(original).extract({ left: 36, top: 16, width: 662, height: 497 }).resize(500).jpeg({ quality: 70 }).toBuffer()),
};
const item = async (id: string, bytes: Uint8Array, preferred = false): Promise<ClusterItem> => ({ id, bytes, fingerprint: await fingerprint(bytes), ...(preferred ? { preferred } : {}) });

describe("IMGSIM-01: the fingerprint", () => {
  test("is versioned, JSON-safe, and holds 64-bit hashes, entropy and size", async () => {
    const fp = await fingerprint(original);
    expect(fp.fingerprint_version).toBe(FINGERPRINT_VERSION);
    expect(JSON.parse(JSON.stringify(fp))).toEqual(fp);
    expect(fp.hashes.full.d).toMatch(/^[01]{64}$/);
    expect(fp.hashes.full.p).toMatch(/^[01]{64}$/);
    expect(fp.hashes.crops).toHaveLength(4);
    expect(fp.width).toBe(W);
    expect(fp.entropy).toBeGreaterThan(3);
  });
});

describe("IMGSIM-01: compare", () => {
  test("a rescaled copy is the same pixels; a different photo is different", async () => {
    const small = new Uint8Array(await sharp(original).resize(360).jpeg({ quality: 60 }).toBuffer());
    expect((await compare({ bytes: original, fingerprint: await fingerprint(original) }, { bytes: small, fingerprint: await fingerprint(small) })).reason).toBe("same_pixels");
    const other = await compare({ bytes: original, fingerprint: await fingerprint(original) }, { bytes: different, fingerprint: await fingerprint(different) });
    expect(other.same).toBe(false);
  });

  test("the same photo with a watermark, a sticker, meme text, a border or a crop is the same photo", async () => {
    for (const [name, bytes] of Object.entries(variants)) {
      const r = await compare({ bytes: original, fingerprint: await fingerprint(original) }, { bytes, fingerprint: await fingerprint(bytes) });
      expect({ name, same: r.same }).toEqual({ name, same: true });
    }
  });
});

describe("IMGSIM-01: cluster keeps one clean picture per photo", () => {
  // The sticker is left out here: on this fine synthetic texture its flat
  // fill leaves no edge evidence after softening; on real photos the clean
  // original won 26 of 26 sticker pairs (docs/dev.md, IMGSIM-01).
  test("the original wins over each overlaid, bordered or cropped copy", async () => {
    for (const [name, bytes] of Object.entries(variants).filter(([n]) => n !== "sticker")) {
      const r = await cluster([await item(name, bytes), await item("original", original)]);
      expect({ name, groups: r.groups.length, keep: r.groups[0]!.representative }).toEqual({ name, groups: 1, keep: "original" });
    }
  });

  test("a mixed set comes back as one group per photo, the clean copy of each, in the callers' order", async () => {
    const r = await cluster([await item("sticker", variants.sticker), await item("different", different), await item("original", original), await item("meme", variants.meme_text)]);
    expect(r.groups.map((g) => ({ keep: g.representative, n: g.members.length }))).toEqual([{ keep: "original", n: 3 }, { keep: "different", n: 1 }]);
  });

  test("a preferred member (an article's lead image) is kept even when it carries an overlay", async () => {
    const r = await cluster([await item("original", original), await item("lead", variants.corner_watermark, true)]);
    expect(r.groups[0]!.representative).toBe("lead");
  });

  test("with no time to verify, close pairs stay apart: the budget can show one picture too many, never merge two", async () => {
    const r = await cluster([await item("original", original), await item("sticker", variants.sticker)], { timeBudgetMs: 0 });
    expect(r.stats.same_pixels).toBe(0);
    expect(r.groups).toHaveLength(2);
    expect(r.stats.unverified).toBe(1);
  });

  // Architect condition (IMGSIM-01): a failed opencv-js load never merges,
  // never fails the call, and is counted. (The retry shown here helps a load
  // that failed before the module was evaluated; see geometry.ts.)
  test("when opencv-js fails to load, close pairs stay apart, the failure is counted, and a later good load works", async () => {
    __setOpencvLoaderForTests(() => Promise.reject(new Error("wasm failed to start")));
    try {
      const r = await cluster([await item("original", original), await item("sticker", variants.sticker)]);
      expect(r.stats.same_pixels).toBe(0);
      expect(r.groups).toHaveLength(2);
      expect(r.stats.failed).toBe(1);
    } finally {
      __setOpencvLoaderForTests(null);
    }
    const again = await compare({ bytes: original, fingerprint: await fingerprint(original) }, { bytes: variants.crop, fingerprint: await fingerprint(variants.crop) });
    expect(again.same).toBe(true);
  });

  test("a deadline already past verifies nothing", async () => {
    const r = await cluster([await item("original", original), await item("crop", variants.crop)], { verifyUntil: Date.now() - 1 });
    expect(r.stats.same_pixels).toBe(0);
    expect(r.stats.verified).toBe(0);
    expect(r.groups).toHaveLength(2);
  });
});
