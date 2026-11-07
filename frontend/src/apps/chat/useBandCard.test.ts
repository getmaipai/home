import { describe, expect, test } from "bun:test";
import { bandImageSrc, settleStale, withBandPictures } from "./useBandCard";

// MUSIC-LIKE-01: the pieces around the kit's Band card. The hub names files in hex; the card's buttons find the band from `provenance`.

const hex = (text: string) => Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("");

describe("bandImageSrc", () => {
  test("a hub picture reference becomes the file's thumbnail address", () => {
    expect(bandImageSrc(`hubimg-${hex("file-abc123")}`)).toBe("/api/files/file-abc123/thumb?w=640");
  });
  test("anything else is left alone", () => {
    expect(bandImageSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(bandImageSrc("hubimg-abc")).toBe("hubimg-abc");
  });
});

describe("withBandPictures", () => {
  const props = { name: "Clover Lane", portrait: { src: "hubimg-00000000", alt: "old" } };
  test("no record leaves the block as it came", () => {
    expect(withBandPictures(props, null)).toBe(props);
  });
  test("finished pictures are filled in and a missing one is removed until it is ready", () => {
    const next = withBandPictures(props, { id: "mband-abc123", logo_file_id: "file-logo1" });
    expect(next.portrait).toBeUndefined();
    expect(next.logo).toEqual({ src: `hubimg-${hex("file-logo1")}`, alt: "Logo of the band Clover Lane" });
    const both = withBandPictures(props, { id: "mband-abc123", portrait_file_id: "file-p1" });
    expect((both.portrait as { alt: string }).alt).toBe("old");
  });
});

describe("settleStale", () => {
  const band = { id: "mband-abc123", portrait_file_id: "file-old", logo_file_id: "file-logo" };
  test("a remade portrait that still has its old id is not ready, so the poll goes on", () => {
    const stale = { portrait_file_id: "file-old" as string | null };
    expect(settleStale(band, stale).portrait_file_id).toBeNull();
    expect(stale.portrait_file_id).toBe("file-old");
  });
  test("the first different id is the new picture and clears the mark", () => {
    const stale = { portrait_file_id: "file-old" as string | null };
    expect(settleStale({ ...band, portrait_file_id: "file-new" }, stale).portrait_file_id).toBe("file-new");
    expect(stale.portrait_file_id).toBeUndefined();
    expect(settleStale(band, stale).portrait_file_id).toBe("file-old");
  });
  test("with nothing marked the record is untouched", () => {
    expect(settleStale(band, {})).toEqual(band);
  });
});
