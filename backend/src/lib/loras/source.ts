// VIDEO-LORA-07 (docs/design/video-loras-2026-11-02.md sections 5.2, 15.1, 15.3, 15.4; docs/dev/lora-sources.md): ALL outbound traffic of the LoRA browser goes through this
// module, admin-initiated only. Hugging Face Hub API (`/api/models`) and, when the household turned it on, the documented Civitai REST API (`/api/v1/models`).
//
// Courtesy (THIRD-PARTY-SERVICES, "LoRA sources"): one request per 2 seconds per host, at most 60 browse requests an hour for the household, a 5 minute response cache,
// 24 hour preview cache, an exponential 1 to 30 minute stop on the first 429 or 5xx, honest client headers, a token only to its own host and never in a URL or a log.
// Nothing here runs on its own: every call is an admin's click.
//
// What this module never does: decide who may SEE a hit (routes/lorasSources.ts redacts, from the classified hit), read any word for content (adultCheck.ts), or write a record.
import { listLoraRecords, type Lora } from "@/lib/loras/store";
import { classifyCivitai, classifyHuggingFace, cleanTriggerWords, type AdultCheck } from "@/lib/loras/adultCheck";
import { getHouseholdSettingValue } from "@/lib/settings";
import { baseFromText, basesNamedIn, civitaiLabel, civitaiLabelsFor, mediaOfBase, searchWordFor, wantedBaseIds, type AnyBaseId, type BrowseBase, type Media } from "@/lib/loras/baseFamilies";

export type LoraSite = "huggingface" | "civitai";
export type SourceChoice = LoraSite | "both";
export type HitBase = AnyBaseId | "unknown";
export type LicenceClass = "open" | "non_commercial" | "custom" | "unknown";

export const CIVITAI_ENABLED_KEY = "generation.styles.civitai";
export const CIVITAI_KEY_KEY = "generation.styles.civitai_key";
export const HF_TOKEN_KEY = "voice.hf_token";

// The Civitai `baseModels` strings, the bases and their words live in ONE table: lib/loras/baseFamilies.ts.
export const MAX_RESULTS = 1000;
export const PAGE_SIZE = 20;
export const MAX_INSTALL_BYTES = 4 * 1024 ** 3;

export class SourceError extends Error {
  constructor(readonly code: "off" | "busy" | "budget" | "unreachable" | "bad_response" | "token_refused" | "not_found", message: string, readonly status: 400 | 403 | 404 | 429 | 502 | 503 = 502) {
    super(message);
    this.name = "SourceError";
  }
}

/** One result, as the hub holds it BEFORE any redaction. Never sent to a client as is (routes/lorasSources.ts builds the view). */
export interface Hit {
  site: LoraSite;
  remote_id: string;
  /** Civitai: the version id. Hugging Face: the chosen file's path (known after the detail call). */
  version_id: string | null;
  adult_check: AdultCheck;
  title: string;
  creator: string | null;
  page_url: string;
  /** What the Stack is told to fetch: a Hugging Face file link or `https://civitai.com/api/download/models/<version id>`; null until a file is known. */
  file_url: string | null;
  file_name: string | null;
  bytes: number | null;
  sha256: string | null;
  base_label: string | null;
  base_model: HitBase;
  /** A generic family label (Civitai `LTXV2`) whose text names no single version: not installable until an admin picks the version. */
  base_unstated: boolean;
  kind: "style" | "character" | null;
  licence_id: string | null;
  licence_class: LicenceClass;
  commercial_use: "yes" | "no" | "unknown";
  downloads: number;
  rating: number | null;
  created_at: string | null;
  trigger_words: string[];
  gated: boolean;
  /** What the style does, in the maker's own words (first sentences of the source's description, plain text); null when the source says nothing useful. */
  summary: string | null;
  /** The maker's own tags (Civitai), used for the line under a title when the maker wrote no description. */
  tags?: string[];
  /** Where the preview lives (never sent to a client). */
  preview_url: string | null;
  also_on: LoraSite[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
/** The first sentences of a source's description as plain words: no markup or links, no settings lists or begging, at most `max` characters, cut at a sentence end. Null when nothing readable is left. */
export function plainSummary(texts: readonly (string | null)[], max = 200, title?: string | null): string | null {
  for (const raw of texts) {
    if (!raw) continue;
    const text = title ? raw.split(title).join(" ") : raw;
    const lines = text.replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " ")
      .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? " ")))
      .split(/\n+/).map((l) => l.replace(/https?:\/\/\S+/g, "").replace(/[*_#>`~]+/g, "").replace(/\s+/g, " ").trim());
    const keep = lines.filter((l) => l.length >= 25 && !/^(trigger|activation|recommended|settings?|strength|weight|sampler|steps|cfg|clip|resolution|negative|prompt|tip|support|donat|buy me|patreon|ko-?fi|join|follow|discord|license|licence|changelog|version|v\d)/i.test(l) && !/(patreon|ko-fi|buymeacoffee|discord|donat)/i.test(l));
    if (!keep.length) continue;
    const joined = keep.join(" ");
    if (joined.length <= max) return joined;
    const cut = joined.slice(0, max);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    return end >= 60 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
  }
  return null;
}

export const hitKey = (h: Pick<Hit, "site" | "remote_id" | "version_id">): string => `${h.site}:${h.remote_id}:${h.version_id ?? ""}`;

// ---- settings -----------------------------------------------------------------------------------------------------------------------------------

export const civitaiEnabled = (): boolean => getHouseholdSettingValue(CIVITAI_ENABLED_KEY) === true;
const secretValue = (key: string): string | null => { const v = getHouseholdSettingValue(key); return typeof v === "string" && v.trim() ? v.trim() : null; };
export const civitaiKey = (): string | null => secretValue(CIVITAI_KEY_KEY);
export const huggingFaceToken = (): string | null => secretValue(HF_TOKEN_KEY);
export const tokenFor = (site: LoraSite): string | null => (site === "civitai" ? civitaiKey() : huggingFaceToken());

// ---- limiter, budget, cache ---------------------------------------------------------------------------------------------------------------------

let clock: () => number = () => Date.now();
let sleeper: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
let gapMs = 400;
let fetchImpl: typeof fetch | null = null;
export function __setSourceTestHooks(h: { now?: () => number; sleep?: (ms: number) => Promise<void>; gapMs?: number; fetch?: typeof fetch | null }): void {
  if (h.now) clock = h.now;
  if (h.sleep) sleeper = h.sleep;
  if (h.gapMs !== undefined) gapMs = h.gapMs;
  if (h.fetch !== undefined) fetchImpl = h.fetch;
}

interface HostState { lastAt: number; blockedUntil: number; failures: number; chain: Promise<unknown> }
const hosts = new Map<string, HostState>();
let hourly: number[] = [];
const cache = new Map<string, { at: number; value: unknown }>();
const previews = new Map<string, { at: number; url: string }>();
const knownSha = new Map<string, string>();
const CACHE_MS = 5 * 60_000;
const PREVIEW_MS = 24 * 3_600_000;
const HOURLY_BUDGET = 300;

export function __resetSourceForTests(): void {
  hosts.clear(); hourly = []; cache.clear(); previews.clear(); knownSha.clear();
  clock = () => Date.now(); sleeper = (ms) => new Promise((r) => setTimeout(r, ms)); gapMs = 400; fetchImpl = null;
}
/** Test-only: how many remote requests actually went out. */
export const sourceRequestCount = (): number => requests;
let requests = 0;

const HOST_NAME: Record<LoraSite, string> = { huggingface: "huggingface.co", civitai: "civitai.com" };
const SITE_LABEL: Record<LoraSite, string> = { huggingface: "Hugging Face", civitai: "Civitai" };

function hostState(host: string): HostState {
  let s = hosts.get(host);
  if (!s) { s = { lastAt: 0, blockedUntil: 0, failures: 0, chain: Promise.resolve() }; hosts.set(host, s); }
  return s;
}

/** One guarded GET: honours a stop, the hourly budget and the per-host gap (requests queue, one at a time per host), and starts the exponential stop on a 429 or 5xx. */
async function guardedGet(site: LoraSite, url: string, opts: { accept?: string; budget?: boolean; follow?: boolean } = {}): Promise<Response> {
  const host = HOST_NAME[site];
  if (new URL(url).hostname !== host && !new URL(url).hostname.endsWith(`.${host}`) && !(site === "civitai" && new URL(url).hostname === "image.civitai.com")) throw new SourceError("bad_response", "That address is not on the source's own site.", 502);
  // A picture comes from the source's image storage, not its search service: it queues on its own address and takes no search gap or hourly count.
  const s = hostState(opts.follow ? new URL(url).hostname : host);
  const run = async (): Promise<Response> => {
    const now = clock();
    if (s.blockedUntil > now) throw new SourceError("busy", `${SITE_LABEL[site]} asked us to slow down. Try again in ${Math.max(1, Math.ceil((s.blockedUntil - now) / 60_000))} minutes.`, 503);
    if (opts.budget !== false) {
      hourly = hourly.filter((t) => now - t < 3_600_000);
      if (hourly.length >= HOURLY_BUDGET) throw new SourceError("budget", "That is a lot of searching for one hour. Try again a little later.", 429);
      hourly.push(now);
    }
    const wait = opts.follow ? 0 : s.lastAt + gapMs - now;
    if (wait > 0) await sleeper(wait);
    s.lastAt = clock();
    const headers: Record<string, string> = { accept: opts.accept ?? "application/json", "user-agent": "MaiPai-Home (self-hosted; admin-initiated)" };
    const token = new URL(url).hostname === host ? tokenFor(site) : null;
    if (token) headers.authorization = `Bearer ${token}`;
    requests += 1;
    let res: Response;
    try { res = await (fetchImpl ?? fetch)(url, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) }); }
    catch { throw new SourceError("unreachable", `Home could not reach ${SITE_LABEL[site]}. Check this computer's internet, then try again.`, 502); }
    if (res.status === 429 || res.status >= 500) {
      s.failures += 1;
      s.blockedUntil = clock() + Math.min(30, 2 ** (s.failures - 1)) * 60_000;
      throw new SourceError("busy", `${SITE_LABEL[site]} is busy right now. Home will wait a few minutes before asking again.`, 503);
    }
    s.failures = 0;
    if (res.status === 401 || res.status === 403) throw new SourceError("token_refused", `${SITE_LABEL[site]} would not answer. Check the saved key or token in settings.`, 502);
    if (res.status === 404) throw new SourceError("not_found", "That style isn't there any more.", 404);
    if (opts.follow && res.status >= 300 && res.status < 400) {
      // A picture file is served from the source's own storage hosts; follow one hop there, with no token.
      const next = new URL(res.headers.get("location") ?? "", url);
      const own = site === "civitai" ? ["civitai.com"] : ["huggingface.co", "hf.co"];
      if (next.protocol !== "https:" || !own.some((h) => next.hostname === h || next.hostname.endsWith(`.${h}`))) throw new SourceError("bad_response", "That address is not on the source's own site.", 502);
      try { res = await (fetchImpl ?? fetch)(next.href, { headers: { accept: opts.accept ?? "image/*", "user-agent": "MaiPai-Home (self-hosted; admin-initiated)" }, redirect: "manual", signal: AbortSignal.timeout(15_000) }); }
      catch { throw new SourceError("unreachable", `Home could not reach ${SITE_LABEL[site]}. Check this computer's internet, then try again.`, 502); }
    }
    if (res.status >= 300) throw new SourceError("bad_response", `${SITE_LABEL[site]} answered in a way Home can't read. Try again later.`, 502);
    return res;
  };
  // Queue behind earlier calls for the same host so the gap holds under concurrent clicks.
  const result = s.chain.then(run, run);
  s.chain = result.catch(() => undefined);
  return result;
}

async function getJson(site: LoraSite, url: string, budget = true): Promise<{ body: unknown; headers: Headers }> {
  const hit = cache.get(url);
  if (hit && clock() - hit.at < CACHE_MS) return hit.value as { body: unknown; headers: Headers };
  const res = await guardedGet(site, url, { budget });
  let body: unknown;
  try { body = await res.json(); } catch { throw new SourceError("bad_response", `${SITE_LABEL[site]} sent something Home can't read. Try again later.`, 502); }
  const value = { body, headers: res.headers };
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  cache.set(url, { at: clock(), value });
  return value;
}

// ---- helpers ------------------------------------------------------------------------------------------------------------------------------------

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const numOr = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** The base a text names, read through the one table (baseFamilies.ts). */
export const ltxBaseFromText = (text: string): HitBase => baseFromText(text);

/** A Civitai base label as a base: a concrete label maps directly; a generic family label (LTXV2) takes its version from the texts, only when exactly one version is named. */
function civitaiBase(label: string | null, texts: readonly (string | null)[], media: Media = "video"): { base: HitBase; unstated: boolean } {
  if (!label) return { base: "unknown", unstated: false };
  const known = civitaiLabel(label, media);
  if (known.kind === "base") return { base: known.id, unstated: false };
  if (known.kind === "generic") {
    const named = basesNamedIn(texts.filter((t): t is string => !!t).join(" "), known.candidates);
    return named.length === 1 ? { base: named[0]!, unstated: false } : { base: "unknown", unstated: true };
  }
  return { base: ltxBaseFromText(label), unstated: false };
}

const OPEN_LICENCES = new Set(["apache-2.0", "mit", "cc0-1.0", "bsd-3-clause", "bsd-2-clause", "unlicense"]);
export function licenceClassOf(id: string | null): LicenceClass {
  if (!id) return "unknown";
  const l = id.toLowerCase();
  if (OPEN_LICENCES.has(l)) return "open";
  if (/-nc(?:-|$)/.test(l) || l.includes("non-commercial")) return "non_commercial";
  return "custom";
}

function civitaiLicence(allow: unknown): { id: string | null; cls: LicenceClass; commercial: "yes" | "no" | "unknown" } {
  const list = Array.isArray(allow) ? allow.map(String) : typeof allow === "string" ? allow.replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean) : null;
  if (list === null) return { id: null, cls: "unknown", commercial: "unknown" };
  const sell = list.includes("Sell");
  return { id: sell ? "Civitai (commercial use allowed)" : "Civitai (no selling)", cls: sell ? "custom" : "non_commercial", commercial: sell ? "yes" : "no" };
}

function civitaiHit(modelRaw: unknown, bases: readonly string[], wantVersion?: string, media: Media = "video"): Hit | null {
  const m = rec(modelRaw);
  const id = m.id;
  if (typeof id !== "number" && typeof id !== "string") return null;
  const versions = arr(m.modelVersions).map(rec);
  const chosen = (wantVersion ? versions.find((v) => String(v.id) === wantVersion) : undefined) ?? (bases.length ? versions.find((v) => bases.includes(String(v.baseModel))) : undefined) ?? versions[0];
  if (!chosen) return null;
  const files = arr(chosen.files).map(rec);
  const file = files.find((f) => f.primary === true && String(f.name ?? "").toLowerCase().endsWith(".safetensors")) ?? files.find((f) => String(f.name ?? "").toLowerCase().endsWith(".safetensors")) ?? null;
  const images = arr(chosen.images).map(rec);
  const sha = str(rec(file?.hashes).SHA256)?.toLowerCase() ?? null;
  const lic = civitaiLicence(m.allowCommercialUse);
  const stats = rec(m.stats);
  const baseLabel = str(chosen.baseModel);
  const { base, unstated } = civitaiBase(baseLabel, [str(m.name), str(chosen.name), str(m.description), str(chosen.description)], media);
  const tags = arr(m.tags).map((t) => (typeof t === "string" ? t : str(rec(t).name) ?? ""));
  const onSite = (i: Record<string, unknown>): boolean => typeof i.url === "string" && /^https:\/\/image\.civitai\.com\//.test(String(i.url));
  // A video style's examples are all clips: Civitai serves a still of a clip from the same address with `anim=false` in place of `original=true`.
  const still = (u: string): string => u.replace("/original=true/", "/anim=false,width=450/");
  const stillImage = images.find((i) => onSite(i) && String(i.type ?? "image") === "image");
  const stillClip = stillImage ? undefined : images.find((i) => onSite(i) && String(i.type) === "video" && String(i.url).includes("/original=true/"));
  const preview = stillImage ?? (stillClip ? { ...stillClip, url: still(String(stillClip.url)) } : undefined);
  const versionId = String(chosen.id);
  // A picture search shows styles for pictures: a style whose every example is a clip is a video style (its base label can be generic or missing).
  if (media === "picture" && images.length > 0 && images.every((i) => String(i.type ?? "image") === "video")) return null;
  const adult_check = classifyCivitai({ nsfw: m.nsfw, nsfwLevel: m.nsfwLevel, imageLevels: images.map((i) => i.nsfwLevel), malformed: !file && images.length === 0 && m.mode !== undefined });
  // Adult models live on civitai.red (as in Loki Doki's search); civitai.com does not open them. Downloads and the API stay on civitai.com.
  const slug = (str(m.name) ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const page = adult_check.state === "normal" ? `https://civitai.com/models/${id}` : `https://civitai.red/models/${id}${slug ? `/${slug}` : ""}`;
  return {
    site: "civitai", remote_id: String(id), version_id: versionId,
    adult_check,
    title: str(m.name) ?? `Model ${id}`, creator: str(rec(m.creator).username), page_url: `${page}?modelVersionId=${versionId}`,
    file_url: file ? `https://civitai.com/api/download/models/${versionId}` : null, file_name: str(file?.name),
    bytes: file && typeof file.sizeKB === "number" ? Math.round(file.sizeKB * 1024) : null, sha256: sha && /^[0-9a-f]{64}$/.test(sha) ? sha : null,
    base_label: baseLabel, base_model: base, base_unstated: unstated,
    kind: tags.some((t) => t.toLowerCase() === "character") ? "character" : "style",
    licence_id: lic.id, licence_class: lic.cls, commercial_use: lic.commercial,
    downloads: numOr(stats.downloadCount, 0), rating: typeof stats.rating === "number" ? stats.rating : null, created_at: str(chosen.publishedAt),
    trigger_words: cleanTriggerWords(arr(chosen.trainedWords).filter((w): w is string => typeof w === "string")), gated: false,
    summary: plainSummary([str(m.description), str(chosen.description)], 200, str(m.name)), tags: tags.filter(Boolean).slice(0, 5),
    preview_url: typeof preview?.url === "string" ? String(preview.url) : null, also_on: [],
  };
}

function hfHit(raw: unknown): Hit | null {
  const m = rec(raw);
  const id = str(m.id) ?? str(m.modelId);
  if (!id || !/^[\w.-]+\/[\w.-]+$/.test(id)) return null;
  const tags = arr(m.tags).filter((t): t is string => typeof t === "string");
  const card = rec(m.cardData);
  const baseText = [...tags.filter((t) => t.startsWith("base_model:")), ...arr(card.base_model).map(String), typeof card.base_model === "string" ? card.base_model : ""].join(" ");
  const base = baseFromText(baseText);
  const licenceId = str(card.license) ?? tags.find((t) => t.startsWith("license:"))?.slice(8) ?? null;
  const lc = licenceClassOf(licenceId);
  const hit: Hit = {
    site: "huggingface", remote_id: id, version_id: null, adult_check: classifyHuggingFace(tags), title: id.split("/")[1]!, creator: id.split("/")[0]!,
    page_url: `https://huggingface.co/${id}`, file_url: null, file_name: null, bytes: null, sha256: null,
    base_label: base === "unknown" ? (baseText.replace(/base_model:(?:adapter:|finetune:|quantized:)?/g, "").trim().slice(0, 60) || null) : base, base_model: base, base_unstated: false, kind: null,
    licence_id: licenceId, licence_class: lc, commercial_use: lc === "open" ? "yes" : lc === "non_commercial" ? "no" : "unknown",
    downloads: numOr(m.downloads, 0), rating: typeof m.likes === "number" ? m.likes : null, created_at: str(m.createdAt), trigger_words: [], gated: m.gated === "auto" || m.gated === "manual" || m.gated === true,
    summary: plainSummary([typeof card.description === "string" ? card.description : null]),
    preview_url: null, also_on: [],
  };
  const siblings = arr(m.siblings).map(rec);
  const picture = siblings.map((x) => String(x.rfilename ?? "")).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f) && !f.includes("..")).sort((a, b) => Number(/example|sample|preview|assets|images?\//i.test(b)) - Number(/example|sample|preview|assets|images?\//i.test(a)))[0];
  if (picture) hit.preview_url = `https://huggingface.co/${id}/resolve/main/${picture.split("/").map(encodeURIComponent).join("/")}`;
  if (siblings.length) {
    const files = siblings.filter((s) => String(s.rfilename ?? "").toLowerCase().endsWith(".safetensors"));
    const pick = (files.length === 1 ? files[0] : files.find((s) => /lora/i.test(String(s.rfilename))) ) ?? files.sort((a, b) => numOr(b.size, 0) - numOr(a.size, 0))[0];
    if (pick) {
      const path = String(pick.rfilename);
      const sha = str(rec(pick.lfs).sha256)?.toLowerCase() ?? null;
      hit.version_id = path; hit.file_name = path.split("/").pop() ?? path;
      hit.file_url = `https://huggingface.co/${id}/resolve/main/${path.split("/").map(encodeURIComponent).join("/")}`;
      hit.bytes = typeof pick.size === "number" ? pick.size : typeof rec(pick.lfs).size === "number" ? (rec(pick.lfs).size as number) : null;
      hit.sha256 = sha && /^[0-9a-f]{64}$/.test(sha) ? sha : null;
      if (hit.sha256) knownSha.set(`${id}`, hit.sha256);
    }
  } else if (knownSha.has(id)) hit.sha256 = knownSha.get(id)!;
  return hit;
}

// ---- browse and detail --------------------------------------------------------------------------------------------------------------------------

export interface BrowseParams {
  media?: Media;
  source: SourceChoice; q: string; kind: "any" | "style" | "character"; base: "default" | BrowseBase | "all";
  sort: "downloads" | "rating" | "newest"; cursor: string | null; /** Sent upstream as `nsfw=true` ONLY when the caller holds a valid unlock proof and asked for adult results. */ nsfw: boolean;
}
interface Cursor { h: string | null; c: string | null; n: number }
const decodeCursor = (s: string | null): Cursor => { if (!s) return { h: null, c: null, n: 0 }; try { const v = rec(JSON.parse(Buffer.from(s, "base64url").toString())); return { h: str(v.h), c: str(v.c), n: Math.max(0, Math.floor(numOr(v.n, 0))) }; } catch { return { h: null, c: null, n: 0 }; } };
const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify(c)).toString("base64url");

const mediaOf = (p: BrowseParams): Media => p.media ?? "video";
const basesFor = (p: BrowseParams): string[] => civitaiLabelsFor(p.base, mediaOf(p));
/** Whether a hit belongs in this search. A generic-label hit with no stated version is kept in the default search only (it is shown, not installable). */
const baseWanted = (p: BrowseParams, hit: Pick<Hit, "base_model" | "base_unstated">): boolean =>
  p.base === "all" || (hit.base_model !== "unknown" && wantedBaseIds(p.base, mediaOf(p)).includes(hit.base_model)) || (hit.base_unstated && p.base === "default");

async function browseHf(p: BrowseParams, cursor: string | null, budget = true): Promise<{ hits: Hit[]; next: string | null }> {
  let url: string;
  if (cursor) {
    // The cursor is the `Link: rel=next` address HF gave us; only an address on its own host is followed.
    const u = new URL(cursor);
    if (u.protocol !== "https:" || u.hostname !== "huggingface.co" || !u.pathname.startsWith("/api/models")) throw new SourceError("bad_response", "That page is not available any more. Search again.", 400);
    url = u.href;
  } else {
    const q = new URLSearchParams({ filter: "lora", full: "true", limit: String(PAGE_SIZE), sort: p.sort === "downloads" ? "downloads" : p.sort === "rating" ? "likes" : "createdAt", direction: "-1" });
    // With no words typed, ask for this household's family by name: the newest "lora" models are mostly other bases.
    const word = p.q.trim() || searchWordFor(p.base, mediaOf(p));
    if (word) q.set("search", word);
    url = `https://huggingface.co/api/models?${q}`;
  }
  const { body, headers } = await getJson("huggingface", url, budget);
  if (!Array.isArray(body)) throw new SourceError("bad_response", "Hugging Face sent something Home can't read. Try again later.", 502);
  const hits = body.map(hfHit).filter((h): h is Hit => h !== null).filter((h) => baseWanted(p, h));
  const next = /<([^>]+)>;\s*rel="next"/.exec(headers.get("link") ?? "")?.[1] ?? null;
  return { hits, next };
}

async function browseCivitai(p: BrowseParams, cursor: string | null, budget = true): Promise<{ hits: Hit[]; next: string | null }> {
  if (!civitaiEnabled()) throw new SourceError("off", "Civitai is off. An owner or admin can turn it on in settings.", 403);
  const q = new URLSearchParams({ limit: String(PAGE_SIZE), types: "LORA", sort: p.sort === "downloads" ? "Most Downloaded" : p.sort === "rating" ? "Highest Rated" : "Newest", nsfw: p.nsfw ? "true" : "false" });
  if (p.q.trim()) q.set("query", p.q.trim());
  const labels = p.base === "all" ? [] : basesFor(p);
  // A search that wants a base but has no label to ask for (no supported engine) asks Civitai nothing: an empty list would mean "every base".
  if (p.base !== "all" && !labels.length) return { hits: [], next: null };
    for (const b of labels) q.append("baseModels", b);
  if (cursor) q.set("cursor", cursor);
  const { body } = await getJson("civitai", `https://civitai.com/api/v1/models?${q}`, budget);
  const b = rec(body);
  if (!Array.isArray(b.items)) throw new SourceError("bad_response", "Civitai sent something Home can't read. Try again later.", 502);
  const hits = b.items.map((m) => civitaiHit(m, p.base === "all" ? [] : basesFor(p), undefined, mediaOf(p))).filter((h): h is Hit => h !== null).filter((h) => baseWanted(p, h));
  return { hits, next: str(rec(b.metadata).nextCursor) };
}

const sortKey = (p: BrowseParams) => (h: Hit): number => (p.sort === "downloads" ? h.downloads : p.sort === "rating" ? (h.rating ?? 0) : Date.parse(h.created_at ?? "") || 0);

export interface Browsed { hits: Hit[]; next: string | null; remember: Array<{ key: string; url: string }> }

export async function browseHits(p: BrowseParams): Promise<Browsed> {
  const cur = decodeCursor(p.cursor);
  const useHf = p.source !== "civitai", useCv = p.source !== "huggingface";
  if (useCv && !civitaiEnabled()) { if (p.source === "civitai") throw new SourceError("off", "Civitai is off. An owner or admin can turn it on in settings.", 403); }
  const [hf0, cv0] = await Promise.all([
    useHf && (p.cursor === null || cur.h) ? browseHf(p, cur.h) : Promise.resolve({ hits: [] as Hit[], next: null }),
    useCv && civitaiEnabled() && (p.cursor === null || cur.c) ? browseCivitai(p, cur.c) : Promise.resolve({ hits: [] as Hit[], next: null }),
  ]);
  let hf = hf0;
  let cv = cv0;
  const acceptedCount = () => {
    const combined = dedupeHits([...hf.hits, ...cv.hits]);
    return p.kind === "any" ? combined.length : combined.filter((h) => h.kind === null || h.kind === p.kind).length;
  };
  let extra = 0;
  while (extra < 2 && acceptedCount() < PAGE_SIZE && (hf.next || cv.next)) {
    extra += 1;
    const [hn, cn] = await Promise.all([
      hf.next ? browseHf(p, hf.next, false) : Promise.resolve({ hits: [] as Hit[], next: null }),
      cv.next ? browseCivitai(p, cv.next, false) : Promise.resolve({ hits: [] as Hit[], next: null }),
    ]);
    hf = { hits: [...hf.hits, ...hn.hits], next: hn.next };
    cv = { hits: [...cv.hits, ...cn.hits], next: cn.next };
  }
  let hits = dedupeHits([...hf.hits, ...cv.hits]);
  if (p.kind !== "any") hits = hits.filter((h) => h.kind === null || h.kind === p.kind);
  const key = sortKey(p);
  hits = [...hits].sort((a, b) => key(b) - key(a));
  const n = cur.n + hits.length;
  const next = n >= MAX_RESULTS || (!hf.next && !cv.next) ? null : encodeCursor({ h: hf.next, c: cv.next, n });
  const remember = hits.flatMap((h) => (h.preview_url ? [{ key: hitKey(h), url: h.preview_url }] : []));
  for (const r of remember) previews.set(r.key, { at: clock(), url: r.url });
  return { hits, next, remember };
}

/** One hit by id with its file facts (Hugging Face `?blobs=true`, Civitai `/models/{id}`). Used by the confirm panel and by install, which never trusts a client's file address. */
export async function fetchHit(site: LoraSite, remoteId: string, versionId?: string | null): Promise<Hit> {
  if (site === "civitai") {
    if (!civitaiEnabled()) throw new SourceError("off", "Civitai is off. An owner or admin can turn it on in settings.", 403);
    if (!/^\d{1,12}$/.test(remoteId)) throw new SourceError("not_found", "That style isn't there any more.", 404);
    const { body } = await getJson("civitai", `https://civitai.com/api/v1/models/${remoteId}`);
    const hit = civitaiHit(body, [], versionId ?? undefined);
    if (!hit) throw new SourceError("bad_response", "Civitai sent something Home can't read. Try again later.", 502);
    if (hit.preview_url) previews.set(hitKey(hit), { at: clock(), url: hit.preview_url });
    return hit;
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(remoteId)) throw new SourceError("not_found", "That style isn't there any more.", 404);
  const { body } = await getJson("huggingface", `https://huggingface.co/api/models/${remoteId}?blobs=true`);
  const hit = hfHit(body);
  if (!hit) throw new SourceError("bad_response", "Hugging Face sent something Home can't read. Try again later.", 502);
  return hit;
}

/** A pasted Hugging Face link: `https://huggingface.co/<owner>/<repo>[/blob|resolve/<rev>/<file>]`. */
export function parseHfLink(link: string): { repo: string; file: string | null } | null {
  let u: URL;
  try { u = new URL(link.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "huggingface.co") return null;
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2 || !/^[\w.-]+$/.test(parts[0]!) || !/^[\w.-]+$/.test(parts[1]!)) return null;
  const file = (parts[2] === "blob" || parts[2] === "resolve") && parts.length > 4 ? parts.slice(4).join("/") : null;
  return { repo: `${parts[0]}/${parts[1]}`, file };
}

/** The picture of a hit the caller may see, fetched once through the hub and kept 24 hours. Only the address the hub itself read from the source is ever fetched. */
const pictureBytes = new Map<string, { at: number; type: string; bytes: Uint8Array }>();
export async function previewOf(key: string): Promise<{ type: string; bytes: Uint8Array } | null> {
  const held = pictureBytes.get(key);
  if (held && clock() - held.at < PREVIEW_MS) return held;
  const known = previews.get(key);
  if (!known || clock() - known.at > PREVIEW_MS) return null;
  const res = await guardedGet(key.startsWith("huggingface:") ? "huggingface" : "civitai", known.url, { accept: "image/*", budget: false, follow: true });
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 5_000_000) return null;
  if (pictureBytes.size > 100) pictureBytes.delete(pictureBytes.keys().next().value as string);
  const value = { at: clock(), type, bytes };
  pictureBytes.set(key, value);
  return value;
}

// ---- dedupe and installed ----------------------------------------------------------------------------------------------------------------------

/** Section 15.4: identity is (site, remote id, version id); across sources only the sha256 when both publish it. Hugging Face wins a tie (no key, stable hash). Names are never identity. */
export function dedupeHits(hits: readonly Hit[]): Hit[] {
  const seen = new Set<string>();
  const first: Hit[] = [];
  for (const h of hits) { const k = hitKey(h); if (seen.has(k)) continue; seen.add(k); first.push(h); }
  const order = [...first].sort((a, b) => (a.site === b.site ? 0 : a.site === "huggingface" ? -1 : 1));
  const bySha = new Map<string, Hit>();
  const drop = new Set<Hit>();
  for (const h of order) {
    if (!h.sha256) continue;
    const kept = bySha.get(h.sha256);
    if (!kept) { bySha.set(h.sha256, h); continue; }
    drop.add(h);
    if (kept.site !== h.site && !kept.also_on.includes(h.site)) kept.also_on.push(h.site);
  }
  return first.filter((h) => !drop.has(h));
}

export interface InstalledMatch { lora: Lora; by: "version" | "sha" }
/** The live record (not in the trash) this hit already is: same site and version id, then same sha256. */
export function installedAs(hit: Pick<Hit, "site" | "remote_id" | "version_id" | "sha256" | "base_model">, records: readonly Lora[] = listLoraRecords(), media: Media = mediaOfBase(hit.base_model) ?? "video"): InstalledMatch | null {
  const live = records.filter((r) => r.removed_at === null && r.media === media);
  const byVersion = hit.version_id ? live.find((r) => r.source.site === hit.site && r.source.version_id === hit.version_id && (hit.site === "civitai" || r.source.remote_id === hit.remote_id)) : undefined;
  if (byVersion) return { lora: byVersion, by: "version" };
  const bySha = hit.sha256 ? live.find((r) => r.file.sha256 === hit.sha256) : undefined;
  return bySha ? { lora: bySha, by: "sha" } : null;
}
