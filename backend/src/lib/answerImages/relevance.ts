// ANSWER-IMG-05b and IMGQ-04 (design: data-scratch/research/
// image-quality-design.md sections 8 to 10): is this candidate a picture OF
// the subject, and a media picture rather than someone's own snapshot?
// Vetoes first (any one drops the candidate), then agreement: a candidate is
// kept only when two independent signals say it is of the subject (the
// article's own lead image needs nothing more). Deterministic reads of what
// the source itself publishes (Commons Restrictions, categories, file name
// and description; a search row's title, addresses and host). A
// media-quality filter, never the safety floor: the floor, the age gates and
// each band's sources stay in select.ts, and every rule here only removes.
// Nothing reads pixels or faces; nothing is learned. Every drop is counted
// on the call's admin-only trace by its reason key.
//
// Measured on the real pipeline (ANSWER-IMG-05, 2026-10-06, every tile
// opened by eye):
// - "David Blaine": Commons category member "Davidblaine03102003", no
//   description, showed London City Hall second in every set (one signal:
//   the category).
// - "Nintendo Switch": category members "コミックマーケット97 4日目
//   コスプレイヤー", "Cosplayers of Izumi Sagiri ...", "2018巴哈市集D區";
//   "Stranger Things": a Flickr "LEGO TBB Stranger Things Contest" build.
// - "red panda" (teen): "a virtual desktop red panda "sleeps" on an
//   application window", a desktop screenshot.

import { isAdultOnlyImageEngine } from "@/lib/searchEngines";

/** Why a candidate is left out: a fixed key, or `caption:<word>` and
 * `category:<stem>` for the closed word lists (one counter per word). */
export type RelevanceDrop = string;

export type RelevanceInput = {
  /** Where the candidate came from: the subject's own Commons category or
   * lead image ("wikimedia"), or the household's image search ("search"). */
  source: "wikimedia" | "search";
  lead: boolean;
  title: string;
  description: string;
  /** The page the picture sits on. */
  page: string;
  /** The picture's own address. */
  image: string;
  /** Commons: the file's own name field, visible categories, Restrictions. */
  objectName?: string;
  categories?: readonly string[];
  restrictions?: readonly string[];
  /** Stated by the source before any fetch: width, and a search row's format. */
  width?: number;
  format?: string;
  /** Wikidata names this file as the subject's logo, flag, map and so on. */
  nonPhoto?: boolean;
  /** Open-web rows: the search engines that returned it. */
  engines?: readonly string[];
};

export type RelevanceContext = {
  /** Every name the subject goes by, other languages' labels included. */
  names: readonly string[];
  /** The English names only, for open-web rows: another language's label
   * is often a common noun there (the Spanish label of the film "Jaws" is
   * "Tiburón", shark). Defaults to `names`. */
  searchNames?: readonly string[];
  subjectIsPerson: boolean;
  band: "adult" | "teen" | "child";
  /** The subject's Commons category (P373), if any. */
  commonsCategory?: string;
  /** The subject's official website (P856), if any. */
  officialSite?: string;
  /** Words from the descriptions of other things with the same name
   * (image-search accuracy study R4, built from Wikidata per subject). */
  otherSenseWords?: readonly string[];
  /** The subject's own Wikidata description ("smart speaker"): a word it
   * holds is the subject itself, never an object that replaces it. */
  description?: string;
};

/** Image-search accuracy study (data-scratch/research/
 * image-search-accuracy-study.md, 2026-10-06), R3: an engine's own weight
 * replaces SearXNG's merged order, which rewarded the keyword engines'
 * first rows (Bing's own top 6 was right 83% of the time; Flickr and
 * Openverse 37 to 43%). Yandex measured as accurate as Bing (an optional,
 * adult-only engine the household may enable in its own SearXNG). Engines
 * the study could not measure (they refused the instance) count 1: never
 * enough alone. */
const ENGINE_WEIGHTS: Record<string, number> = {
  "bing images": 2, "bing": 2, "yandex images": 2, "yandex": 2,
  "pinterest": 1, "duckduckgo images": 1, "google images": 1, "google cse images": 1, "brave.images": 1, "brave images": 1, "qwant images": 1,
  "wikicommons.images": 0, "wikimedia commons": 0, "wikicommons": 0,
  "flickr": -1, "openverse": -1,
};
/** R5: the score a row needs (in practice: a Bing or Yandex row whose title
 * names the subject and carries no other sense's word). */
export const SEARCH_KEEP_SCORE = 2.5;

/** R3 to R4: an open-web row's score. */
export function searchScore(c: Pick<RelevanceInput, "engines" | "title" | "page" | "image">, ctx: Pick<RelevanceContext, "names" | "searchNames" | "otherSenseWords">): { score: number; wrongSense: boolean } {
  const engines = (c.engines ?? []).map((e) => e.toLowerCase().trim());
  const weight = engines.length ? Math.max(...engines.map((e) => ENGINE_WEIGHTS[e] ?? 0)) : 0;
  const english = ctx.searchNames ?? ctx.names;
  const titleNames = namesSubject(c.title, english) ? 0.5 : 0;
  const text = `${normalizeForMatch(c.title)} ${normalizeForMatch(pathWords(c.page))} ${normalizeForMatch(pathWords(c.image))}`;
  const wrongSense = (ctx.otherSenseWords ?? []).some((w) => w.length >= 3 && text.includes(` ${w} `));
  return { score: weight + titleNames - (wrongSense ? 1 : 0), wrongSense };
}

/** Hosts where pictures are mostly people's own snapshots and posts. A
 * thing's row is never built from them (owner, 2026-10-06: general image
 * search for adults, but not a row of private people). */
const PERSONAL_HOSTS = [
  "flickr.com", "staticflickr.com", "instagram.com", "cdninstagram.com", "facebook.com", "fbcdn.net", "twitter.com", "x.com", "twimg.com",
  "tiktok.com", "pinterest.com", "pinimg.com", "reddit.com", "redd.it", "redditmedia.com", "tumblr.com", "deviantart.com", "deviantart.net",
  "blogspot.com", "blogger.com", "wordpress.com", "livejournal.com", "vk.com", "weibo.com", "threads.net", "bsky.app", "imgur.com",
  "500px.com", "smugmug.com", "photobucket.com", "medium.com", "substack.com", "ytimg.com", "youtube.com",
];

/** Words a caption uses for a person's own snapshot, a fan's costume or
 * build, or a meet-up crowd. Word-boundary matches on the normalised text. */
const PERSONAL_WORDS = /\b(cosplay|cosplayer|cosplayers|cosplaying|costume|costumes|costumed|fan art|fanart|fanmade|selfie|selfies|me with|my|mine|our|myself|wedding|birthday|meetup|convention|comic con|comiket|lego)\b|コスプレ|コミックマーケット/;

/** Words a caption uses when the picture is of people. For a thing (not a
 * person) such a picture is a photo of someone with the thing, often a
 * private person or a child ("Child plays video game on Nintendo Switch
 * while sitting on a couch", a Commons category member). */
const PEOPLE_WORDS = /\b(child|children|kid|kids|boy|boys|girl|girls|baby|toddler|teen|teenager|woman|women|people|family|crowd|visitors|tourists|couple|friend|friends|daughter|wife|husband|mom|mum|dad|mother|father|grandma|grandpa|students|shopper|shoppers|queue|fans|person)(s|es)?\b|\b(her|his) (device|phone|tablet|camera)\b|\b(booth|expo|gamescom)\b/;

/** For a person: words a caption uses when the picture is of a gathering
 * around them (fans at a trial, a protest), whose faces are strangers'. */
const GATHERING_WORDS = /\b(fan|fans|protest|protests|protester|protesters|protesting|supporters|demonstrators|demonstration|crowd|crowds|audience|mourners|rally)\b/;

/** IMGQ-05 follow-up (judged sample 2026-10-08): things a file shows instead
 * of the subject while still sitting in its category and naming it: a ticket
 * stub, a chart of its colours, the chip inside it, a sign about it, a part
 * of it, an advert that carries its name. Word matches on the text outside
 * the subject's own name and on the visible categories. A word the subject's
 * own name or Wikidata description holds is exempt ("Ticket to Ride", a
 * smart speaker). */
const OBJECT_WORDS = /\b(tickets?|stubs?|histograms?|charts?|signage|speakers?|headrests?|head restraints?|apu|wafers?|die shots?|ads|adverts?|advertisements?)\b/;

/** A place named by its distance from the subject: the picture is of what
 * is opposite it, not of it. */
const MILITARY_WORDS = /\b(sgt|sergeant|squadron|airman|petty officer|air force)\b/;
const OCCUPIES_SITE = /\boccup(?:y|ies|ied)\s+the\s+(?:location|site|spot|grounds?|land)\s+of\s+(?:the\s+)?(.*)$/;
const NEAR_PREPOSITIONS = ["opposite", "near", "nearby", "next to", "beside", "behind", "outside", "across from", "facing", "overlooking", "close to", "adjacent to", "view from", "seen from", "taken from"];

/** Words a caption uses for a screen capture, not a photo. */
const SCREENSHOT_WORDS = /\b(screenshot|screenshots|screen shot|screen capture|screencap|virtual desktop|desktop pet|application window|user interface|taskbar)\b|скриншот|スクリーンショット/;

/** Commons category stems for pictures that are not a photo of a thing as
 * such: costumes and fans, screen captures and scans, drawings and charts,
 * people and crowds (design section 8's closed list). Matched as whole words
 * at the start of a visible category ("Cosplayers at Comiket 97"). A stem
 * the subject's own name contains is exempt ("Logos" for a logo subject). */
const CATEGORY_STEMS = ["cosplay", "cosplayers", "costumes", "fan art", "selfies", "screenshots", "scans", "diagrams", "maps of", "logos", "icons", "charts", "signatures", "documents", "drawings", "sketches", "comics", "memes", "collages", "montages", "people at", "tourists", "visitors", "audiences", "crowds", "conventions", "comiket", "wikimedians", "users", "flags of", "coats of arms"];
/** Category stems for a thing's pictures of people with it (a person's own
 * pictures are filed under such categories as a matter of course). */
const THING_PEOPLE_STEMS = ["people with", "people in", "standing people", "sitting people"];
const PEOPLE_STEMS = new Set(["people at", "tourists", "visitors", "audiences", "crowds", "conventions", "cosplayers", "selfies"]);

/** Picture kinds that are not a still photo. */
const NOT_STILL = /\.(svg|gif|tiff?|pdf|djvu|webm|mp4|ogv)(\?|$)/i;
const NOT_STILL_FORMATS = new Set(["svg", "gif", "tif", "tiff", "pdf", "djvu", "webm", "mp4"]);

/** Stock-photo preview hosts (watermarked previews). */
// Study R6: an Etsy print was a held-out miss next to an Alamy preview.
const STOCK_HOSTS = ["etsy.com", "etsystatic.com", "shutterstock.com", "gettyimages.com", "istockphoto.com", "adobestock.com", "stock.adobe.com", "alamy.com", "123rf.com", "dreamstime.com", "depositphotos.com"];

/** Lowercase, accents off, camelCase (unless `splitCamel` is false) and
 * file separators split, every run of non-letters and non-digits one space,
 * padded so " x " matches whole words only. */
export function normalizeForMatch(text: string, splitCamel = true): string {
  const camel = splitCamel ? text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") : text;
  const split = camel.replace(/(\p{L})(\p{N})/gu, "$1 $2").replace(/(\p{N})(\p{L})/gu, "$1 $2");
  const plain = split.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return ` ${plain} `;
}

/** The names a picture may call the subject by, each in its camelCase-split
 * and unsplit forms ("PlayStation 5" is both "play station 5" and
 * "playstation 5", the way a lowercase address spells it). `primary` (the
 * model's own words, the Wikidata label) are kept from two characters up
 * ("BMW", "U2"); `aliases` (other names, the taxon name) only from four
 * letters, being easier to collide with. */
export function subjectNames(primary: readonly (string | undefined)[], aliases: readonly (string | undefined)[] = []): string[] {
  const out = new Set<string>();
  const add = (name: string | undefined, min: number) => {
    if (!name) return;
    for (const n of [normalizeForMatch(name).trim(), normalizeForMatch(name, false).trim()]) if (n.replace(/ /g, "").length >= min) out.add(n);
  };
  for (const name of primary) add(name, 2);
  for (const name of aliases) add(name, 4);
  return [...out];
}

/** Whether `text` names the subject as whole words (a plural "s" or "es"
 * is allowed: "3 red pandas play-fighting" names "red panda"), in either
 * the camelCase-split or the unsplit spelling. */
export function namesSubject(text: string, names: readonly string[]): boolean {
  if (!text) return false;
  const hays = [normalizeForMatch(text), normalizeForMatch(text, false)];
  return names.some((name) => hays.some((hay) => hay.includes(` ${name} `) || hay.includes(` ${name}s `) || hay.includes(` ${name}es `)));
}

function withoutNames(normalized: string, names: readonly string[]): string {
  let out = normalized;
  for (const name of names) out = out.split(` ${name} `).join("  ");
  return out;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function onHost(host: string, list: readonly string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

/** The address's path and file name as words ("/stranger-things-season-5/"
 * reads "stranger things season 5"). */
function pathWords(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname).replace(/\.[a-z0-9]{2,5}$/i, "");
  } catch {
    return "";
  }
}

function firstWord(re: RegExp, text: string): string | null {
  const m = re.exec(text);
  return m ? m[0].trim() : null;
}

/** The words of the subject's own Wikidata description, singular forms. */
function ownWords(ctx: RelevanceContext): Set<string> {
  return new Set(normalizeForMatch(ctx.description ?? "").split(" ").filter(Boolean).map((w) => w.replace(/s$/, "")));
}

/** The first match of `re` in `text` that the subject itself does not use. */
function firstUnexempt(re: RegExp, text: string, own: ReadonlySet<string>): string | null {
  const global = new RegExp(re.source, "g");
  for (const m of text.matchAll(global)) {
    const word = m[0].trim();
    if (!word.split(" ").every((w) => own.has(w.replace(/s$/, "")))) return word;
  }
  return null;
}

/** Null when the candidate may be shown, else the reason it may not. */
export function judgeRelevance(c: RelevanceInput, ctx: RelevanceContext): RelevanceDrop | null {
  const { names, subjectIsPerson } = ctx;
  // Vetoes. The lead image is the article's own choice and is exempt from
  // the agreement count, not from the vetoes on what kind of file it is.
  if (c.nonPhoto) return "non_photo_property";
  if ((c.format && NOT_STILL_FORMATS.has(c.format)) || NOT_STILL.test(c.image)) return "not_still_raster";
  if (c.width !== undefined && c.width > 0 && c.width < 200) return "api_size";
  const restrictions = (c.restrictions ?? []).map((r) => r.toLowerCase());
  if (restrictions.some((r) => r === "costume" || r === "fan-art" || r === "2257")) return "restriction";
  const visible = (c.categories ?? []).map((cat) => withoutNames(normalizeForMatch(cat), names));
  const stem = [...CATEGORY_STEMS, ...(subjectIsPerson ? [] : THING_PEOPLE_STEMS)].find((st) => visible.some((cat) => cat.startsWith(` ${st} `)) && !names.some((n) => ` ${n} `.includes(` ${st} `)));
  if (restrictions.includes("personality")) {
    if (!subjectIsPerson) return "personality_rights";
    // A teen: a person's picture that is also filed under a crowd or
    // people category is left out (design section 10).
    if (ctx.band !== "adult" && stem && PEOPLE_STEMS.has(stem)) return "personality_rights";
  }
  if (stem) return `category:${stem}`;
  if (c.source === "search") {
    if (onHost(hostOf(c.page), PERSONAL_HOSTS) || onHost(hostOf(c.image), PERSONAL_HOSTS)) return "personal_host";
    if (onHost(hostOf(c.page), STOCK_HOSTS) || onHost(hostOf(c.image), STOCK_HOSTS)) return "stock_preview";
    if (ctx.band !== "adult" && (c.engines ?? []).some(isAdultOnlyImageEngine)) return "adult_only_engine";
  }
  // The lead image is the article's own choice: the caption lists (English
  // words, and a lead's description is often in another language) never
  // judge it.
  // A category naming an object that replaces the subject ("Basketball
  // tickets", "Turkish Airlines advertisements") is English on every file.
  const own = ownWords(ctx);
  const objectCategory = visible.map((cat) => firstUnexempt(OBJECT_WORDS, cat, own)).find((w) => w !== null);
  if (objectCategory) return `object:${objectCategory}`;
  if (c.lead) {
    // The file name is the one text of a lead that is not in another
    // language: a lead named for a crowd or a ticket is still not the thing
    // ("Bluey entertains the crowds at Under 5s Day").
    const leadName = withoutNames(normalizeForMatch(c.title), names);
    const leadObject = firstUnexempt(OBJECT_WORDS, leadName, own);
    if (leadObject) return `object:${leadObject}`;
    if (!subjectIsPerson) {
      const people = firstWord(PEOPLE_WORDS, leadName);
      if (people) return `caption:${people}`;
    }
    return null;
  }
  const words = `${c.title} ${c.objectName ?? ""} ${c.description}`;
  // The subject's own name never counts against it ("My Little Pony",
  // "LEGO Batman", "Windows user interface").
  const said = withoutNames(normalizeForMatch(words), names);
  const path = c.source === "search" ? withoutNames(normalizeForMatch(pathWords(c.page)), names) : "";
  const screen = firstWord(SCREENSHOT_WORDS, said);
  if (screen) return `caption:${screen}`;
  const personal = firstWord(PERSONAL_WORDS, said) ?? firstWord(PERSONAL_WORDS, path);
  if (personal) return `caption:${personal}`;
  if (!subjectIsPerson) {
    const people = firstWord(PEOPLE_WORDS, said);
    if (people) return `caption:${people}`;
  } else {
    const gathering = firstUnexempt(GATHERING_WORDS, said, own);
    if (gathering) return `crowd:${gathering}`;
    // A serviceman of the same name ("Senior Master Sgt. Michael Jackson").
    const serving = firstUnexempt(MILITARY_WORDS, said, own);
    if (serving) return `namesake:${serving}`;
  }
  const object = firstUnexempt(OBJECT_WORDS, said, own);
  if (object) return `object:${object}`;
  if (c.source === "wikimedia") {
    const hay = normalizeForMatch(words);
    const near = NEAR_PREPOSITIONS.find((prep) => names.some((n) => hay.includes(` ${prep} ${n} `) || hay.includes(` ${prep} the ${n} `)));
    if (near) return `near:${near}`;
    // A building that now stands where the subject's old ground was.
    const onSite = OCCUPIES_SITE.exec(hay)?.[1];
    if (onSite !== undefined && names.some((n) => onSite.trimStart().startsWith(n.trim()))) return "near:occupy";
  }
  // Agreement: two independent signals that the picture is of the subject.
  let signals = 0;
  if (c.source === "wikimedia") {
    // A2: filed in the subject's own category (how the candidate was found)
    // or a visible category that names it; A3: its name or description
    // names it.
    const category = ctx.commonsCategory ? normalizeForMatch(ctx.commonsCategory).trim() : null;
    const inCategory = c.categories === undefined || c.categories.length === 0
      ? true
      : c.categories.some((cat) => (category !== null && normalizeForMatch(cat).trim() === category) || namesSubject(cat, names));
    if (inCategory) signals++;
    if (namesSubject(words, names)) signals++;
  } else {
    // Study R3 to R5 (replacing the path signal, which the study found adds
    // nothing once the engine is weighted): engine weight, the title naming
    // the subject, no other sense's words.
    const { score, wrongSense } = searchScore(c, ctx);
    if (score >= SEARCH_KEEP_SCORE) return null;
    return wrongSense ? "wrong_sense" : "below_search_score";
  }
  if (signals === 0) return "no_subject_match";
  if (signals < 2) return "one_signal";
  return null;
}
