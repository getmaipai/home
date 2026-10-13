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
  /** IMGQ-10: Commons structured data says the file depicts the subject (P180). It stands in for the category
   * signal in the agree count and nothing else: it never skips a veto or a naming rule. */
  depicts?: boolean;
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
  /** IMGQ-07: what the model said the thing is ("e-reader", "ruins"), and whether Wikidata calls it a film, show,
   * game or franchise. They decide only which extra checks apply to a non-person subject. */
  kind?: string;
  media?: boolean;
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
const PERSONAL_WORDS = /\b(cosplay|cosplayer|cosplayers|cosplaying|costume|costumes|costumed|fan art|fanart|fanmade|selfie|selfies|me with|my|mine|our|myself|wedding|birthday|meetup|convention|megacon|mediedager|comic con|comiket|lego)\b|コスプレ|コミックマーケット/;

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

/** IMG-QUALITY-01a: a record label, a disc or a sleeve is a scan of a product, not a photo of a person or a thing
 * (a "white label" disc scan came up as a person's second picture). A closed vocabulary read from the file's own
 * title, name, description and visible categories (never the person's message), the same way as the lists above.
 * A word the subject's own name or Wikidata description holds is exempt (a record label, an album). A lead image
 * is the article's own choice and is not judged by it. */
const DISC_WORDS = /\b(vinyl|white labels?|record labels?|record sleeves?|picture sleeves?|record discs?|album covers?|cd covers?|compact discs?|45 rpm|78 rpm)\b/

/** IMGQ-07 (judged sample 2026-10-12): the kinds the extra checks apply to. A product is something sold or made
 * ("e-reader", "game console", "phone"), a site is a place or building, a franchise is a film, show or game
 * (also any subject Wikidata marks as media). Read from the model's own `kind` word, a closed list. */
const PRODUCT_KIND = /\b(phones?|smartphones?|consoles?|e-?readers?|tablets?|laptops?|computers?|devices?|gadgets?|products?|appliances?|headphones?|earbuds?|watch(?:es)?|speakers?|cameras?|toys?|brands?)\b/i;
const SITE_KIND = /\b(ruins?|towers?|bridges?|temples?|parks?|buildings?|mausoleums?|skyscrapers?|canyons?|landmarks?|monuments?|castles?|palaces?|sites?|cathedrals?|churches|mosques?|pyramids?|museums?|stadiums?|mountains?|waterfalls?|lakes?|islands?)\b/i;
const FRANCHISE_KIND = /\b(films?|movies?|series|shows?|franchises?|video games?|games?|cartoons?|anime|sitcoms?)\b/i;

/** IMGQ-07 A2: a closed vocabulary of the off-focus files the judged sample showed in a subject's category while
 * naming it (a brick wall detail, a parody cinema marquee, a courtyard, factory workers assembling the product).
 * Read from the file's title, name, description and visible categories, outside the subject's own name; a
 * subject whose own name or Wikidata description holds the word is exempt. Each reason is its own counter. */
const OFF_FOCUS: ReadonlyArray<[reason: string, re: RegExp]> = [
  ["wall_detail", /\b(wall details?|brick walls?|wall textures?|drain ?pipes?|downspouts?)\b/],
  ["parody", /\b(parody|parodies|covid wars|marquees?|kinoprogramm)\b/],
  ["courtyard", /\bcourtyards?\b/],
  ["factory_workers", /\b(factory|factories|factory workers?|assembly lines?|production lines?|pemasangan|pembuatan)\b/],
];

/** IMGQ-07 A3: for a product, a picture of a named person using it or teaching with it is a private person's
 * photo whatever the caption's other words (the Kindle 2 workshop). Closed list of activity words. */
const PERSON_WITH_PRODUCT = /\b(taught|teaches|teaching|workshop|workshops|specialist|instructor|presenter|presenting|demonstrates|demonstrating|holding|holds|poses|posing)\b/;

/** A place named by its distance from the subject: the picture is of what
 * is opposite it, not of it. */
const MILITARY_WORDS = /\b(sgt|sergeant|squadron|airman|petty officer|air force)\b/;
const OCCUPIES_SITE = /\boccup(?:y|ies|ied)\s+the\s+(?:location|site|spot|grounds?|land)\s+of\s+(?:the\s+)?(.*)$/;
const NEAR_PREPOSITIONS = ["opposite", "near", "nearby", "next to", "beside", "behind", "outside", "across from", "facing", "overlooking", "close to", "adjacent to", "view from", "seen from", "taken from", "in front of", "past"];
/** IMGQ-10: "Champ de Mars from the Eiffel Tower" is a view from the subject, not of it. A thing only: a
 * person is quoted ("a letter from Einstein"). */
const THING_NEAR_PREPOSITIONS = ["from"];

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
const THING_PEOPLE_STEMS = ["people with", "people in", "standing people", "sitting people", "standing men", "standing women", "sitting men", "sitting women"];

/** IMGQ-10: words that put a minor in the frame, read from the file's description and visible categories (the
 * judged sample's Obama family photo sat in "Malia Obama in 2011"). A closed list, one counter per word
 * (`minor:<word>`); a word the subject's own name or description holds is exempt. Only ever removes. */
const MINOR_WORDS = /\b(child|children|kid|kids|boy|boys|girl|girls|baby|babies|toddler|toddlers|teen|teens|teenager|teenagers|daughter|daughters|son|sons|pupil|pupils|schoolchildren|schoolboy|schoolgirl)\b/;

/** IMGQ-10: a Commons category of the form "<Name Name> in <year or place>" is a person's (or a landmark's) own
 * category. On a person's picture, one that does not name the subject says another person is in the frame
 * ("Michelle Obama in 2011" beside "Barack Obama in Brazil"). Read from the category's own shape, no list. */
const NAME_IN_CATEGORY = /^(\p{Lu}[\p{L}'.-]+(?: \p{Lu}[\p{L}'.-]+)+) in (?:\d{4}|[\p{Lu}])/u;
const PEOPLE_STEMS = new Set(["people at", "tourists", "visitors", "audiences", "crowds", "conventions", "cosplayers", "selfies"]);

/** SEARCH-ANSWER-09: words that say the picture is a made image, not a photograph. A closed list, one counter per
 * word (`caption:<word>`). A subject that holds the word itself ("drawings of X") or whose own Wikidata description
 * holds it (the Mona Lisa is a painting) is exempt. Only ever removes. */
const ART_WORDS = /\b(drawings?|drawn|paintings?|sketch(?:es)?|caricatures?|illustrations?)\b/;
function artRoot(word: string): string {
  const w = word === "drawn" ? "drawing" : word.endsWith("ches") ? word.slice(0, -2) : word.replace(/s$/, "");
  return w;
}

/** SEARCH-ANSWER-09: how a caption names a person only through a relative or a companion ("Janet Jackson, sister
 * of Michael Jackson", "Fan with Michael Jackson"). Closed list of relation words, one counter per word. */
const RELATIVE_WORDS = ["sister", "brother", "wife", "husband", "son", "daughter", "mother", "father", "with"];

/** The relation word when the subject appears in `text` only as "<relation> of <subject>" or "with <subject>". */
function onlyAsRelative(text: string, names: readonly string[]): string | null {
  const hay = normalizeForMatch(text);
  for (const rel of RELATIVE_WORDS) {
    const lead = rel === "with" ? "with" : `${rel} of`;
    let rest = hay;
    let hit = false;
    for (const name of names) {
      for (const the of ["", "the "]) {
        const phrase = ` ${lead} ${the}${name} `;
        if (rest.includes(phrase)) { hit = true; rest = rest.split(phrase).join("  "); }
      }
    }
    if (hit && !namesSubject(rest, names)) return rel === "with" ? "with" : `${rel} of`;
  }
  return null;
}

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

/** IMGQ-08: the title holds a name of the subject (five letters or more) only inside a longer word. */
function gluedName(title: string, names: readonly string[]): boolean {
  if (!title || namesSubject(title, names)) return false;
  const hay = normalizeForMatch(title, false);
  // Swallowed inside a word ("bTaj Mahal"): a letter sits right before the name. A derived word that merely
  // begins with it ("Parisian", "Japanese") is ordinary and is not this.
  return names.some((n) => {
    if (n.replace(/ /g, "").length < 5) return false;
    const at = hay.indexOf(n);
    return at > 0 && hay[at - 1] !== " ";
  });
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
  // IMGQ-08: on Commons a PNG that is not the article's lead is nearly always a screenshot, signature, diagram or
  // scan (measured: 4 of the 8 visible non-lead PNGs in the judged sample were that, 1 was junk). Photos are JPEG.
  if (c.source === "wikimedia" && !c.lead && /\.png$/i.test(c.page)) return "png_not_photo";
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
  // IMGQ-07 A1: for a franchise, a product or a site the file's own title, name or description must say the
  // subject's name (the category alone put a station, a pasture and a parody under their subjects).
  const kind = ctx.kind ?? "";
  const isProduct = !subjectIsPerson && PRODUCT_KIND.test(kind);
  const mustName = !subjectIsPerson && (ctx.media === true || isProduct || SITE_KIND.test(kind) || FRANCHISE_KIND.test(kind));
  if (mustName && !namesSubject(words, names)) return "subject_not_named";
  // IMGQ-08 M1: a Commons file whose own title holds the subject's name only inside other letters ("Banke
  // bTaj Mahalihari (219)": a bulk rename that swallowed the name) is a mangled title; the description a bulk
  // upload copies from the category ("Taj Mahal") is then no evidence. Open-web rows are scored by their engines.
  if (c.source === "wikimedia" && !subjectIsPerson && gluedName(c.title, names)) return "title_name_glued";
  // The subject's own name never counts against it ("My Little Pony",
  // "LEGO Batman", "Windows user interface").
  const said = withoutNames(normalizeForMatch(words), names);
  const path = c.source === "search" ? withoutNames(normalizeForMatch(pathWords(c.page)), names) : "";
  const offFocus = OFF_FOCUS.find(([, re]) => {
    const hit = firstUnexempt(re, said, own) ?? visible.map((cat) => firstUnexempt(re, cat, own)).find((w) => w !== null) ?? null;
    return hit !== null && !names.some((n) => ` ${n} `.includes(` ${hit} `) || n.split(" ").includes((hit.split(" ")[0] ?? "").replace(/s$/, "")));
  });
  if (offFocus && !subjectIsPerson) return `off_focus:${offFocus[0]}`;
  if (isProduct && firstUnexempt(PERSON_WITH_PRODUCT, said, own)) return "private_person";
  const screen = firstWord(SCREENSHOT_WORDS, said);
  if (screen) return `caption:${screen}`;
  const art = firstUnexempt(ART_WORDS, said, own);
  if (art) {
    const root = artRoot(art);
    if (!names.some((n) => n.split(" ").some((w) => artRoot(w) === root))) return `caption:${art}`;
  }
  if (subjectIsPerson) {
    const relative = onlyAsRelative(words, names);
    if (relative) return `caption:${relative}`;
  }
  const disc = firstUnexempt(DISC_WORDS, said, own) ?? visible.map((cat) => firstUnexempt(DISC_WORDS, cat, own)).find((w) => w !== null) ?? null;
  if (disc) return "disc_or_label";
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
  const minor = !subjectIsPerson ? null : firstUnexempt(MINOR_WORDS, said, own) ?? visible.map((cat) => firstUnexempt(MINOR_WORDS, cat, own)).find((w) => w !== null) ?? null;
  if (minor) return `minor:${minor}`;
  // A surname alone ("Obama") also names Michelle Obama: the full name is what tells the two apart.
  const fullNames = names.some((n) => n.includes(" ")) ? names.filter((n) => n.includes(" ")) : names;
  if (subjectIsPerson && (c.categories ?? []).some((cat) => {
    const m = NAME_IN_CATEGORY.exec(cat);
    return m !== null && !namesSubject(m[1]!, fullNames);
  })) return "category_person";
  const object = firstUnexempt(OBJECT_WORDS, said, own);
  if (object) return `object:${object}`;
  if (c.source === "wikimedia") {
    const hay = normalizeForMatch(words);
    const near = [...NEAR_PREPOSITIONS, ...(subjectIsPerson ? [] : THING_NEAR_PREPOSITIONS)].find((prep) => names.some((n) => hay.includes(` ${prep} ${n} `) || hay.includes(` ${prep} the ${n} `)));
    if (near) return `near:${near}`;
    // A building that now stands where the subject's old ground was.
    const onSite = OCCUPIES_SITE.exec(hay)?.[1];
    if (onSite !== undefined && names.some((n) => onSite.trimStart().startsWith(n.trim()))) return "near:occupy";
  }
  // IMGQ-08 M2: a file whose own title and object name leave the subject out, filed in three or more categories of
  // which at most one names it, is a picture of something else that lists the subject among many ("IT-Zeux im MUC-office"
  // sits in 'Amazon Kindle' beside three office categories; 'Sushi' beside two in-flight meal categories). The curator's tag is a mention, not the subject.
  if (c.source === "wikimedia" && !c.lead && !subjectIsPerson && (c.categories?.length ?? 0) >= 3
    && !namesSubject(`${c.title} ${c.objectName ?? ""}`, names)
    && c.categories!.filter((cat) => namesSubject(cat, names)).length <= 1) return "crowded_categories";
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
    // IMGQ-10: structured data stands in for the category only when the file's own title or name also says the
    // subject (a photo "taken with an iPhone" depicts one without being of it).
    if (inCategory || (c.depicts === true && namesSubject(`${c.title} ${c.objectName ?? ""}`, names))) signals++;
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

/** IMGQ-07 A4: a candidate that passed every rule above but whose own description is a list of things with the
 * subject somewhere in the middle of it ("Home delivery of cooked foods machine, ramen, sushi, soba, udon",
 * "Smartphones, PCs, a Kindle, memory sticks etc."): at least three commas and the subject's first mention after
 * the second comma. The row keeps its first three pictures whatever their evidence; a weak one after that is left
 * out instead of filling a tile (five tiles are a ceiling, not a target). Deliberately narrow: the offline replay
 * of the judged sample showed the broader "description never names the subject" shape cost far more right tiles
 * than wrong ones. A hashtag list is the uploader's tags, not a list of things, and is exempt. Open-web rows are
 * scored by the engine weights above and are never weak here; a lead image is the article's own choice. */
export function isWeakEvidence(c: Pick<RelevanceInput, "source" | "lead" | "description">, ctx: Pick<RelevanceContext, "names">): "description_list" | null {
  if (c.lead || c.source !== "wikimedia") return null;
  const description = c.description.trim();
  if (!description || description.includes("#")) return null;
  const parts = description.split(",");
  if (parts.length < 4) return null;
  const first = parts.findIndex((part) => namesSubject(part, ctx.names));
  // IMGQ-08 M3: a list of five or more with the subject second ("Home delivery of cooked foods machine, ramen,
  // sushi, soba, udon") is the same shape: the picture shows the first thing, the subject is one of its tags.
  return first >= 2 || (first >= 1 && parts.length >= 5) ? "description_list" : null;
}
