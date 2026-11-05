// STYLES-01a (docs/design/styles-one-system-2026-11-05.md): the style browser knows the picture bases through the same base table.
// Civitai labels `Flux.2 Klein 4B`, `ZImageTurbo` and `Ernie` were confirmed live against the public API on 2026-11-05;
// `Flux.2 Klein 9B`, `Flux.2 D` and `ZImageBase` are different bases and name no row.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetSourceForTests, __setSourceTestHooks, browseHits, type BrowseParams } from "@/lib/loras/source";
import {
  baseFromText, basesNamedIn, civitaiLabel, civitaiLabelsFor, mediaOfBase, setInstalledBasesProvider, supportedBaseIds, supportedFamilyWords,
} from "@/lib/loras/baseFamilies";
import { NOT_LTX_LINE } from "@/lib/loras/install";
import { setHouseholdSettingValue } from "@/lib/settings";
import { household } from "./fixtures/adultLock";

setDefaultTimeout(30_000);

const PICTURE_LABELS = ["Flux.2 Klein 4B", "ZImageTurbo", "Ernie"];
const LTX_LABELS = ["LTXV 2.5", "LTXV 2.3", "LTXV2"];

const model = (id: number, name: string, baseModel: string) => ({
  id, name, type: "LORA", nsfw: false, nsfwLevel: 1, allowCommercialUse: ["Sell"], tags: [{ name: "style" }], stats: { downloadCount: 10, rating: 4 },
  creator: { username: "quill" }, description: "",
  modelVersions: [{
    id: id * 10, name: "v1", baseModel, publishedAt: "2026-10-01T00:00:00.000Z", trainedWords: [], downloadUrl: `https://civitai.com/api/download/models/${id * 10}`,
    files: [{ id, name: `${id}.safetensors`, type: "Model", sizeKB: 1024, hashes: { SHA256: String(id % 10).repeat(64) }, primary: true }],
    images: [{ url: `https://image.civitai.com/x/${id}.jpeg`, nsfwLevel: 1, type: "image" }],
  }],
});

const ITEMS = [
  model(1, "Clay Look", "Flux.2 Klein 4B"),
  model(2, "Watercolor", "ZImageTurbo"),
  model(3, "Pen Sketch", "Ernie"),
  model(4, "Klein Nine", "Flux.2 Klein 9B"),
  model(5, "Flux Dev Look", "Flux.2 D"),
  model(6, "Z Base Look", "ZImageBase"),
  model(7, "Paper Boat", "LTXV 2.5"),
];

let urls: string[];
const params = (over: Partial<BrowseParams> = {}): BrowseParams => ({
  source: "civitai", q: "style", kind: "any", media: "picture", base: "default", sort: "downloads", cursor: null, nsfw: false, ...over,
});
const labelsAsked = (): string[] => new URL(urls[urls.length - 1]!).searchParams.getAll("baseModels");

beforeEach(() => {
  resetDb();
  __resetSourceForTests();
  setInstalledBasesProvider(null);
  urls = [];
  setHouseholdSettingValue("generation.styles.civitai", true);
  __setSourceTestHooks({
    gapMs: 0,
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      urls.push(url.href);
      return Response.json({ items: ITEMS, metadata: {} });
    }) as typeof fetch,
  });
});
afterEach(() => {
  __resetSourceForTests();
  setInstalledBasesProvider(null);
  setHouseholdSettingValue("generation.styles.civitai", false);
});

describe("the base table answers for pictures", () => {
  test("each picture label resolves to its base, and the three neighbours resolve to nothing", () => {
    expect(civitaiLabel("Flux.2 Klein 4B")).toEqual({ kind: "base", id: "flux2-klein-4b" });
    expect(civitaiLabel("ZImageTurbo")).toEqual({ kind: "base", id: "z-image-turbo" });
    expect(civitaiLabel("Ernie")).toEqual({ kind: "base", id: "ernie-image-turbo" });
    for (const other of ["Flux.2 Klein 9B", "Flux.2 D", "ZImageBase"]) expect(civitaiLabel(other)).toEqual({ kind: "other" });
  });

  test("text patterns read each picture base from a name, and not the neighbours", () => {
    expect(baseFromText("Flux.2 Klein 4B clay look")).toBe("flux2-klein-4b");
    expect(baseFromText("flux2_klein-4b")).toBe("flux2-klein-4b");
    expect(baseFromText("Z-Image Turbo watercolor")).toBe("z-image-turbo");
    expect(baseFromText("zimage turbo")).toBe("z-image-turbo");
    expect(baseFromText("ERNIE pen sketch")).toBe("ernie-image-turbo");
    expect(baseFromText("Flux.2 Klein 9B")).toBe("unknown");
    expect(basesNamedIn("Made for LTX 2.5")).toEqual(["ltx-2.5"]);
  });

  test("the default picture search asks for exactly the three picture labels, the default video search for the LTX ones", () => {
    expect(civitaiLabelsFor("default", "picture")).toEqual(PICTURE_LABELS);
    expect(civitaiLabelsFor("default", "video")).toEqual(LTX_LABELS);
    expect(civitaiLabelsFor("default")).toEqual(LTX_LABELS);
    expect(civitaiLabelsFor("z-image-turbo", "picture")).toEqual(["ZImageTurbo"]);
  });

  test("bases know their media, and the supported lists do not mix", () => {
    expect(mediaOfBase("flux2-klein-4b")).toBe("picture");
    expect(mediaOfBase("ltx-2.3")).toBe("video");
    expect(mediaOfBase("nonsense")).toBeNull();
    expect(supportedBaseIds("picture")).toEqual(["flux2-klein-4b", "z-image-turbo", "ernie-image-turbo"]);
    expect(supportedBaseIds()).toEqual(["ltx-2.5", "ltx-2.3"]);
    expect(supportedFamilyWords("picture")).toBe("Flux or Z-Image or ERNIE");
  });

  test("the not-supported sentence names the media", () => {
    expect(NOT_LTX_LINE("Krea 2")).toContain("This household's videos use LTX");
    expect(NOT_LTX_LINE("Krea 2", "picture")).toContain("This household's pictures use Flux or Z-Image or ERNIE");
  });
});

describe("browsing for pictures", () => {
  test("a picture search asks Civitai for the picture labels only and keeps only picture bases", async () => {
    const { hits } = await browseHits(params());
    expect(labelsAsked()).toEqual(PICTURE_LABELS);
    expect(hits.map((h) => h.title).sort()).toEqual(["Clay Look", "Pen Sketch", "Watercolor"]);
    expect(hits.find((h) => h.title === "Clay Look")).toMatchObject({ base_model: "flux2-klein-4b", base_unstated: false });
    expect(hits.find((h) => h.title === "Pen Sketch")).toMatchObject({ base_model: "ernie-image-turbo" });
  });

  test("one picture base narrows the search to that base", async () => {
    const { hits } = await browseHits(params({ base: "z-image-turbo" }));
    expect(labelsAsked()).toEqual(["ZImageTurbo"]);
    expect(hits.map((h) => h.title)).toEqual(["Watercolor"]);
  });

  test("a video search is unchanged: LTX labels, no picture hit", async () => {
    const { hits } = await browseHits(params({ media: "video" }));
    expect(labelsAsked()).toEqual(LTX_LABELS);
    expect(hits.map((h) => h.title)).toEqual(["Paper Boat"]);
  });

  test("the media is optional on the params and means video", async () => {
    const { media: _drop, ...rest } = params();
    await browseHits(rest as BrowseParams);
    expect(labelsAsked()).toEqual(LTX_LABELS);
  });
});

describe("the browse route", () => {
  test("a picture search through the route lists picture hits with picture wording", async () => {
    const { owner } = await household();
    const res = await owner.request("/api/loras/browse", { method: "POST", body: { source: "civitai", media: "picture" } });
    expect(res.status).toBe(200);
    const body = await res.json() as { items: Array<{ title: string; line: string; reason: string | null }> };
    expect(body.items.map((i) => i.title).sort()).toEqual(["Clay Look", "Pen Sketch", "Watercolor"]);
    expect(body.items.find((i) => i.title === "Clay Look")!.line).toContain("Made for Flux");
  });

  test("a video base with media picture is refused (a failed schema check, 400) with a plain message, and nothing goes out", async () => {
    const { owner } = await household();
    const res = await owner.request("/api/loras/browse", { method: "POST", body: { source: "civitai", media: "picture", base: "ltx-2.5" } });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("That base is not available for picture.");
    expect(urls).toEqual([]);
  });

  test("a picture base with media video is refused too", async () => {
    const { owner } = await household();
    const res = await owner.request("/api/loras/browse", { method: "POST", body: { source: "civitai", media: "video", base: "flux2-klein-4b" } });
    expect(res.status).toBe(400);
  });
});
