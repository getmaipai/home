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
import { listLoraRecords } from "@/lib/loras/store";
import { __resetLoraSyncForTests } from "@/lib/loras/sync";
import { listIssues } from "@/lib/issues";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setVideosFetchForTests } from "@/lib/videos/stack";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
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

interface FakeInstall { all: Array<Record<string, unknown>>; bodies: Array<Record<string, unknown>>; state: "running" | "done" | "failed"; reason: string | null; classification: "all-ages" | "adult-only"; refuse: { status: number; code: string; error: string; existing_id?: string } | null }
let fake: FakeVideoStack;
let inst: FakeInstall;
function installFakeInstall(): void {
  inst = { all: [], bodies: [], state: "running", reason: null, classification: "adult-only", refuse: null };
  const inner = fake.handler;
  const handler = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (init?.method === "POST" && url.pathname === "/stack/v1/video/loras/install") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      inst.bodies.push(body); inst.all.push(body);
      if (inst.refuse) return json({ error: inst.refuse.error, code: inst.refuse.code, ...(inst.refuse.existing_id ? { existing_id: inst.refuse.existing_id } : {}) }, inst.refuse.status);
      return json({ job: `job-install-${inst.all.length}` }, 202);
    }
    const jobMatch = /^\/stack\/v1\/jobs\/job-install-(\d+)$/.exec(url.pathname);
    if (jobMatch) {
      const b = inst.all[Number(jobMatch[1]) - 1]!;
      const lora = { id: `lora-${sha("e").slice(0, 16)}`, name: String(b.name), sha256: sha("e"), bytes: 412 * 1024 * 1024, base_model: String(b.base_model), licence: "x", source_url: typeof b.source_url === "string" ? b.source_url : null, classification: inst.classification, strength_default: 1, trigger_words: [], added_at: "2026-11-02T00:00:00Z" };
      if (inst.state === "done") { fake.loras = [lora]; return json({ id: `job-install-${jobMatch[1]}`, state: "done", percent: 100, completedBytes: 1, totalBytes: 1, status: "Done", reason: null, result: { lora } }); }
      if (inst.state === "failed") return json({ id: `job-install-${jobMatch[1]}`, state: "failed", percent: 40, status: "failed", reason: inst.reason, result: { code: "hash_mismatch" } });
      return json({ id: `job-install-${jobMatch[1]}`, state: "running", percent: 40, completedBytes: 40, totalBytes: 100, status: "Downloading a style", reason: null, result: null });
    }
    return inner(input, init);
  }) as typeof fetch;
  __setVideosFetchForTests(handler);
}

const post = (c: TestClient, path: string, body: unknown, proof?: string) => c.request(path, { method: "POST", body, headers: proof ? unlockHeader(proof) : {} });
const text = async (res: Response) => (await res.text()) + JSON.stringify([...res.headers.entries()]);
const browse = (c: TestClient, body: Record<string, unknown> = {}, proof?: string) => post(c, "/api/loras/browse", { source: "civitai", ...body }, proof);

beforeEach(() => {
  resetDb(); __resetLoraSyncForTests(); __resetAdultLockForTests(); __resetThrottleForTests(); __resetSourceForTests();
  fake = installFakeVideoStack(); fake.loras = [];
  installSourceFetch(); installFakeInstall();
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
  const hit = (site: "huggingface" | "civitai", id: string, version: string | null, sha256: string | null): Hit => ({ site, remote_id: id, version_id: version, adult_check: classifyHuggingFace([]), title: id, creator: null, page_url: "", file_url: null, file_name: null, bytes: null, sha256, base_label: null, base_model: "ltx-2.5", base_unstated: false, kind: null, licence_id: null, licence_class: "unknown", commercial_use: "unknown", downloads: 0, rating: null, created_at: null, trigger_words: [], gated: false, preview_url: null, also_on: [] });
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
  test("non-admin adults, teens and children get 403 on every route; a signed-out caller 401", async () => {
    const { adult, teen, child } = await household();
    const calls: Array<[string, string, unknown?]> = [["POST", "/api/loras/browse", { source: "huggingface" }], ["GET", "/api/loras/browse/huggingface/quill%2Fpaperboat-lora"], ["GET", "/api/loras/browse/huggingface/quill%2Fpaperboat-lora/preview"],
      ["POST", "/api/loras/install", { source: "huggingface", remote_id: "quill/paperboat-lora", audience: "adult-only", licence_confirmed: true }], ["GET", "/api/loras/install"], ["GET", "/api/loras/sources"], ["PUT", "/api/loras/sources/civitai", { on: true }],
      ["POST", "/api/loras/sources/civitai-key", { key: KEY }], ["POST", "/api/loras/sources/civitai-key/remove", {}], ["POST", "/api/loras/sources/huggingface-token", { token: HF_TOKEN }]];
    for (const who of [adult.client, teen.client, child.client]) for (const [method, path, body] of calls) {
      const res = await who.request(path, { method, body });
      expect(res.status).toBe(403);
    }
    expect(up.urls).toEqual([]);
    expect(listLoraRecords()).toEqual([]);
    const { TestClient: TC } = await import("./client");
    expect((await new TC().request("/api/loras/sources")).status).toBe(401);
  });
});

describe("Civitai is off by default", () => {
  test("browse and install refuse, nothing goes out", async () => {
    const { owner } = await household();
    expect((await browse(owner)).status).toBe(403);
    expect((await post(owner, "/api/loras/install", { source: "civitai", remote_id: "1", audience: "adult-only", licence_confirmed: true })).status).toBe(403);
    expect(up.urls).toEqual([]);
    const both = await post(owner, "/api/loras/browse", { source: "both" });
    expect(both.status).toBe(200);
    expect(up.urls.every((u) => u.startsWith("https://huggingface.co/"))).toBe(true);
    expect(((await both.json()) as { notes: string[] }).notes.join(" ")).toContain("Civitai is off");
    expect(((await (await owner.get("/api/loras/sources")).json()) as { civitai: { on: boolean } }).civitai.on).toBe(false);
  });
});

describe("browse redaction while locked", () => {
  test("adult and unknown hits are one flag; no secret string anywhere; nsfw=false goes upstream", async () => {
    const { owner } = await household();
    setHouseholdSettingValue("generation.styles.civitai", true);
    const res = await browse(owner);
    const body = (await res.json()) as { items: Array<{ title: string }>; locked: boolean };
    expect(res.status).toBe(200);
    expect(body.items.map((i) => i.title)).toEqual([PLAIN_TITLE]);
    expect(body.locked).toBe(true);
    const all = JSON.stringify(body) + JSON.stringify([...res.headers.entries()]);
    for (const s of [ADULT_TITLE, UNKNOWN_TITLE, "Zebraquill", "Plumwren", sha("b"), sha("c"), "adult.safetensors", "-2-", "/2-0", "/3-"]) expect(all).not.toContain(s);
    expect(new URL(up.urls[0]!).searchParams.get("nsfw")).toBe("false");
    expect(Object.keys(body).sort()).toEqual(["items", "locked", "next_cursor", "notes"]);
  });
  test("a proof alone, or the switch alone, reveals nothing; both together do, and then a locked call after it still leaks nothing", async () => {
    const { owner } = await household();
    setHouseholdSettingValue("generation.styles.civitai", true);
    const proof = await unlock(owner, "correcthorse");
    for (const [p, adult] of [[undefined, true], [proof, false]] as const) {
      const r = await text(await browse(owner, { adult }, p));
      expect(r).not.toContain(ADULT_TITLE);
    }
    const shown = (await (await browse(owner, { adult: true }, proof)).json()) as { items: Array<{ title: string }>; locked: boolean };
    expect(shown.items.map((i) => i.title).sort()).toEqual([ADULT_TITLE, PLAIN_TITLE, UNKNOWN_TITLE].sort());
    expect(shown.locked).toBe(false);
    expect(up.urls.some((u) => new URL(u).searchParams.get("nsfw") === "true")).toBe(true);
    const again = await text(await browse(owner, {}));
    expect(again).not.toContain(ADULT_TITLE);
    expect(again).not.toContain(UNKNOWN_TITLE);
  });
  test("a stranger's proof (another person) reveals nothing", async () => {
    const { owner, adult } = await household();
    setHouseholdSettingValue("generation.styles.civitai", true);
    const theirs = await unlock(adult.client);
    expect(await text(await browse(owner, { adult: true }, theirs))).not.toContain(ADULT_TITLE);
  });
  test("detail and preview of a locked hit answer 404 like a missing one; an open hit's preview comes through the hub", async () => {
    const { owner } = await household();
    setHouseholdSettingValue("generation.styles.civitai", true);
    const locked = await owner.get("/api/loras/browse/civitai/2");
    const missing = await owner.get("/api/loras/browse/civitai/99");
    expect(locked.status).toBe(404);
    expect(await locked.text()).toBe(await missing.text());
    expect((await owner.get("/api/loras/browse/civitai/2/preview")).status).toBe(404);
    expect((await owner.get("/api/loras/browse/civitai/3")).status).toBe(404);
    const open = await owner.get("/api/loras/browse/civitai/1");
    expect(((await open.json()) as { title: string }).title).toBe(PLAIN_TITLE);
    const pic = await owner.get("/api/loras/browse/civitai/1/preview?version=10");
    expect(pic.status).toBe(200);
    expect(pic.headers.get("content-type")).toBe("image/jpeg");
    expect(up.urls.filter((u) => u.includes("/2-") || u.includes("/3-"))).toEqual([]);
    const proof = await unlock(owner, "correcthorse");
    expect((await owner.request("/api/loras/browse/civitai/2", { headers: unlockHeader(proof) })).status).toBe(200);
  });
  test("Hugging Face: the not-for-all-audiences tag locks it, the rest is unknown and locked, the installed filter keeps the tile honest", async () => {
    const { owner } = await household();
    const body = (await (await post(owner, "/api/loras/browse", { source: "huggingface" })).json()) as { items: unknown[]; locked: boolean };
    expect(body.items).toEqual([]);
    expect(body.locked).toBe(true);
    const proof = await unlock(owner, "correcthorse");
    const full = (await (await post(owner, "/api/loras/browse", { source: "huggingface", adult: true }, proof)).json()) as { items: Array<{ remote_id: string; adult_check: string }> };
    expect(full.items.map((i) => `${i.remote_id}:${i.adult_check}`).sort()).toEqual(["quill/hush-lora:adult", "quill/paperboat-lora:unknown"]);
  });
  test("filters: the installed filter, the cursor and the base filter; sort reaches the source", async () => {
    const { owner, row } = await household();
    setHouseholdSettingValue("generation.styles.civitai", true);
    putLora(row("Sage").id, { name: "Mine", source: { site: "civitai", url: null, remote_id: "1", version_id: "10", token_ref: null }, file: { sha256: sha("a"), bytes: 1, rank: 1, modules: [], format: "safetensors" } });
    const inst = (await (await browse(owner, { installed: "installed" })).json()) as { items: Array<{ title: string; reason: string }> };
    expect(inst.items.map((i) => i.title)).toEqual([PLAIN_TITLE]);
    expect(inst.items[0]!.reason).toBe("Already installed as Mine");
    expect(((await (await browse(owner, { installed: "not_installed" })).json()) as { items: unknown[] }).items).toEqual([]);
    const page = (await (await browse(owner, { sort: "newest", base: "ltx-2.5", cursor: null })).json()) as { next_cursor: string };
    expect(page.next_cursor).toBeTruthy();
    const q = new URL(up.urls[up.urls.length - 1]!).searchParams;
    expect(q.get("sort")).toBe("Newest"); expect(q.getAll("baseModels")).toEqual(["LTXV 2.5", "LTXV2"]); expect(q.get("types")).toBe("LORA");
    await browse(owner, { cursor: page.next_cursor });
    expect(new URL(up.urls[up.urls.length - 1]!).searchParams.get("cursor")).toBe("cur2");
  });
});

describe("the limiter", () => {
  test("a 429 stops the host for a while with no new requests; a cache hit costs nothing; the hourly budget holds", async () => {
    const { owner } = await household();
    let now = 1_000_000;
    __setSourceTestHooks({ now: () => now });
    await post(owner, "/api/loras/browse", { source: "huggingface" });
    const count = sourceRequestCount();
    await post(owner, "/api/loras/browse", { source: "huggingface" });
    expect(sourceRequestCount()).toBe(count);                       // 5 minute cache
    now += 6 * 60_000;
    up.status = 429;
    expect((await post(owner, "/api/loras/browse", { source: "huggingface" })).status).toBe(503);
    const after = sourceRequestCount();
    up.status = 200;
    expect((await post(owner, "/api/loras/browse", { source: "huggingface", q: "other" })).status).toBe(503);
    expect(sourceRequestCount()).toBe(after);                        // stopped: no request
    now += 61_000;
    expect((await post(owner, "/api/loras/browse", { source: "huggingface", q: "other" })).status).toBe(200);
    for (let i = 0; i < 70; i += 1) { now += 1; await post(owner, "/api/loras/browse", { source: "huggingface", q: `q${i}` }); }
    expect((await post(owner, "/api/loras/browse", { source: "huggingface", q: "last" })).status).toBe(429);
  });
});

describe("credentials", () => {
  test("saved write only: no response, status or job ever holds the secret; removable", async () => {
    const { owner } = await household();
    for (const [path, body] of [["/api/loras/sources/civitai-key", { key: KEY }], ["/api/loras/sources/huggingface-token", { token: HF_TOKEN }]] as const) {
      const res = await post(owner, path, body);
      const t = await text(res);
      expect(res.status).toBe(200);
      expect(t).not.toContain(KEY); expect(t).not.toContain(HF_TOKEN);
    }
    const status = await text(await owner.get("/api/loras/sources"));
    expect(status).not.toContain("zq81f0aa");
    expect(JSON.parse(status.slice(0, status.indexOf("[[")))).toEqual({ huggingface: { on: true, token_saved: true }, civitai: { on: false, key_saved: true } });
    expect(await text(await owner.get("/api/settings?scope=household"))).not.toContain("zq81f0aa");
    await post(owner, "/api/loras/sources/civitai-key/remove", {});
    await post(owner, "/api/loras/sources/huggingface-token/remove", {});
    expect(JSON.parse((await text(await owner.get("/api/loras/sources"))).split("[[")[0]!)).toEqual({ huggingface: { on: true, token_saved: false }, civitai: { on: false, key_saved: false } });
  });
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
  test("the licence step must be confirmed", async () => {
    const { owner } = await household();
    const res = await post(owner, "/api/loras/install", installBody({ licence_confirmed: false }));
    expect(res.status).toBe(422);
    expect(inst.bodies).toEqual([]);
    expect(up.urls).toEqual([]);
  });

  test("a Hugging Face install: job in the list as a style, record written admin-only with adult_check, token only in the Stack body", async () => {
    const { owner, row } = await household();
    await post(owner, "/api/loras/sources/huggingface-token", { token: HF_TOKEN });
    const res = await post(owner, "/api/loras/install", installBody());
    expect(res.status).toBe(202);
    const t = await text(res);
    expect(t).not.toContain(HF_TOKEN);
    expect(inst.bodies).toHaveLength(1);
    expect(inst.bodies[0]).toMatchObject({ source: "huggingface", url: "https://huggingface.co/quill/paperboat-lora/resolve/main/paperboat.safetensors", audience: "adult", licence_acknowledged: true, sha256_expected: sha("d"), token: HF_TOKEN, added_by: row("Sage").id });
    const list = await owner.get("/api/jobs");
    const listText = await text(list);
    expect(listText).toContain("Downloading a style");
    expect(listText).not.toContain("paperboat");
    expect(listText).not.toContain(HF_TOKEN);
    expect(await reconcileLoraInstalls()).toBe(0);
    expect(db.select().from(jobs).where(eq(jobs.kind, "lora_install")).get()!.state).toBe("running");
    inst.state = "done";
    await reconcileLoraInstalls();
    const records = listLoraRecords();
    expect(records).toHaveLength(1);
    const r = records[0]!;
    expect(r).toMatchObject({ name: "paperboat-lora", audience: "adult-only", availability: { who: "admins", people: [] }, base_model: "ltx-2.5", source: { site: "huggingface", remote_id: "quill/paperboat-lora", version_id: "paperboat.safetensors", token_ref: null }, provenance: { origin: "install" } });
    expect(r.adult_check).toMatchObject({ state: "unknown", basis: "none" });
    expect(JSON.stringify(r)).not.toContain(HF_TOKEN);
    expect(db.select().from(jobs).where(eq(jobs.kind, "lora_install")).get()!.state).toBe("done");
  });

  test("a Civitai install: trigger words cleaned, adult_check normal written, all-ages as the admin's click, key only in the body", async () => {
    const { owner, row } = await household();
    await put(owner, true);
    await post(owner, "/api/loras/sources/civitai-key", { key: KEY });
    const res = await post(owner, "/api/loras/install", installBody({ source: "civitai", remote_id: "1", version_id: "10", audience: "all-ages", base_model: undefined }));
    expect(res.status).toBe(202);
    expect(await text(res)).not.toContain(KEY);
    expect(inst.bodies[0]).toMatchObject({ source: "civitai", url: "https://civitai.com/api/download/models/10", audience: "all-ages", token: KEY, base_model: "ltx-2.5", trigger_words: ["paperboat", "watercolour"], sha256_expected: sha("a") });
    inst.state = "done"; inst.classification = "all-ages";
    await reconcileLoraInstalls();
    const r = listLoraRecords()[0]!;
    expect(r).toMatchObject({ name: PLAIN_TITLE, audience: "all-ages", audience_set_by: row("Sage").id, trigger_words: ["paperboat", "watercolour"], source: { site: "civitai", remote_id: "1", version_id: "10" } });
    expect(r.adult_check).toMatchObject({ state: "normal", basis: "source_levels", levels_seen: 1, adult_levels: 0, flag: false });
    expect(r.licence.acknowledged_by).toBe(row("Sage").id);
  });

  test("a source can only raise: the Stack calling the file adult keeps it adult-only even when the admin chose all-ages", async () => {
    const { owner } = await household();
    await put(owner, true);
    await post(owner, "/api/loras/install", installBody({ source: "civitai", remote_id: "1", audience: "all-ages", base_model: undefined }));
    inst.state = "done"; inst.classification = "adult-only";
    await reconcileLoraInstalls();
    expect(listLoraRecords()[0]!.audience).toBe("adult-only");
  });

  test("lowering: unknown needs an unlock, adult needs a fresh passcode ticket bound to the hit", async () => {
    const { owner } = await household();
    await put(owner, true);
    const unknown = installBody({ source: "civitai", remote_id: "3", audience: "all-ages", base_model: undefined });
    expect((await post(owner, "/api/loras/install", unknown)).status).toBe(403);
    const proof = await unlock(owner, "correcthorse");
    expect((await post(owner, "/api/loras/install", unknown, proof)).status).toBe(202);
    const adult = installBody({ source: "civitai", remote_id: "2", audience: "all-ages", base_model: undefined });
    inst.bodies.length = 0;
    expect((await post(owner, "/api/loras/install", adult, proof)).status).toBe(403);
    expect(inst.bodies).toHaveLength(0);
    const detail = (await (await owner.request("/api/loras/browse/civitai/2", { headers: unlockHeader(proof) })).json()) as { confirm_item: string };
    const wrong = await (await owner.post("/api/adult-lock/confirm", { secret: "correcthorse", action: "unmark", item: "other-item" })).json() as { ticket: string };
    expect((await post(owner, "/api/loras/install", { ...adult, confirm_ticket: wrong.ticket }, proof)).status).toBe(403);
    const good = await (await owner.post("/api/adult-lock/confirm", { secret: "correcthorse", action: "unmark", item: detail.confirm_item })).json() as { ticket: string };
    expect((await post(owner, "/api/loras/install", { ...adult, confirm_ticket: good.ticket }, proof)).status).toBe(202);
    expect((await post(owner, "/api/loras/install", { ...adult, confirm_ticket: good.ticket }, proof)).status).not.toBe(202); // single use
  });

  test("adult-only is always allowed, with no proof, and names nothing", async () => {
    const { owner } = await household();
    await put(owner, true);
    const res = await post(owner, "/api/loras/install", installBody({ source: "civitai", remote_id: "2", audience: "adult-only", base_model: undefined }));
    expect(res.status).toBe(202);
    expect(await text(res)).not.toContain("Zebraquill");
  });

  test("duplicates: same version, same hash, a changed file, and a locked record is not named", async () => {
    const { owner, row } = await household();
    await put(owner, true);
    const admin = row("Sage").id;
    putLora(admin, { name: "Clay look", source: { site: "civitai", url: null, remote_id: "1", version_id: "10", token_ref: null }, file: { sha256: sha("a"), bytes: 1, rank: 1, modules: [], format: "safetensors" } });
    const same = await post(owner, "/api/loras/install", installBody({ source: "civitai", remote_id: "1", audience: "all-ages", base_model: undefined }));
    expect(same.status).toBe(409);
    expect(await same.json()).toMatchObject({ code: "duplicate", error: "You already have this as Clay look." });
    expect(inst.bodies).toHaveLength(0);
  });
  test("duplicates by hash, a changed file, and a locked record", async () => {
    const { owner, row } = await household();
    await put(owner, true);
    const admin = row("Sage").id;
    putLora(admin, { name: "By hash", file: { sha256: sha("a"), bytes: 1, rank: 1, modules: [], format: "safetensors" } });
    const byHash = await post(owner, "/api/loras/install", installBody({ source: "civitai", remote_id: "1", audience: "adult-only", base_model: undefined }));
    expect(byHash.status).toBe(409);
    expect(await byHash.json()).toMatchObject({ code: "duplicate" });
    // changed file: same version id, different hash
    putLora(admin, { name: "Changed", source: { site: "civitai", url: null, remote_id: "3", version_id: "30", token_ref: null }, file: { sha256: sha("9"), bytes: 1, rank: 1, modules: [], format: "safetensors" }, audience: "adult-only", audience_set_by: null, audience_set_at: null });
    const proof = await unlock(owner, "correcthorse");
    const changed = await post(owner, "/api/loras/install", installBody({ source: "civitai", remote_id: "3", audience: "adult-only", base_model: undefined }), proof);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: "changed_file" });
    const sep = await post(owner, "/api/loras/install", installBody({ source: "civitai", remote_id: "3", audience: "adult-only", base_model: undefined, as_separate: true }), proof);
    expect(sep.status).toBe(202);
    // a locked record: no name, no id, without a proof
    putLora(admin, { name: ADULT_TITLE, source: { site: "civitai", url: null, remote_id: "2", version_id: "20", token_ref: null }, file: { sha256: sha("b"), bytes: 1, rank: 1, modules: [], format: "safetensors" }, audience: "adult-only", audience_set_by: null, audience_set_at: null });
    const locked = await post(owner, "/api/loras/install", installBody({ source: "civitai", remote_id: "2", audience: "adult-only", base_model: undefined }));
    expect(locked.status).toBe(409);
    const lt = await text(locked);
    expect(lt).toContain("You already have this style.");
    expect(lt).not.toContain(ADULT_TITLE); expect(lt).not.toContain("existing_id");
  });

  test("the Stack's own duplicate_lora answers the same", async () => {
    const { owner } = await household();
    inst.refuse = { status: 409, code: "duplicate_lora", error: "This style is already in the library; nothing was downloaded.", existing_id: "lora-nothere0000000" };
    const res = await post(owner, "/api/loras/install", installBody());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "duplicate_lora", error: "You already have this style." });
  });

  test("not LTX, gated without a token, too big, and no safetensors file each say why and start nothing", async () => {
    const { owner } = await household();
    const r = await post(owner, "/api/loras/install", installBody({ base_model: undefined, remote_id: "quill/hush-lora" }));
    expect(r.status).toBe(202);   // base from tags is LTX 2.5: this one is fine
    inst.bodies.length = 0;
    CIVITAI_ITEMS.push(civitaiModel(7, "Wannabe", {}, [1], { baseModel: "Wan Video 2.2 TI2V-5B" }));
    CIVITAI_ITEMS.push(civitaiModel(8, "Huge", {}, [1], { files: [{ id: 8, name: "h.safetensors", type: "Model", sizeKB: 5 * 1024 * 1024, hashes: { SHA256: sha("7") }, primary: true }] }));
    CIVITAI_ITEMS.push(civitaiModel(9, "Pickled", {}, [1], { files: [{ id: 9, name: "p.ckpt", type: "Model", sizeKB: 10, primary: true }] }));
    try {
      await put(owner, true);
      const wan = await post(owner, "/api/loras/install", installBody({ source: "civitai", remote_id: "7", base_model: undefined }));
      expect(wan.status).toBe(422);
      expect(await wan.json()).toMatchObject({ code: "not_ltx", error: expect.stringContaining("This household's videos use LTX") });
      expect(await (await post(owner, "/api/loras/install", installBody({ source: "civitai", remote_id: "8", base_model: undefined }))).json()).toMatchObject({ code: "too_large" });
      expect(await (await post(owner, "/api/loras/install", installBody({ source: "civitai", remote_id: "9", base_model: undefined }))).json()).toMatchObject({ code: "no_file" });
      expect(inst.bodies).toHaveLength(0);
    } finally { CIVITAI_ITEMS.length = 3; }
  });

  test("a failed job raises one Repairs item with Try again, plain cause, no name; Try again starts it anew", async () => {
    const { owner } = await household();
    await post(owner, "/api/loras/install", installBody({ remote_id: "quill/hush-lora" }));
    inst.state = "failed"; inst.reason = "hash_mismatch: The file does not match the fingerprint Hugging Face published for it, so it was not added. Try again.";
    await reconcileLoraInstalls();
    const items = listIssues().filter((i) => i.source === "styles");
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("A style did not download");
    expect(items[0]!.detail).toContain("does not match the fingerprint");
    expect(JSON.stringify(items)).not.toContain("hush");
    expect(items[0]!.fix?.label).toBe("Try again");
    inst.state = "running";
    const fixed = await owner.post(`/api/repairs/${items[0]!.id}/fix`, {});
    expect(fixed.status).toBe(200);
    expect(inst.bodies).toHaveLength(2);
    expect(listLoraRecords()).toEqual([]);
  });

  test("the Stack refusing (install busy) is a plain 503 and creates no job", async () => {
    const { owner } = await household();
    inst.refuse = { status: 503, code: "install_busy", error: "Another style is downloading. Wait for it to finish, then try again." };
    const res = await post(owner, "/api/loras/install", installBody());
    expect(res.status).toBe(503);
    expect(db.select().from(jobs).where(eq(jobs.kind, "lora_install")).all()).toEqual([]);
  });

  test("a pasted Hugging Face link works; another host is refused", async () => {
    const { owner } = await household();
    const ok = await post(owner, "/api/loras/install", { source: "huggingface", url: "https://huggingface.co/quill/paperboat-lora/blob/main/paperboat.safetensors", audience: "adult-only", licence_confirmed: true, base_model: "ltx-2.5" });
    expect(ok.status).toBe(202);
    const bad = await post(owner, "/api/loras/install", { source: "huggingface", url: "https://evil.example.com/quill/paperboat-lora", audience: "adult-only", licence_confirmed: true });
    expect(bad.status).toBe(404);
  });
});
