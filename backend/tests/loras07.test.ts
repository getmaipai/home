// VIDEO-LORA-07 (docs/dev/lora-sources.md, design 11 tests 13 and 14): the style sources and the install routes. Source responses are fixtures written from the Civitai
// reference (developer.civitai.com/site/reference/models) and the Hugging Face Hub API shape; the Civitai image `nsfwLevel` values are from memory and unconfirmed against a live response.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { classifyCivitai, classifyHuggingFace, cleanTriggerWords } from "@/lib/loras/adultCheck";
import { __resetSourceForTests, __setSourceTestHooks, dedupeHits, sourceRequestCount, type Hit } from "@/lib/loras/source";
import { reconcileLoraInstalls } from "@/lib/loras/install";
import { listLoraRecords } from "@/lib/loras/stackLibrary";
import { __resetLoraSyncForTests } from "@/lib/loras/sync";
import { listIssues } from "@/lib/issues";
import { setHouseholdSettingValue } from "@/lib/settings";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { installFakeLoraJobs, type FakeLoraInstall } from "./fixtures/loraInstallFake";
import { household, PASSCODE, unlock, unlockHeader } from "./fixtures/adultLock";
import { putLora } from "./fixtures/lora";
import type { TestClient } from "./client";

setDefaultTimeout(30_000);

const ADULT_TITLE = "Zebraquill Cabaret Lace";
const UNKNOWN_TITLE = "Plumwren Hush";
const PLAIN_TITLE = "Paper Boat Watercolour";
const KEY = ["civ", "key", "zq81f0aa11bb22cc"].join("-");
const HF_TOKEN = ["hf", "zq81f0aa11bb22cc33dd"].join("_");
const sha = (c: string) => c.repeat(64);

const civitaiModel = (id: number, title: string, over: Record<string, unknown> = {}, imageLevels: unknown[] = [1], versionOver: Record<string, unknown> = {}) => ({
  id, name: title, type: "LORA", nsfw: false, nsfwLevel: 1, allowCommercialUse: ["Image", "RentCivit", "Sell"], tags: [{ name: "style" }], stats: { downloadCount: 8300, rating: 4.8 }, creator: { username: "quill" },
  modelVersions: [{
    id: id * 10, name: "v1", baseModel: "LTXV 2.5", publishedAt: "2026-10-01T00:00:00.000Z", trainedWords: ["<lora:paperboat:0.8>, paperboat, paperboat\nwatercolour"],
    downloadUrl: `https://civitai.com/api/download/models/${id * 10}`, files: [{ id: id, name: `${title}.safetensors`, type: "Model", sizeKB: 412 * 1024, hashes: { SHA256: sha("A") }, primary: true }],
    images: imageLevels.map((nsfwLevel, i) => ({ url: `https://image.civitai.com/x/${id}-${i}.jpeg`, nsfwLevel, type: "image" })), ...versionOver,
  }], ...over,
});
const CIVITAI_ITEMS = [
  civitaiModel(1, PLAIN_TITLE, {}, [1], { files: [{ id: 1, name: "plain.safetensors", type: "Model", sizeKB: 412 * 1024, hashes: { SHA256: sha("a") }, primary: true }] }),
  civitaiModel(2, ADULT_TITLE, { nsfw: true }, [8], { files: [{ id: 2, name: "adult.safetensors", type: "Model", sizeKB: 100 * 1024, hashes: { SHA256: sha("b") }, primary: true }] }),
  civitaiModel(3, UNKNOWN_TITLE, {}, [], { files: [{ id: 3, name: "unknown.safetensors", type: "Model", sizeKB: 100 * 1024, hashes: { SHA256: sha("c") }, primary: true }] }),
];
const hfList = [{ id: "quill/paperboat-lora", tags: ["lora", "base_model:Lightricks/LTX-2.5"], downloads: 500, likes: 9, createdAt: "2026-10-02T00:00:00Z" }, { id: "quill/hush-lora", tags: ["lora", "not-for-all-audiences", "base_model:Lightricks/LTX-2.5"], downloads: 900, likes: 3, createdAt: "2026-10-03T00:00:00Z" }];
const hfDetail = (id: string) => ({ ...hfList.find((h) => h.id === id)!, cardData: { license: "apache-2.0" }, siblings: [{ rfilename: "README.md", size: 10 }, { rfilename: "paperboat.safetensors", size: 90_000_000, lfs: { sha256: sha("d"), size: 90_000_000 } }] });

interface Upstream { urls: string[]; headers: Array<Record<string, string>>; status: number }
let up: Upstream;
function installSourceFetch(): void {
  up = { urls: [], headers: [], status: 200 };
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: up.status, headers: { "content-type": "application/json" } });
  __setSourceTestHooks({ gapMs: 0, fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    up.urls.push(url.href); up.headers.push((init?.headers ?? {}) as Record<string, string>);
    if (up.status !== 200) return new Response("busy", { status: up.status });
    if (url.hostname === "image.civitai.com") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    if (url.hostname === "civitai.com" && url.pathname === "/api/v1/models") return json({ items: CIVITAI_ITEMS, metadata: { nextCursor: "cur2" } });
    const one = /^\/api\/v1\/models\/(\d+)$/.exec(url.pathname);
    if (url.hostname === "civitai.com" && one) { const m = CIVITAI_ITEMS.find((x) => String(x.id) === one[1]); return m ? json(m) : new Response("no", { status: 404 }); }
    if (url.hostname === "huggingface.co" && url.pathname === "/api/models") return json(hfList);
    const repo = /^\/api\/models\/(.+\/.+)$/.exec(url.pathname);
    if (url.hostname === "huggingface.co" && repo) return json(hfDetail(repo[1]!));
    return new Response("no", { status: 404 });
  }) as typeof fetch });
}

let fake: FakeVideoStack;
let inst: FakeLoraInstall;

const post = (c: TestClient, path: string, body: unknown, proof?: string) => c.request(path, { method: "POST", body, headers: proof ? unlockHeader(proof) : {} });
const text = async (res: Response) => (await res.text()) + JSON.stringify([...res.headers.entries()]);
const browse = (c: TestClient, body: Record<string, unknown> = {}, proof?: string) => post(c, "/api/loras/browse", { source: "civitai", ...body }, proof);

beforeEach(() => {
  resetDb(); __resetLoraSyncForTests(); __resetAdultLockForTests(); __resetThrottleForTests(); __resetSourceForTests();
  fake = installFakeVideoStack(); fake.loras = [];
  installSourceFetch(); inst = installFakeLoraJobs(fake, "/stack/v1/video/loras/install");
});
afterEach(() => { fake.restore(); __resetSourceForTests(); setHouseholdSettingValue("generation.styles.civitai", false); setHouseholdSettingValue("generation.styles.civitai_key", ""); setHouseholdSettingValue("voice.hf_token", ""); });

describe("adult_check classifier: every row of section 15.1", () => {
  const c = (o: Parameters<typeof classifyCivitai>[0]) => classifyCivitai(o).state;
  test("Civitai", () => {
    expect(c({ nsfw: true, imageLevels: [1] })).toBe("adult");                      // flag only
    expect(c({ nsfw: false, nsfwLevel: 4, imageLevels: [1] })).toBe("adult");       // model level only
    expect(c({ nsfw: false, nsfwLevel: 31, imageLevels: [1] })).toBe("adult");      // a bit mask
    expect(c({ nsfw: false, imageLevels: [1, 8] })).toBe("adult");                  // tag safe (flag false), one preview adult
    expect(c({ nsfw: false, nsfwLevel: 1, imageLevels: [1, 1] })).toBe("normal");   // all safe
    expect(c({ nsfw: false, imageLevels: [] })).toBe("unknown");                    // no previews
    expect(c({ nsfw: false, imageLevels: null })).toBe("unknown");
    expect(c({ nsfw: false, imageLevels: [1, 2] })).toBe("unknown");                // a level 2
    expect(c({ nsfw: false, imageLevels: [1, undefined] })).toBe("unknown");        // a missing level
    expect(c({ nsfw: false, imageLevels: [1, "1"] })).toBe("unknown");              // non-numeric
    expect(c({ nsfw: false, nsfwLevel: 2, imageLevels: [1] })).toBe("unknown");     // flag false against a model level of 2
    expect(c({ nsfw: undefined, imageLevels: [1] })).toBe("unknown");               // flag missing
    expect(c({ nsfw: false, imageLevels: [1], malformed: true })).toBe("unknown");
    expect(c({ nsfw: false, imageLevels: [1], regionFiltered: true })).toBe("unknown");
    const normal = classifyCivitai({ nsfw: false, imageLevels: [1, 1] });
    expect(normal).toMatchObject({ basis: "source_levels", levels_seen: 2, adult_levels: 0, flag: false });
  });
  test("Hugging Face: the tag raises, everything else is unknown, no word is read", () => {
    expect(classifyHuggingFace(["lora", "not-for-all-audiences"]).state).toBe("adult");
    expect(classifyHuggingFace(["lora"]).state).toBe("unknown");
    expect(classifyHuggingFace(["nsfw", "explicit", "adult"]).state).toBe("unknown");
    expect(classifyHuggingFace(undefined).state).toBe("unknown");
  });
  test("trigger words: lora syntax stripped, comma dumps split, deduped", () => {
    expect(cleanTriggerWords(["<lora:paperboat:0.8>, paperboat, Paperboat\nwatercolour", "  ", "<b>x</b>"])).toEqual(["paperboat", "watercolour", "x"]);
  });
});

describe("dedupe", () => {
  const hit = (site: "huggingface" | "civitai", id: string, version: string | null, sha256: string | null): Hit => ({ site, remote_id: id, version_id: version, adult_check: classifyHuggingFace([]), title: id, creator: null, page_url: "", file_url: null, file_name: null, bytes: null, sha256, base_label: null, base_model: "ltx-2.5", base_unstated: false, kind: null, licence_id: null, licence_class: "unknown", commercial_use: "unknown", downloads: 0, rating: null, created_at: null, trigger_words: [], gated: false, summary: null, preview_url: null, also_on: [] });
  test("same site, model and version collapse; the same sha256 across sources keeps Hugging Face and notes Civitai", () => {
    const out = dedupeHits([hit("civitai", "9", "90", sha("f")), hit("civitai", "9", "90", sha("f")), hit("huggingface", "a/b", "x.safetensors", sha("f")), hit("civitai", "10", "100", null)]);
    expect(out.map((h) => `${h.site}:${h.remote_id}`)).toEqual(["huggingface:a/b", "civitai:10"]);
    expect(out[0]!.also_on).toEqual(["civitai"]);
  });
  test("names are never identity", () => {
    const a = hit("civitai", "1", "10", null), b = hit("huggingface", "x/y", "f.safetensors", null);
    a.title = b.title = "Same";
    expect(dedupeHits([a, b])).toHaveLength(2);
  });
});

describe("who may use the routes", () => {
});

describe("an explicit Civitai opt-out", () => {
});

describe("the Made for choices", () => {
});

describe("browse redaction while locked", () => {
  test("a stranger's proof (another person) reveals nothing", async () => {
    const { owner, adult } = await household();
    setHouseholdSettingValue("generation.styles.civitai", true);
    const theirs = await unlock(adult.client);
    expect(await text(await browse(owner, { adult: true }, theirs))).not.toContain(ADULT_TITLE);
  });
});

describe("the limiter", () => {
});

describe("credentials", () => {
  test("each token goes only to its own host's requests, in a header, never a URL", async () => {
    const { owner } = await household();
    await put(owner, true);
    await post(owner, "/api/loras/sources/civitai-key", { key: KEY });
    await post(owner, "/api/loras/sources/huggingface-token", { token: HF_TOKEN });
    await browse(owner, { source: "both" });
    up.urls.forEach((u, i) => {
      expect(u).not.toContain("zq81f0aa");
      const auth = up.headers[i]!.authorization ?? "";
      expect(auth).toBe(new URL(u).hostname === "civitai.com" ? `Bearer ${KEY}` : `Bearer ${HF_TOKEN}`);
    });
  });
});
const put = (c: TestClient, on: boolean) => c.request("/api/loras/sources/civitai", { method: "PUT", body: { on } });

const installBody = (over: Record<string, unknown> = {}) => ({ source: "huggingface", remote_id: "quill/paperboat-lora", audience: "adult-only", licence_confirmed: true, base_model: "ltx-2.5", ...over });

describe("install", () => {











});
