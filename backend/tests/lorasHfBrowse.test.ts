// The Hugging Face side of the browser: a search with no words asks for the household's family by name, and a hit with a picture file gets a preview the hub can fetch (one redirect hop to HF's own storage).
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetSourceForTests, __setSourceTestHooks, browseHits, hitKey, plainSummary, previewOf, type BrowseParams } from "@/lib/loras/source";
import { setInstalledBasesProvider } from "@/lib/loras/baseFamilies";

setDefaultTimeout(30_000);
const params = (over: Partial<BrowseParams> = {}): BrowseParams => ({ source: "huggingface", q: "", kind: "any", base: "default", sort: "downloads", cursor: null, nsfw: false, ...over });
const repo = {
  id: "acme/LTX-2.5-Paper-LoRA", tags: ["lora", "base_model:Lightricks/LTX-2.5", "license:apache-2.0"], downloads: 5, likes: 1, createdAt: "2026-10-01T00:00:00.000Z",
  siblings: [{ rfilename: "paper.safetensors", size: 1024 }, { rfilename: "assets/example_one.gif" }, { rfilename: "README.md" }],
};
let urls: string[];

beforeEach(() => {
  resetDb(); __resetSourceForTests(); setInstalledBasesProvider(null); urls = [];
  __setSourceTestHooks({ gapMs: 0, fetch: (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    urls.push(url.href);
    if (url.pathname.startsWith("/api/models")) return Response.json([repo]);
    if (url.hostname === "huggingface.co") return new Response(null, { status: 302, headers: { location: "https://cdn-lfs.hf.co/blob/abc" } });
    if (url.hostname === "cdn-lfs.hf.co") return new Response(new Uint8Array([71, 73, 70]), { headers: { "content-type": "image/gif" } });
    return new Response("no", { status: 404 });
  }) as typeof fetch });
});
afterEach(() => { __resetSourceForTests(); setInstalledBasesProvider(null); });

describe("Hugging Face browse", () => {
  test("no typed words and the household's own bases: the request searches the family name", async () => {
    const out = await browseHits(params());
    expect(new URL(urls[0]!).searchParams.get("search")).toBe("ltx");
    expect(out.hits.map((h) => h.remote_id)).toEqual(["acme/LTX-2.5-Paper-LoRA"]);
  });
  test("typed words are searched as typed", async () => {
    await browseHits(params({ q: "clay" }));
    expect(new URL(urls[0]!).searchParams.get("search")).toBe("clay");
  });
  test("a picture file in the repo becomes the preview, fetched through one hop to HF's own storage", async () => {
    const out = await browseHits(params());
    const hit = out.hits[0]!;
    expect(hit.preview_url).toBe("https://huggingface.co/acme/LTX-2.5-Paper-LoRA/resolve/main/assets/example_one.gif");
    const picture = await previewOf(hitKey(hit));
    expect(picture?.type).toBe("image/gif");
    expect(picture?.bytes.length).toBe(3);
  });
});

describe("Civitai video styles", () => {
  test("a style whose examples are all clips gets a still of the first clip as its preview", async () => {
    const { __setSourceTestHooks: setHooks } = await import("@/lib/loras/source");
    const { setHouseholdSettingValue } = await import("@/lib/settings");
    setHouseholdSettingValue("generation.styles.civitai", true);
    const clip = "https://image.civitai.com/key/uuid/original=true/1.mp4";
    setHooks({ gapMs: 0, fetch: (async () => Response.json({ items: [{
      id: 9, name: "Clay [LTX-2]", type: "LORA", nsfw: false, nsfwLevel: 1, allowCommercialUse: ["Sell"], tags: [], stats: {}, creator: { username: "quill" },
      modelVersions: [{ id: 90, name: "v1", baseModel: "LTXV 2.5", publishedAt: "2026-10-01T00:00:00.000Z", trainedWords: [], files: [{ id: 1, name: "a.safetensors", type: "Model", sizeKB: 1, hashes: { SHA256: "a".repeat(64) }, primary: true }], images: [{ url: clip, nsfwLevel: 1, type: "video" }] }],
    }], metadata: {} })) as unknown as typeof fetch });
    const out = await browseHits(params({ source: "civitai", q: "clay" }));
    expect(out.hits[0]!.preview_url).toBe("https://image.civitai.com/key/uuid/anim=false,width=450/1.mp4");
    setHouseholdSettingValue("generation.styles.civitai", false);
  });
});

describe("Civitai links and picture search", () => {
  const model = (over: Record<string, unknown>, images: unknown[], label = "LTXV 2.5") => ({
    id: 11, name: "Breast Expansion LTX 2 i2v", type: "LORA", nsfw: false, nsfwLevel: 1, allowCommercialUse: ["Sell"], tags: [], stats: {}, creator: { username: "quill" }, ...over,
    modelVersions: [{ id: Number(over.id ?? 11) * 10, name: "v1", baseModel: label, publishedAt: "2026-10-01T00:00:00.000Z", trainedWords: [], files: [{ id: 1, name: "a.safetensors", type: "Model", sizeKB: 1, hashes: { SHA256: String(over.id ?? 11).padEnd(64, "a") }, primary: true }], images }],
  });
  const clip = { url: "https://image.civitai.com/key/uuid/original=true/1.mp4", nsfwLevel: 1, type: "video" };
  test("an adult model's page link is on civitai.red, an all-ages one stays on civitai.com", async () => {
    const { __setSourceTestHooks: setHooks } = await import("@/lib/loras/source");
    const { setHouseholdSettingValue } = await import("@/lib/settings");
    setHouseholdSettingValue("generation.styles.civitai", true);
    setHooks({ gapMs: 0, fetch: (async () => Response.json({ items: [model({ nsfw: true, nsfwLevel: 60 }, [{ ...clip, nsfwLevel: 32 }]), model({ id: 12 }, [clip])], metadata: {} })) as unknown as typeof fetch });
    const out = await browseHits(params({ source: "civitai", q: "x", nsfw: true }));
    const adult = out.hits.find((h) => h.remote_id === "11")!;
    expect(adult.page_url).toBe("https://civitai.red/models/11/breast-expansion-ltx-2-i2v?modelVersionId=110");
    expect(out.hits.find((h) => h.remote_id === "12")!.page_url).toBe("https://civitai.com/models/12?modelVersionId=120");
    setHouseholdSettingValue("generation.styles.civitai", false);
  });
  test("a picture search drops a style whose examples are all clips", async () => {
    const { __setSourceTestHooks: setHooks } = await import("@/lib/loras/source");
    const { setHouseholdSettingValue } = await import("@/lib/settings");
    setHouseholdSettingValue("generation.styles.civitai", true);
    const still = { url: "https://image.civitai.com/key/uuid/original=true/1.jpeg", nsfwLevel: 1, type: "image" };
    setHooks({ gapMs: 0, fetch: (async () => Response.json({ items: [model({ id: 21 }, [clip], "ZImageTurbo"), model({ id: 22 }, [still], "ZImageTurbo")], metadata: {} })) as unknown as typeof fetch });
    const out = await browseHits({ ...params({ source: "civitai", q: "x" }), media: "picture" });
    expect(out.hits.map((h) => h.remote_id)).toEqual(["22"]);
    setHouseholdSettingValue("generation.styles.civitai", false);
  });
});

describe("plainSummary", () => {
  test("the maker's title is dropped from the front, so the first line says what the style does", () => {
    const html = "<p>Kiss the Viewer</p><p>A video + audio LoRA for LTX-2 that creates an intimate kiss-the-camera effect.</p>";
    expect(plainSummary([html], 200, "Kiss the Viewer")).toBe("A video + audio LoRA for LTX-2 that creates an intimate kiss-the-camera effect.");
  });
  test("keeps the first sentences of the maker's words, without markup, links or settings lists", () => {
    const html = "<p>Turns any clip into a soft <b>claymation</b> look with chunky fingerprints and warm light. Great for pets &amp; toys.</p><p>Trigger word: claymo</p><p>Support me on Patreon https://patreon.com/x</p>";
    expect(plainSummary([html])).toBe("Turns any clip into a soft claymation look with chunky fingerprints and warm light. Great for pets & toys.");
  });
  test("cuts a long description at a sentence end and returns null when nothing readable is left", () => {
    const long = `${"A watercolour look with visible paper grain. ".repeat(10)}`;
    const out = plainSummary([long])!;
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".")).toBe(true);
    expect(plainSummary(["<p>v1</p>", null, "Trigger: x"])).toBeNull();
  });
});
