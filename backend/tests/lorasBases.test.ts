// The base table (lib/loras/baseFamilies.ts) and the LoRA browser's use of it: the Civitai `LTXV2` generic label, excluded bases, and a supported flag that changes the filter.
// Responses are stubbed fetches shaped like the live Civitai answers measured 2026-11-03.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetSourceForTests, __setSourceTestHooks, browseHits, ltxBaseFromText, type BrowseParams } from "@/lib/loras/source";
import { BASE_UNSTATED_LINE, startLoraInstall } from "@/lib/loras/install";
import { setInstalledBasesProvider, supportedBaseIds } from "@/lib/loras/baseFamilies";
import { setHouseholdSettingValue } from "@/lib/settings";
import { household } from "./fixtures/adultLock";

setDefaultTimeout(30_000);

const model = (id: number, name: string, baseModel: string, over: Record<string, unknown> = {}) => ({
  id, name, type: "LORA", nsfw: false, nsfwLevel: 1, allowCommercialUse: ["Sell"], tags: [{ name: "style" }], stats: { downloadCount: 10, rating: 4 }, creator: { username: "quill" }, description: "",
  modelVersions: [{ id: id * 10, name: "v1", baseModel, publishedAt: "2026-10-01T00:00:00.000Z", trainedWords: [], downloadUrl: `https://civitai.com/api/download/models/${id * 10}`,
    files: [{ id, name: `${id}.safetensors`, type: "Model", sizeKB: 1024, hashes: { SHA256: String(id % 10).repeat(64) }, primary: true }], images: [{ url: `https://image.civitai.com/x/${id}.jpeg`, nsfwLevel: 1, type: "image" }] }], ...over,
});
const ITEMS = [
  model(1, "Paper Boat", "LTXV 2.5"),
  model(2, "(LTX-2.3 Lora) - Pose Helper (I2V)", "LTXV2"),
  model(3, "Mystery Look", "LTXV2"),
  model(4, "Krea Thing ltx", "Krea 2"),
  model(5, "Old Video Look", "LTXV"),
  model(6, "Both Versions", "LTXV2", { description: "Made for LTX 2.3 and LTX 2.5" }),
  model(7, "Clay", "LTXV2", { description: "<p>Trained on LTX-2.5</p>" }),
];
let urls: string[];
const params = (over: Partial<BrowseParams> = {}): BrowseParams => ({ source: "civitai", q: "ltx", kind: "any", base: "default", sort: "downloads", cursor: null, nsfw: false, ...over });

beforeEach(() => {
  resetDb(); __resetSourceForTests(); setInstalledBasesProvider(null); urls = [];
  setHouseholdSettingValue("generation.styles.civitai", true);
  __setSourceTestHooks({ gapMs: 0, fetch: (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    urls.push(url.href);
    const one = /^\/api\/v1\/models\/(\d+)$/.exec(url.pathname);
    if (one) return Response.json(ITEMS.find((m) => String(m.id) === one[1]));
    return Response.json({ items: ITEMS, metadata: {} });
  }) as typeof fetch });
});
afterEach(() => { __resetSourceForTests(); setInstalledBasesProvider(null); setHouseholdSettingValue("generation.styles.civitai", false); });

const baseModels = (): string[] => new URL(urls[urls.length - 1]!).searchParams.getAll("baseModels");

describe("LTXV2 and the base check", () => {
  test("the default search asks only for supported LTXV 2.5 and LTXV2", async () => {
    await browseHits(params());
    expect(baseModels()).toEqual(["LTXV 2.5", "LTXV2"]);
  });

  test("an ltx-2.x search asks for its own version and the generic label", async () => {
    await browseHits(params({ base: "ltx-2.5" }));
    expect(baseModels()).toEqual(["LTXV 2.5", "LTXV2"]);
  });

  test("LTXV2 with a version in its name maps to that version; none stated is flagged; two stated is flagged, never guessed", async () => {
    const { hits } = await browseHits(params({ base: "all" }));
    const by = (title: string) => hits.find((h) => h.title === title)!;
    expect(by("Clay")).toMatchObject({ base_model: "ltx-2.5", base_unstated: false });
    expect(by("Mystery Look")).toBeUndefined();
    expect(by("Both Versions")).toBeUndefined();
    expect(by("Paper Boat")).toMatchObject({ base_model: "ltx-2.5", base_unstated: false });
    expect(ltxBaseFromText("(LTX-2.3 Lora) - Pose Helper (I2V)")).toBe("ltx-2.3");
    expect(by("(LTX-2.3 Lora) - Pose Helper (I2V)")).toMatchObject({ base_model: "ltx-2.3", base_unstated: false });
  });

  test("Krea 2 and the old LTXV are excluded by default, even when the source returns them", async () => {
    const { hits } = await browseHits(params());
    expect(hits.map((h) => h.title)).not.toContain("Krea Thing ltx");
    expect(hits.map((h) => h.title)).not.toContain("Old Video Look");
    expect(ltxBaseFromText("LTXV")).toBe("unknown");
    expect(ltxBaseFromText("LTXV2")).toBe("unknown");
  });

  test("an unstated hit is not installable and says so; an admin's pick of the version is the only way in", async () => {
    const { row } = await household();
    const admin = row("Sage");
    const actor = { admin, sessionKey: "s1", proof: { token: null, sessionKey: null } };
    const body = { source: "civitai" as const, remote_id: "3", audience: "adult-only" as const, licence_confirmed: true };
    const refused = await startLoraInstall(actor, body);
    expect(refused).toMatchObject({ ok: false, status: 422, code: "base_unstated", error: BASE_UNSTATED_LINE });
    expect(BASE_UNSTATED_LINE).toBe("This style does not say which LTX 2 version it is for. Ask its maker, or pick the version yourself.");
    const noWan = await startLoraInstall(actor, { ...body, base_model: "wan2.2-ti2v-5b" });
    expect(noWan).toMatchObject({ ok: false, code: "base_unstated" });
  });
});

describe("the supported flag", () => {
  test("flipping a base off changes which labels are asked for and which hits are installable", async () => {
    expect(supportedBaseIds()).toEqual(["ltx-2.5"]);
    setInstalledBasesProvider(() => new Set(["ltx-2.5"]));
    expect(supportedBaseIds()).toEqual(["ltx-2.5"]);
    const { hits } = await browseHits(params());
    expect(baseModels()).toEqual(["LTXV 2.5", "LTXV2"]);
    expect(hits.map((h) => h.base_model)).not.toContain("ltx-2.3");
    const { row } = await household();
    const actor = { admin: row("Sage"), sessionKey: "s1", proof: { token: null, sessionKey: null } };
    const r = await startLoraInstall(actor, { source: "civitai", remote_id: "2", audience: "adult-only", licence_confirmed: true });
    expect(r).toMatchObject({ ok: false, code: "not_ltx" });
    setInstalledBasesProvider(() => new Set());
    urls.length = 0;
    expect((await browseHits(params())).hits).toEqual([]);
    expect(urls).toEqual([]);
  });
});
