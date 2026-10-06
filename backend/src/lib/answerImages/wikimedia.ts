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
  /** Other English names (Wikidata aliases, the taxon name): a picture that
   * uses one of them names the subject (ANSWER-IMG-05b). */
  aliases?: string[];
  /** Its labels in other languages ("Tour Eiffel"): they name it in a
   * Commons title, but on the open web they can be common nouns. */
  otherLabels?: string[];
  /** IMGQ-03: the subject's official website (P856), whose own pictures
   * are pictures of it. */
  officialSite?: string;
  /** IMGQ-03: files Wikidata names as the subject's logo, flag, coat of
   * arms, map, signature, grave, collage or seal: not photos of it. */
  nonPhotoFiles?: string[];
  /** The subject's own Wikipedia intro, when it is this item's page (a
   * teen's Wikimedia pictures need it to pass the floor). */
  pageExtract?: string;
  /** The title the open web is asked for, when it is not the subject as
   * given (study R2). */
  queryTitle?: string;
  /** Words from the descriptions of other things with this name (study R4). */
  otherSenseWords?: string[];
  /** A film, show, game, franchise or character (Wikidata P31): free
   * Commons pictures of these are mostly props, merchandise and events. */
  media?: boolean;
  /** How the item was chosen, for the trace. */
  resolvedVia?: "wikipedia" | "kind" | "wikidata_search" | "no_article_search";
};

/** One picture a Wikimedia source offers, before it is fetched. */
export type WikimediaCandidate = {
  url: string;
  page: string;
  title: string;
  description: string;
  license?: { short: string; url?: string; artist?: string };
  lead: boolean;
  /** IMGQ-03: what Commons itself says about the file. */
  objectName?: string;
  /** Visible (topical) categories, without the "Category:" prefix. */
  categories?: string[];
  /** Commons `Restrictions` values: costume, fan-art, personality, ... */
  restrictions?: string[];
  /** The original's width, when Commons states it. */
  width?: number;
};

export type FetchJson = (url: string) => Promise<unknown>;

const WD = "https://www.wikidata.org/w/api.php";
const WP = "https://en.wikipedia.org/w/api.php";
/** Commons titles are written in many languages ("La tour Eiffel en 2026"):
 * the subject's labels and aliases in these languages name it too. English
 * stays the label shown. */
const NAME_LANGUAGES = ["en", "fr", "de", "es", "it", "pt", "nl", "ja", "zh", "ru"].join("%7C");
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

/** Wikidata properties whose file is a logo, flag, coat of arms, map,
 * signature, grave, collage or seal (P154, P41, P94, P242, P1943, P109,
 * P1442, P2716, P158). */
const NON_PHOTO_PROPERTIES = ["P154", "P41", "P94", "P242", "P1943", "P109", "P1442", "P2716", "P158"];

/** Wikidata descriptions of entries that are not things with a look. */
const NOT_A_THING = /\b(given name|family name|surname|disambiguation page|wikimedia (category|list|template)|list of|scholarly article|scientific article|journal article|thesis)\b/i;

/** Wikidata classes (P31) of films, shows, games, franchises and
 * characters. The image-search study measured Bing's own top 6 right 94% of
 * the time for TV and film and 100% for characters, against 4 to 25% for
 * Commons; the judged sample's wrong tiles for Star Wars and Jurassic Park
 * were Commons props, a logo and a marquee. */
const MEDIA_CLASSES = new Set(["Q11424", "Q5398426", "Q581714", "Q196600", "Q7889", "Q95074", "Q15773347", "Q24856", "Q1259759", "Q15416", "Q63952888", "Q526877", "Q202866", "Q117467246", "Q1667921", "Q15632617", "Q17537576"]);

/** Function words left out of kind matching and of other senses' words. */
const STOP = new Set(["the", "and", "for", "from", "with", "that", "this", "its", "into", "used", "known", "also", "which", "who", "was", "were", "has", "had", "are", "one", "two", "first", "second", "based", "american", "british", "english", "french", "german", "japanese", "name"]);
/** A few spellings Wikidata descriptions use for what a person calls a kind. */
const KIND_SPELLINGS: Record<string, string[]> = { tv: ["television"], movie: ["film"], film: ["film", "movie"], show: ["series", "television", "sitcom"], car: ["car", "automobile", "marque", "vehicle"], game: ["game"], snake: ["snake", "snakes"], fruit: ["fruit"], brand: ["brand", "company", "marque", "manufacturer"], company: ["company", "brand", "manufacturer"] };

function words(text: string): string[] {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => (w.length >= 3 || w === "tv") && !STOP.has(w) && !/^\d+$/.test(w));
}
/** A word and its possible singulars ("motorcycles": "motorcycle",
 * "motorcycl"; "families": "family"). */
const forms = (w: string): string[] => [w, ...(w.endsWith("ies") ? [`${w.slice(0, -3)}y`] : []), ...(w.endsWith("es") && w.length > 4 ? [w.slice(0, -2)] : []), ...(w.endsWith("s") && w.length > 3 ? [w.slice(0, -1)] : [])];

/** How many of the kind's words a description carries (whole words,
 * plurals and the spellings above allowed). */
export function kindScore(kind: string, description: string): number {
  const have = new Set(words(description).flatMap(forms));
  let score = 0;
  for (const k of words(kind)) {
    const options = forms(k).flatMap((f) => [f, ...(KIND_SPELLINGS[f] ?? [])]).flatMap(forms);
    if (options.some((o) => have.has(o))) score++;
  }
  return score;
}

/** Why a subject resolves to nothing (counted on the trace). */
export type ResolveSkip = "no_article" | "ambiguous" | "error";

type Sense = { id: string; label: string; description: string };

/** The subject as Wikipedia and Wikidata know it (IMGQ, image-search accuracy
 * study R1 and R2, 2026-10-06): the subject's own English Wikipedia page
 * (redirects followed) names the item, which the study found right for 68
 * of 82 subjects against 58 for the Wikidata label search alone; the
 * Wikidata search, asked at the same time, lists the other things with that
 * name. `kind` (what the model says the thing is: "animal", "TV series",
 * "car") picks among them: the page's own item unless another sense's
 * description fits the kind and the page's does not. A disambiguation page
 * with no sense fitting the kind is ambiguous: no pictures (owner,
 * 2026-10-06: only when the conversation makes the meaning clear). Never
 * more than 3 Wikimedia calls here. */
export async function resolveWikimediaSubject(subject: string, fetchJson: FetchJson, kind = ""): Promise<{ entity: WikimediaEntity } | { skipped: ResolveSkip; nothingByName?: boolean }> {
  const [pageResult, searchResult] = await Promise.all([
    fetchJson(`${WP}?action=query&titles=${encodeURIComponent(subject)}&redirects=1&prop=pageprops%7Cextracts&ppprop=wikibase_item%7Cdisambiguation&exintro=1&explaintext=1&format=json`).catch(() => null) as Promise<{ query?: { pages?: Record<string, { title?: string; missing?: unknown; pageprops?: { wikibase_item?: string; disambiguation?: unknown }; extract?: unknown }> } } | null>,
    fetchJson(`${WD}?action=wbsearchentities&search=${encodeURIComponent(subject)}&language=en&type=item&format=json&limit=10`).catch(() => null) as Promise<{ search?: Array<{ id?: string; label?: string; description?: string }> } | null>,
  ]);
  // Either lookup failing is an error, never "no article": nothing may be
  // concluded about a name Wikimedia did not answer for.
  if (pageResult === null || searchResult === null) return { skipped: "error" };
  const page = Object.values(pageResult?.query?.pages ?? {})[0];
  // MediaWiki marks a disambiguation page with `disambiguation: ""` (an
  // empty string), and the page still has an item of its own: presence, not
  // truth, is the test.
  const disambiguation = Boolean(page && page.missing === undefined && page.pageprops !== undefined && "disambiguation" in page.pageprops);
  const pageItem = page && page.missing === undefined && !disambiguation && /^Q\d+$/.test(page.pageprops?.wikibase_item ?? "") ? page.pageprops!.wikibase_item! : null;
  const senses: Sense[] = (searchResult?.search ?? []).filter((r) => typeof r.id === "string" && /^Q\d+$/.test(r.id)).map((r) => ({ id: r.id!, label: r.label ?? "", description: r.description ?? "" }));
  const wanted = subject.trim().toLowerCase();
  const pageSense = pageItem ? senses.find((x) => x.id === pageItem) : undefined;
  const kindFit = (x: Sense) => (kind.trim() ? kindScore(kind, x.description) : 0);
  const fitting = senses.filter((x) => x.id !== pageItem && kindFit(x) > 0).sort((x, y) => kindFit(y) - kindFit(x));
  // One entity call for the page's item and the senses that fit the kind
  // best: another sense wins only when it fits the kind, the page's item
  // does not, and it has an English article (a museum object or a zoo
  // enclosure that happens to say "instrument" or "animal" never does).
  const exact = senses.filter((x) => x.label.toLowerCase() === wanted);
  const ids = [...new Set([...(pageItem ? [pageItem] : []), ...fitting.slice(0, 4).map((x) => x.id), ...(pageItem ? [] : exact.slice(0, 3).map((x) => x.id)), ...(pageItem || exact.length ? [] : senses.slice(0, 1).map((x) => x.id))])];
  // Nothing by this name at all: no Wikipedia page and no Wikidata item with
  // exactly this label (an item with no English article may be a person).
  const nothingByName = !pageItem && !disambiguation && exact.length === 0;
  if (ids.length === 0) return disambiguation ? { skipped: "ambiguous" } : { skipped: "no_article", nothingByName };
  type Ent = { claims?: Record<string, unknown[]>; sitelinks?: Record<string, { title?: string }>; labels?: Record<string, { value?: string }>; descriptions?: Record<string, { value?: string }>; aliases?: Record<string, Array<{ value?: string }>> };
  const response = await fetchJson(`${WD}?action=wbgetentities&ids=${ids.join("%7C")}&props=claims%7Csitelinks%7Clabels%7Cdescriptions%7Caliases&languages=${NAME_LANGUAGES}&sitefilter=enwiki&format=json`) as { entities?: Record<string, Ent> };
  const withArticle = (id: string) => Boolean(response.entities?.[id]?.sitelinks?.enwiki?.title);
  const pageFits = !kind.trim() || !pageSense || kindFit(pageSense) > 0;
  const fit = fitting.find((x) => withArticle(x.id));
  let chosen: string | null;
  let via: "wikipedia" | "kind" | "wikidata_search";
  if (pageItem && withArticle(pageItem) && (pageFits || !fit)) { chosen = pageItem; via = "wikipedia"; }
  else if (fit) { chosen = fit.id; via = "kind"; }
  else if (disambiguation) return { skipped: "ambiguous" };
  else { chosen = ids.find(withArticle) ?? null; via = "wikidata_search"; }
  if (!chosen) return { skipped: "no_article", nothingByName };
  const entity = response.entities![chosen]!;
  const title = entity.sitelinks!.enwiki!.title!;
  const claims = entity.claims ?? {};
  const birthDate = claimText(claims.P569?.[0]);
  const category = claimText(claims.P373?.[0]);
  const image = claimText(claims.P18?.[0]);
  const taxon = claimText(claims.P225?.[0]);
  const officialSite = claimText(claims.P856?.[0]);
  const nonPhotoFiles = NON_PHOTO_PROPERTIES.flatMap((prop) => (claims[prop] ?? []).map(claimText)).filter((f): f is string => typeof f === "string");
  const otherLabels = Object.entries(entity.labels ?? {}).filter(([lang]) => lang !== "en").map(([, l]) => l.value);
  // Other languages' aliases are left out: they carry bare words that name
  // other things too (Russian "панда" for the red panda).
  const allAliases = (entity.aliases?.en ?? []).map((a) => a.value);
  const aliases = [...new Set([...allAliases, taxon].filter((a): a is string => typeof a === "string" && a.trim().length > 0))].slice(0, 20);
  const labels = [...new Set(otherLabels.filter((a): a is string => typeof a === "string" && a.trim().length > 0))].slice(0, 20);
  const description = entity.descriptions?.en?.value ?? senses.find((x) => x.id === chosen)?.description ?? "";
  // R4: words that name the other things with this name, minus the chosen
  // thing's own words and the name itself ("programming", "language" for the
  // snake; "car", "marque" for the animal).
  const own = new Set([...words(description), ...words(subject), ...words(title)].flatMap(forms));
  // Name, list, disambiguation and paper entries are not other things a
  // picture could show; their words ("male", "given", "article") would only
  // sink right rows.
  const pictureable = (x: Sense) => !NOT_A_THING.test(x.description);
  const otherSenseWords = [...new Set(senses.filter((x) => x.id !== chosen && pictureable(x)).flatMap((x) => words(x.description)).filter((w) => !forms(w).some((f) => own.has(f))))].slice(0, 40);
  // R2: the subject's own page is another thing (or a disambiguation page):
  // ask the open web for the chosen item's own title ("Mercury (planet)").
  const queryTitle = via === "wikipedia" ? undefined : title;
  return { entity: {
    id: chosen,
    label: entity.labels?.en?.value ?? subject,
    description,
    human: (claims.P31 ?? []).some((value) => entityId(value) === "Q5"),
    ...((claims.P31 ?? []).some((value) => MEDIA_CLASSES.has(entityId(value) ?? "")) ? { media: true } : {}),
    ...(birthDate ? { birthDate } : {}),
    ...(category ? { commonsCategory: category } : {}),
    wikipediaTitle: title,
    ...(image ? { image } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(labels.length > 0 ? { otherLabels: labels } : {}),
    ...(officialSite && /^https?:\/\//.test(officialSite) ? { officialSite } : {}),
    ...(nonPhotoFiles.length > 0 ? { nonPhotoFiles } : {}),
    ...(via === "wikipedia" && typeof page?.extract === "string" ? { pageExtract: page.extract } : {}),
    ...(queryTitle ? { queryTitle } : {}),
    ...(otherSenseWords.length > 0 ? { otherSenseWords } : {}),
    resolvedVia: via,
  } };
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

type ImageInfoPage = { title?: string; categories?: Array<{ title?: string }>; imageinfo?: Array<{ url?: string; thumburl?: string; descriptionurl?: string; mime?: string; width?: number; extmetadata?: Record<string, { value?: unknown }> }> };

function splitPipes(value: unknown): string[] {
  return typeof value === "string" ? value.split("|").map((v) => v.trim()).filter(Boolean) : [];
}

function candidateFromPage(page: ImageInfoPage, leadName: string | undefined): WikimediaCandidate | null {
  const info = page.imageinfo?.[0];
  if (!page.title || !info?.mime || !PICTURE_MIME.has(info.mime)) return null;
  const url = info.thumburl ?? info.url;
  if (!url || !info.descriptionurl) return null;
  const meta = info.extmetadata ?? {};
  const short = plain(meta.LicenseShortName?.value, 60);
  const licenseUrl = typeof meta.LicenseUrl?.value === "string" && /^https?:\/\//.test(meta.LicenseUrl.value) ? meta.LicenseUrl.value : undefined;
  const artist = plain(meta.Artist?.value, 80);
  const visible = (page.categories ?? []).map((c) => (c.title ?? "").replace(/^Category:/i, "")).filter(Boolean);
  const categories = visible.length > 0 ? visible : splitPipes(meta.Categories?.value);
  const restrictions = splitPipes(meta.Restrictions?.value).map((r) => r.toLowerCase());
  const objectName = plain(meta.ObjectName?.value);
  return {
    url,
    page: info.descriptionurl,
    title: page.title.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, ""),
    description: plain(meta.ImageDescription?.value),
    ...(short ? { license: { short, ...(licenseUrl ? { url: licenseUrl } : {}), ...(artist ? { artist } : {}) } } : {}),
    lead: leadName !== undefined && fileKey(page.title) === fileKey(leadName),
    ...(objectName ? { objectName } : {}),
    ...(categories.length > 0 ? { categories } : {}),
    ...(restrictions.length > 0 ? { restrictions } : {}),
    ...(typeof info.width === "number" ? { width: info.width } : {}),
  };
}

/** Whether a candidate's file is one of the entity's non-photo files. */
export function isNonPhotoFile(entity: WikimediaEntity, candidate: { page: string }): boolean {
  if (!entity.nonPhotoFiles?.length) return false;
  const name = fileKey(decodeURIComponent(candidate.page.split("/File:")[1] ?? ""));
  return name.length > 0 && entity.nonPhotoFiles.some((f) => fileKey(f) === name);
}

// IMGQ-03: the same one call also returns what the relevance rules read: the
// file's own name, its Restrictions, its visible categories and its width.
const IMAGEINFO = "prop=imageinfo%7Ccategories&clshow=%21hidden&cllimit=max&iiprop=url%7Cmime%7Csize%7Cextmetadata&iiurlwidth=1280&iiextmetadatafilter=LicenseShortName%7CLicenseUrl%7CArtist%7CImageDescription%7CObjectName%7CCategories%7CRestrictions&format=json";

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
