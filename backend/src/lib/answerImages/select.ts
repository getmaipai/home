// ANSWER-IMG-02: which pictures an answer may carry, per age band (design:
// data-scratch/research/chat-images-in-answers.md sections 3, 6 and 9). The
// model only names a subject (`show_images`); every decision below is data:
// Wikidata says whether the subject is a person and how old, the band says
// which sources may be asked, the floor reads the subject and every caption,
// and ANSWER-IMG-00/01's filter and proxy decide what is a real picture.
// No word rule, no learned component, no face comparison anywhere.
import sharp from "sharp";
import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";
import { speakerNamedAny } from "@/lib/subjects";
import { answerImageSearch, type SearxngImageRow } from "@/lib/packageHost";
import type { AgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import type { AnswerImageItem, AnswerImageSet } from "@/wire";
import { fetchAnswerImages, type AnswerImageSource } from "./fetch";
import { putAnswerImage } from "./cache";
import { ANSWER_IMAGES_MAX_CANDIDATES, GALLERY_VISIBLE, type ShownPictures } from "./gallery";
import { warmGeometry } from "@/lib/imageSimilarity";
import { judgeRelevance, searchScore, subjectNames, type RelevanceDrop } from "./relevance";
import { isNonPhotoFile, isUnder18, resolveWikimediaSubject, wikimediaCandidates, wikimediaFetchJson, type FetchJson, type WikimediaEntity } from "./wikimedia";

/** Kinds the model uses for a person (its own `kind` argument, never the
 * person's message): with no Wikipedia article such a name may be a private
 * person, so there are no pictures. */
const PERSON_KIND = new RegExp(`\\b(${["person", "people", "human", "man", "woman", "men", "women", "guy", "lady", "boy", "girl", "child", "children", "kid", "baby", "teen", "teenager", "adult", "actor", "actress", "singer", "musician", "band", "member", "rapper", "dj", "athlete", "player", "footballer", "cricketer", "golfer", "gymnast", "boxer", "wrestler", "racer", "driver", "coach", "politician", "president", "senator", "mayor", "celebrity", "influencer", "youtuber", "streamer", "tiktoker", "podcaster", "blogger", "vlogger", "author", "writer", "poet", "journalist", "reporter", "presenter", "host", "comedian", "artist", "painter", "photographer", "designer", "model", "dancer", "chef", "cook", "doctor", "nurse", "scientist", "engineer", "lawyer", "teacher", "professor", "student", "pupil", "classmate", "coworker", "colleague", "boss", "employee", "neighbou?r", "friend", "girlfriend", "boyfriend", "partner", "wife", "husband", "spouse", "mom", "mum", "mother", "dad", "father", "parent", "son", "daughter", "brother", "sister", "sibling", "cousin", "aunt", "uncle", "grandma", "grandpa", "grandparent", "relative", "family", "someone", "somebody", "character", "magician", "entrepreneur", "ceo", "founder", "billionaire", "priest", "pastor", "king", "queen", "prince", "princess", "soldier", "officer", "pilot", "astronaut"].join("|")})(s|es)?\\b`, "i");

const MAX_CANDIDATES = ANSWER_IMAGES_MAX_CANDIDATES;
const CAPTION_MAX = 140;

export type AnswerImageDeps = {
  fetchJson?: FetchJson;
  imageSearch?: (query: string, actor: PersonRow, band: AgeBand) => Promise<SearxngImageRow[]>;
  fetchOptions?: Parameters<typeof fetchAnswerImages>[1];
  now?: () => Date;
};

let testDeps: AnswerImageDeps = {};
/** Tests swap the outside world (Wikimedia, SearXNG, picture hosts) for fixtures. */
export function __setAnswerImageDepsForTests(deps: AnswerImageDeps | null): void { testDeps = deps ?? {}; }

/** Why a call produced no pictures, counted on the trace (a rule has a counter). */
export type AnswerImageSkip = "empty_subject" | "household_name" | "floor_subject" | "no_article" | "ambiguous" | "minor_subject" | "no_candidates" | "none_survived" | "error";

export type AnswerImageTrace = {
  subject: string;
  /** How the subject's item was chosen (study R1) and what the open web was
   * asked for (R2). */
  resolved_via?: "wikipedia" | "kind" | "wikidata_search" | "no_article_search";
  search_query?: "subject" | "wikipedia_title";
  /** "search" when the open web leads (a film, show, game or character). */
  leading_source?: "search";
  skipped?: AnswerImageSkip;
  sources?: { wikimedia: number; searxng: number };
  dropped_by_floor?: number;
  /** ANSWER-IMG-05b, IMGQ-04: left out before any fetch as not of the
   * subject, or not a media picture, by reason key. */
  dropped_by_relevance?: Record<RelevanceDrop, number>;
  /** IMGQ-04: search pictures not used because Commons had three good ones. */
  search_not_needed?: number;
  /** Search candidates never fetched because six Commons candidates passed
   * the rules first (the row may still end short of three after the fetch:
   * a privacy-first trade, no picture host is asked for a picture that would
   * most likely be thrown away). */
  search_held_back?: number;
  dropped_by_fetch?: Record<string, number>;
  dropped_by_quality?: Record<string, number>;
  /** IMGSIM-01's counts for the duplicate check (pairs, same pixels,
   * verified, merged, left unverified by the deadline, failed). */
  duplicate_check?: Record<string, number>;
  shown?: number;
  /** IMG-QUALITY-01b: candidates dropped before the fetch (source address already shown in this conversation) plus
   * fetched pictures dropped after decode (picture id already shown). A count; never ids or addresses. */
  excluded_already_shown?: number;
};

export type AnswerImageSelection = { set: Omit<AnswerImageSet, "after_paragraph"> | null; trace: AnswerImageTrace };

type Candidate = {
  url: string;
  page: string;
  title: string;
  description: string;
  license?: AnswerImageItem["license"];
  lead: boolean;
  source: "wikimedia" | "search";
  objectName?: string;
  categories?: string[];
  restrictions?: string[];
  width?: number;
  format?: string;
  nonPhoto?: boolean;
  /** Open-web rows: the engines that returned it, and its stated short side. */
  engines?: string[];
  shortSide?: number;
};

/** "1920x1080" or "1920 x 1080" to its size. */
function sizeOfResolution(resolution: string | undefined): { width: number; height: number } | undefined {
  const m = resolution ? /^\s*(\d{1,5})\s*[x×]\s*(\d{1,5})\s*$/i.exec(resolution) : null;
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

/** At most this many of the fetch slots from one source, so one source
 * cannot crowd out the other (IMGQ-04). */
const PER_SOURCE_SLOTS = GALLERY_VISIBLE * 2 + 2;
/** Commons pictures that make the open web unnecessary (the coordinator's
 * decision on the design's recommended option, 2026-10-06, under the owner's
 * ruling that adults may get general image search: search fills a row only
 * when Commons has fewer good ones than the row has tiles). */
const COMMONS_ENOUGH = GALLERY_VISIBLE;

const trips = (text: string, band: AgeBand): boolean => text.trim().length > 0 && checkSafety(text, { isMinor: band !== "adult" }).flagged;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The pictures for `subject` that `actor` (in `band`) may see. Never
 * throws: any failure is no pictures (rule 6). `deadlineAt` is when the
 * picture fetch must stop so the set is ready inside the turn's budget. */
export async function selectAnswerImages(input: { subject: string; kind?: string; actor: PersonRow; band: AgeBand; roster: readonly string[]; deadlineAt?: number; shown?: ShownPictures }): Promise<AnswerImageSelection> {
  const subject = input.subject.trim().slice(0, 200);
  const trace: AnswerImageTrace = { subject };
  const skip = (why: AnswerImageSkip): AnswerImageSelection => ({ set: null, trace: { ...trace, skipped: why } });
  if (!subject) return skip("empty_subject");
  // Rule 1's deterministic household-name list: a family member's name never
  // leaves the house as a picture query.
  if (input.roster.length > 0 && speakerNamedAny(subject, input.roster)) return skip("household_name");
  if (trips(subject, input.band)) return skip("floor_subject");
  // The duplicate check's feature matcher loads while Wikidata answers.
  warmGeometry();
  const deps = { ...testDeps };
  const fetchJson = deps.fetchJson ?? wikimediaFetchJson;
  const imageSearch = deps.imageSearch ?? ((query: string, actor: PersonRow, band: AgeBand) => answerImageSearch(query, actor, band));
  const now = deps.now ?? (() => new Date());
  try {
    const kind = (input.kind ?? "").trim().slice(0, 80);
    const resolved = await resolveWikimediaSubject(subject, fetchJson, kind);
    // Owner ruling 11 (2026-10-06): an adult asking about a thing with no
    // Wikipedia article gets open-web pictures under the same rules. People
    // (a name with no article may be a private person), anything the model
    // calls a person, a missing kind, and minors keep the article gate.
    const searchOnly = "skipped" in resolved && resolved.skipped === "no_article" && resolved.nothingByName === true && input.band === "adult" && kind.length > 0 && !PERSON_KIND.test(kind);
    if ("skipped" in resolved && !searchOnly) return skip(resolved.skipped);
    const entity: WikimediaEntity = "entity" in resolved ? resolved.entity : { id: "", label: subject, description: "", human: false, wikipediaTitle: "", resolvedVia: "no_article_search" };
    if (entity.resolvedVia) trace.resolved_via = entity.resolvedVia;
    if (trips(`${entity.label}. ${entity.description}`, input.band)) return skip("floor_subject");
    if (entity.human && (entity.birthDate === undefined ? false : isUnder18(entity.birthDate, now()))) return skip("minor_subject");

    // Wikimedia (sources 1 and 2): adults; a teen only once the article's own
    // text passed the floor; never a child (Wikimedia has no safe filter).
    // A person with no birth date on record gets the lead image only.
    const fromWikimedia = async (): Promise<Candidate[]> => {
      if (!entity.id) return [];
      let allowed = input.band === "adult";
      if (input.band === "teen") {
        // The page's own intro came with the lookup; when the item is not the
        // subject's own page there is none, and a teen gets no Wikimedia
        // pictures (the call budget stays at four).
        const extract = entity.pageExtract ?? null;
        allowed = extract !== null && extract.trim().length > 0 && !trips(extract, "teen");
      }
      if (!allowed) return [];
      const found = await wikimediaCandidates(entity, fetchJson, { leadOnly: entity.human && entity.birthDate === undefined }).catch(() => []);
      return found.map((c): Candidate => ({ ...c, source: "wikimedia", ...(isNonPhotoFile(entity, c) ? { nonPhoto: true } : {}) }));
    };
    // SearXNG images (source 4): never for a person (it returns look-alikes
    // and strangers); a minor only through safe-search-capable engines. Asked
    // beside Wikimedia, not after it (ANSWER-IMG-05: the search alone took
    // 1.2 s on the household's instance, past the turn's picture budget).
    const fromSearch = async (): Promise<Candidate[]> => {
      if (entity.human) return [];
      // Study R2: the subject as given, or the chosen item's own title when
      // the subject's page is another thing; never a suffix.
      const query = entity.queryTitle ?? subject;
      trace.search_query = query === subject ? "subject" : "wikipedia_title";
      const rows = await imageSearch(query, input.actor, input.band).catch(() => []);
      return rows.map((row): Candidate => {
        const size = sizeOfResolution(row.resolution);
        return { url: row.image, page: row.url, title: row.title, description: "", lead: false, source: "search", ...(size ? { width: size.width, shortSide: Math.min(size.width, size.height) } : {}), ...(row.format ? { format: row.format } : {}), ...(row.engines ? { engines: row.engines } : {}) };
      });
    };
    const [wikimediaFound, searchFound] = await Promise.all([fromWikimedia(), fromSearch()]);
    const candidates: Candidate[] = [...wikimediaFound, ...searchFound];
    const wikimedia = wikimediaFound.length, searxng = searchFound.length;
    // Source 3 (cited pages' og:image) is not built: no page read keeps it yet.
    trace.sources = { wikimedia, searxng };

    // Rule 10: captions and alt text are text and pass the person's floor.
    // ANSWER-IMG-05b: then a picture must be of the subject and a media
    // picture, not someone's own snapshot (relevance.ts; a quality filter on
    // the result's metadata, not a safety floor).
    const names = subjectNames([subject, entity.label], [...(entity.aliases ?? []), ...(entity.otherLabels ?? [])]);
    const searchNames = subjectNames([subject, entity.label], entity.aliases ?? []);
    const context = { names, searchNames, ...(entity.otherSenseWords ? { otherSenseWords: entity.otherSenseWords } : {}), subjectIsPerson: entity.human, ...(entity.description ? { description: entity.description } : {}), band: input.band, ...(entity.commonsCategory ? { commonsCategory: entity.commonsCategory } : {}), ...(entity.officialSite ? { officialSite: entity.officialSite } : {}) };
    let droppedByFloor = 0;
    const droppedByRelevance: Record<RelevanceDrop, number> = {};
    const seen = new Set<string>();
    const kept: Candidate[] = [];
    const perSource = { wikimedia: 0, search: 0 };
    // Commons candidates first: when enough pass the rules to fill the row
    // twice over, the open web's pictures are never fetched (no request to
    // a third-party picture host that would only be thrown away); otherwise
    // both are fetched and search only fills what Commons could not (below).
    let searchSkipped = 0;
    // IMG-QUALITY-01b: what the conversation has already shown ("show me more").
    const shown = input.shown;
    const hasShown = shown !== undefined && (shown.ids.size > 0 || shown.sources.size > 0);
    let excludedShown = 0;
    // For a film, show, game, franchise or character the open web leads and
    // Commons only fills (study, per category); otherwise Commons leads.
    const lead: "wikimedia" | "search" = entity.media ? "search" : "wikimedia";
    const follow: "wikimedia" | "search" = lead === "search" ? "wikimedia" : "search";
    if (entity.media) trace.leading_source = "search";
    // Open-web rows in the study's score order (R5), larger pictures first on
    // a tie (R6: a short side of 600 px or more was right 70% of the time at
    // 1000 px and up, 38% under 300), then the engines' own order.
    const searchRanked = candidates.filter((c) => c.source === "search")
      .map((c, i) => ({ c, i, score: searchScore({ title: c.title, page: c.page, image: c.url, ...(c.engines ? { engines: c.engines } : {}) }, context).score, big: (c.shortSide ?? 0) >= 600 ? 1 : 0 }))
      .sort((x, y) => y.score - x.score || y.big - x.big || x.i - y.i)
      .map((x) => x.c);
    const commonsRows = candidates.filter((c) => c.source === "wikimedia");
    const byLead = lead === "wikimedia" ? [...commonsRows, ...searchRanked] : [...searchRanked, ...commonsRows];
    for (const c of byLead) {
      if (c.source === follow && perSource[lead] >= COMMONS_ENOUGH * 2) { searchSkipped++; continue; }
      if (hasShown && c.page && shown!.sources.has(c.page)) { excludedShown++; continue; }
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      if (trips(`${c.title}. ${c.description}`, input.band)) { droppedByFloor++; continue; }
      const off = judgeRelevance({ source: c.source, lead: c.lead, title: c.title, description: c.description, page: c.page, image: c.url, ...(c.objectName ? { objectName: c.objectName } : {}), ...(c.categories ? { categories: c.categories } : {}), ...(c.restrictions ? { restrictions: c.restrictions } : {}), ...(c.width !== undefined ? { width: c.width } : {}), ...(c.format ? { format: c.format } : {}), ...(c.nonPhoto ? { nonPhoto: true } : {}), ...(c.engines ? { engines: c.engines } : {}) }, context);
      if (off) { droppedByRelevance[off] = (droppedByRelevance[off] ?? 0) + 1; continue; }
      if (perSource[c.source] >= PER_SOURCE_SLOTS) continue;
      perSource[c.source]++;
      kept.push(c);
      if (kept.length >= MAX_CANDIDATES) break;
    }
    if (droppedByFloor > 0) trace.dropped_by_floor = droppedByFloor;
    if (Object.keys(droppedByRelevance).length > 0) trace.dropped_by_relevance = droppedByRelevance;
    if (searchSkipped > 0) trace.search_held_back = searchSkipped;
    const traceExcluded = (): void => { if (excludedShown > 0) trace.excluded_already_shown = excludedShown; };
    traceExcluded();
    if (kept.length === 0) return skip("no_candidates");

    const sources: AnswerImageSource[] = kept.map((c, i) => ({ id: `c${i}`, url: c.url, leadImage: c.lead }));
    const fetched = await fetchAnswerImages(sources, { ...deps.fetchOptions, ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}) });
    trace.dropped_by_fetch = fetched.dropped_by_fetch;
    trace.dropped_by_quality = fetched.dropped_by_quality as Record<string, number>;
    if (fetched.duplicate_check && fetched.duplicate_check.pairs > 0) trace.duplicate_check = fetched.duplicate_check;
    // The filter keeps the best of each near-duplicate group; the row keeps
    // the sources' own priority order (lead, Commons, search rank).
    let validated = [...fetched.images].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    // The following source only fills a row the leading one cannot (see
    // COMMONS_ENOUGH).
    const fromLead = validated.filter((image) => kept[Number(image.id.slice(1))]!.source === lead);
    if (fromLead.length >= COMMONS_ENOUGH && fromLead.length < validated.length) {
      trace.search_not_needed = validated.length - fromLead.length;
      validated = fromLead;
    }
    const items: AnswerImageItem[] = [];
    const ids = new Set<string>();
    for (const image of validated) {
      const c = kept[Number(image.id.slice(1))]!;
      const id = await putAnswerImage({ tile: image.tile, full: image.full, band: input.band, originalUrl: c.url, leadImage: c.lead });
      if (ids.has(id)) continue;
      ids.add(id);
      if (hasShown && shown!.ids.has(id)) { excludedShown++; continue; }
      const size = await sharp(image.full).metadata();
      const site = hostOf(c.page);
      const caption = clip(c.description || c.title, CAPTION_MAX);
      items.push({
        id,
        src: `/api/answer-image/${id}?v=tile`,
        full: `/api/answer-image/${id}?v=full`,
        width: size.width ?? image.width,
        height: size.height ?? image.height,
        alt: clip(c.description || `Picture of ${entity.label} from ${site}`, CAPTION_MAX),
        caption,
        source: { title: clip(c.title, CAPTION_MAX), site, url: c.page },
        ...(c.license ? { license: c.license } : {}),
      });
    }
    // Fewer than two validated extras: the extras are dropped and there is no
    // badge, so the number never promises a lone extra (section 6, Counts).
    traceExcluded();
    // Fewer than two new pictures on a "show more": no gallery, the answer stays whole (rule 6).
    if (hasShown && items.length < 2) return skip("none_survived");
    const shownItems = items.length > GALLERY_VISIBLE && items.length - GALLERY_VISIBLE < 2 ? items.slice(0, GALLERY_VISIBLE) : items;
    trace.shown = shownItems.length;
    if (shownItems.length === 0) return skip("none_survived");
    return { set: { layout: "row", visible: Math.min(GALLERY_VISIBLE, shownItems.length), items: shownItems }, trace };
  } catch {
    return skip("error");
  }
}
