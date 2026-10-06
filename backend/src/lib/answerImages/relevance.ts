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
};

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
const PERSONAL_WORDS = /\b(cosplay|cosplayer|cosplayers|cosplaying|fan art|fanart|fanmade|selfie|selfies|me with|my|mine|our|myself|wedding|birthday|meetup|convention|comic con|comiket|lego)\b|コスプレ|コミックマーケット/;

/** Words a caption uses when the picture is of people. For a thing (not a
 * person) such a picture is a photo of someone with the thing, often a
 * private person or a child ("Child plays video game on Nintendo Switch
 * while sitting on a couch", a Commons category member). */
const PEOPLE_WORDS = /\b(child|children|kid|kids|boy|boys|girl|girls|baby|toddler|teen|teenager|woman|women|people|family|crowd|visitors|tourists|couple|friend|friends|daughter|wife|husband|mom|mum|dad|mother|father|grandma|grandpa|students|shopper|shoppers|queue)\b/;

/** Words a caption uses for a screen capture, not a photo. */
const SCREENSHOT_WORDS = /\b(screenshot|screenshots|screen shot|screen capture|screencap|virtual desktop|desktop pet|application window|user interface|taskbar)\b|скриншот|スクリーンショット/;

/** Commons category stems for pictures that are not a photo of a thing as
 * such: costumes and fans, screen captures and scans, drawings and charts,
 * people and crowds (design section 8's closed list). Matched as whole words
 * at the start of a visible category ("Cosplayers at Comiket 97"). A stem
 * the subject's own name contains is exempt ("Logos" for a logo subject). */
const CATEGORY_STEMS = ["cosplay", "cosplayers", "costumes", "fan art", "selfies", "screenshots", "scans", "diagrams", "maps of", "logos", "icons", "charts", "signatures", "documents", "drawings", "sketches", "comics", "memes", "collages", "montages", "people at", "visitors", "audiences", "crowds", "conventions", "comiket", "wikimedians", "users", "flags of", "coats of arms"];
const PEOPLE_STEMS = new Set(["people at", "visitors", "audiences", "crowds", "conventions", "cosplayers", "selfies"]);

/** Picture kinds that are not a still photo. */
const NOT_STILL = /\.(svg|gif|tiff?|pdf|djvu|webm|mp4|ogv)(\?|$)/i;
const NOT_STILL_FORMATS = new Set(["svg", "gif", "tif", "tiff", "pdf", "djvu", "webm", "mp4"]);

/** Stock-photo preview hosts (watermarked previews). */
const STOCK_HOSTS = ["shutterstock.com", "gettyimages.com", "istockphoto.com", "adobestock.com", "stock.adobe.com", "alamy.com", "123rf.com", "dreamstime.com", "depositphotos.com"];

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
  const stem = CATEGORY_STEMS.find((st) => visible.some((cat) => cat.startsWith(` ${st} `)) && !names.some((n) => ` ${n} `.includes(` ${st} `)));
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
  }
  // The lead image is the article's own choice: the caption lists (English
  // words, and a lead's description is often in another language) never
  // judge it.
  if (c.lead) return null;
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
    // A4: the title names it; A5: the page or picture address names it;
    // A6: the page is the subject's official site or a Wikimedia page.
    const english = ctx.searchNames ?? names;
    if (namesSubject(c.title, english)) signals++;
    if (namesSubject(pathWords(c.page), english) || namesSubject(pathWords(c.image), english)) signals++;
    const host = hostOf(c.page);
    const official = ctx.officialSite ? hostOf(ctx.officialSite) : "";
    if ((official && (host === official || host.endsWith(`.${official}`))) || /(^|\.)(wikipedia|wikimedia)\.org$/.test(host)) signals++;
  }
  if (signals === 0) return "no_subject_match";
  if (signals < 2) return "one_signal";
  return null;
}
