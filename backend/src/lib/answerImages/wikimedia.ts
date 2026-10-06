// ANSWER-IMG-02: the subject resolver and the Wikimedia picture candidates
// behind `show_images` (design: data-scratch/research/chat-images-in-answers.md
// sections 3 and 9). Wikidata decides what the subject is (a human, a birth
// date, a Commons category, a lead image) and that it has an English
// Wikipedia article; nothing here is a word rule. The media-lookup package
// keeps its own copy of the Wikidata search inside its Deno sandbox: a
// sandboxed package cannot import hub modules, and its checked-in copy is
// pinned to the catalog's hash (bundled-provenance.json).
import { tryConsume } from "@/lib/rateLimiter";
import { ANSWER_IMAGE_USER_AGENT } from "./fetch";

export type WikimediaEntity = {
  id: string;
  label: string;
  description: string;
  human: boolean;
  birthDate?: string;
  commonsCategory?: string;
  wikipediaTitle: string;
  image?: string;
};

/** One picture a Wikimedia source offers, before it is fetched. */
export type WikimediaCandidate = {
  url: string;
  page: string;
  title: string;
  description: string;
  license?: { short: string; url?: string; artist?: string };
  lead: boolean;
};

export type FetchJson = (url: string) => Promise<unknown>;

const WD = "https://www.wikidata.org/w/api.php";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
const TIMEOUT_MS = 1_500;
// A person reading the article loads this much from Wikimedia in a second.
const WIKIMEDIA_PACE = { capacity: 6, refillPerSecond: 1 };

/** The hub's own JSON fetch for the fixed Wikimedia hosts: Home's
 * User-Agent (Wikimedia's policy asks for one), no cookies, no referrer, a
 * short timeout and a per-host pace. Throws on anything but a 200 JSON body. */
export const wikimediaFetchJson: FetchJson = async (url) => {
  const host = new URL(url).hostname;
  if (!tryConsume(`net:${host}`, WIKIMEDIA_PACE)) throw new Error(`paced: ${host}`);
  const response = await fetch(url, {
    headers: { "User-Agent": ANSWER_IMAGE_USER_AGENT, Accept: "application/json" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status} from ${host}`);
  return response.json();
};

function entityId(claim: unknown): string | undefined {
  return (claim as { mainsnak?: { datavalue?: { value?: { id?: string } } } } | undefined)?.mainsnak?.datavalue?.value?.id;
}
function claimText(claim: unknown): string | undefined {
  const value = (claim as { mainsnak?: { datavalue?: { value?: unknown } } } | undefined)?.mainsnak?.datavalue?.value;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value as { time?: unknown; text?: unknown };
    if (typeof v.time === "string") return v.time;
    if (typeof v.text === "string") return v.text;
  }
  return undefined;
}

/** The subject as Wikidata knows it, or null when no item with an English
 * Wikipedia article matches (owner, 2026-10-06: no article, no pictures). */
export async function resolveWikimediaSubject(subject: string, fetchJson: FetchJson): Promise<WikimediaEntity | null> {
  const search = await fetchJson(`${WD}?action=wbsearchentities&search=${encodeURIComponent(subject)}&language=en&type=item&format=json&limit=10`) as { search?: Array<{ id?: string; label?: string; description?: string }> };
  const wanted = subject.trim().toLowerCase();
  const match = search.search?.find((row) => typeof row.id === "string" && row.label?.toLowerCase() === wanted) ?? search.search?.[0];
  if (!match?.id || !/^Q\d+$/.test(match.id)) return null;
  const response = await fetchJson(`${WD}?action=wbgetentities&ids=${match.id}&props=claims%7Csitelinks%7Clabels%7Cdescriptions&languages=en&sitefilter=enwiki&format=json`) as { entities?: Record<string, { claims?: Record<string, unknown[]>; sitelinks?: Record<string, { title?: string }>; labels?: Record<string, { value?: string }>; descriptions?: Record<string, { value?: string }> }> };
  const entity = response.entities?.[match.id];
  const title = entity?.sitelinks?.enwiki?.title;
  if (!entity || !title) return null;
  const claims = entity.claims ?? {};
  const birthDate = claimText(claims.P569?.[0]);
  const category = claimText(claims.P373?.[0]);
  const image = claimText(claims.P18?.[0]);
  return {
    id: match.id,
    label: entity.labels?.en?.value ?? match.label ?? subject,
    description: entity.descriptions?.en?.value ?? match.description ?? "",
    human: (claims.P31 ?? []).some((value) => entityId(value) === "Q5"),
    ...(birthDate ? { birthDate } : {}),
    ...(category ? { commonsCategory: category } : {}),
    wikipediaTitle: title,
    ...(image ? { image } : {}),
  };
}

/** The article's plain summary text (a teen's Wikimedia pictures need it to
 * pass the floor first), or null for a missing or disambiguation page. */
export async function wikipediaExtract(title: string, fetchJson: FetchJson): Promise<string | null> {
  const result = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`) as { extract?: unknown; type?: unknown };
  if (result.type === "disambiguation" || typeof result.extract !== "string") return null;
  return result.extract;
}

/** Whether a Wikidata birth date ("+2010-05-01T00:00:00Z") makes the person
 * under 18 on `now`. An unreadable date is treated as a minor: no pictures. */
export function isUnder18(birthDate: string, now: Date): boolean {
  const m = /^[+-]?(\d{4,})-(\d{2})-(\d{2})/.exec(birthDate);
  if (!m) return true;
  const year = Number(m[1]), month = Math.max(1, Number(m[2])), day = Math.max(1, Number(m[3]));
  const eighteenth = Date.UTC(year + 18, month - 1, day);
  return now.getTime() < eighteenth;
}

function plain(html: unknown, max = 200): string {
  if (typeof html !== "string") return "";
  const text = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const fileKey = (name: string): string => name.replace(/^File:/i, "").replace(/_/g, " ").trim().toLowerCase();
const PICTURE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

type ImageInfoPage = { title?: string; imageinfo?: Array<{ url?: string; thumburl?: string; descriptionurl?: string; mime?: string; extmetadata?: Record<string, { value?: unknown }> }> };

function candidateFromPage(page: ImageInfoPage, leadName: string | undefined): WikimediaCandidate | null {
  const info = page.imageinfo?.[0];
  if (!page.title || !info?.mime || !PICTURE_MIME.has(info.mime)) return null;
  const url = info.thumburl ?? info.url;
  if (!url || !info.descriptionurl) return null;
  const meta = info.extmetadata ?? {};
  const short = plain(meta.LicenseShortName?.value, 60);
  const licenseUrl = typeof meta.LicenseUrl?.value === "string" && /^https?:\/\//.test(meta.LicenseUrl.value) ? meta.LicenseUrl.value : undefined;
  const artist = plain(meta.Artist?.value, 80);
  return {
    url,
    page: info.descriptionurl,
    title: page.title.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, ""),
    description: plain(meta.ImageDescription?.value),
    ...(short ? { license: { short, ...(licenseUrl ? { url: licenseUrl } : {}), ...(artist ? { artist } : {}) } } : {}),
    lead: leadName !== undefined && fileKey(page.title) === fileKey(leadName),
  };
}

const IMAGEINFO = "prop=imageinfo&iiprop=url%7Cmime%7Cextmetadata&iiurlwidth=1280&iiextmetadatafilter=LicenseShortName%7CLicenseUrl%7CArtist%7CImageDescription&format=json";

/** The subject's lead image (Wikidata P18) and, unless `leadOnly`, the
 * pictures curated into its Commons category (P373), lead first. One Commons
 * call: the category when there is one (the lead is normally a member),
 * otherwise the lead file itself. */
export async function wikimediaCandidates(entity: WikimediaEntity, fetchJson: FetchJson, opts: { leadOnly?: boolean } = {}): Promise<WikimediaCandidate[]> {
  const useCategory = !opts.leadOnly && entity.commonsCategory;
  if (!useCategory && !entity.image) return [];
  const url = useCategory
    ? `${COMMONS}?action=query&generator=categorymembers&gcmtitle=${encodeURIComponent(`Category:${entity.commonsCategory}`)}&gcmtype=file&gcmlimit=20&${IMAGEINFO}`
    : `${COMMONS}?action=query&titles=${encodeURIComponent(`File:${entity.image}`)}&${IMAGEINFO}`;
  const result = await fetchJson(url) as { query?: { pages?: Record<string, ImageInfoPage> } };
  const found = Object.values(result.query?.pages ?? {}).map((page) => candidateFromPage(page, entity.image)).filter((c): c is WikimediaCandidate => c !== null);
  const lead = found.filter((c) => c.lead);
  if (useCategory && lead.length === 0 && entity.image) {
    // The lead file is not in the category: it still leads, with its site and
    // page but no licence line (one call is the budget).
    const name = entity.image.replace(/ /g, "_");
    lead.push({ url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=1280`, page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}`, title: entity.image.replace(/\.[a-z0-9]+$/i, ""), description: "", lead: true });
  }
  return [...lead, ...found.filter((c) => !c.lead)];
}
