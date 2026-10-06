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
import { warmGeometry } from "@/lib/imageSimilarity";
import { judgeRelevance, subjectNames, type RelevanceDrop } from "./relevance";
import { isNonPhotoFile, isUnder18, resolveWikimediaSubject, wikimediaCandidates, wikimediaFetchJson, wikipediaExtract, type FetchJson } from "./wikimedia";

/** Tiles shown in the row; the rest open from the badge. */
export const ANSWER_IMAGES_VISIBLE = 3;
const MAX_CANDIDATES = 12;
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
export type AnswerImageSkip = "empty_subject" | "household_name" | "floor_subject" | "no_article" | "minor_subject" | "no_candidates" | "none_survived" | "error";

export type AnswerImageTrace = {
  subject: string;
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
};

/** "1920x1080" or "1920 x 1080" to its width. */
function widthOfResolution(resolution: string | undefined): number | undefined {
  const m = resolution ? /^\s*(\d{1,5})\s*[x×]\s*\d{1,5}\s*$/i.exec(resolution) : null;
  return m ? Number(m[1]) : undefined;
}

/** At most this many of the fetch slots from one source, so one source
 * cannot crowd out the other (IMGQ-04). */
const PER_SOURCE_SLOTS = 8;
/** Commons pictures that make the open web unnecessary (the coordinator's
 * decision on the design's recommended option, 2026-10-06, under the owner's
 * ruling that adults may get general image search: search fills a row only
 * when Commons has fewer than three good ones). */
const COMMONS_ENOUGH = 3;

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
export async function selectAnswerImages(input: { subject: string; actor: PersonRow; band: AgeBand; roster: readonly string[]; deadlineAt?: number }): Promise<AnswerImageSelection> {
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
    // Owner, 2026-10-06: a subject with no Wikipedia article gets no
    // pictures, for every band (a stranger's photo can never appear).
    const entity = await resolveWikimediaSubject(subject, fetchJson);
    if (!entity) return skip("no_article");
    if (trips(`${entity.label}. ${entity.description}`, input.band)) return skip("floor_subject");
    if (entity.human && (entity.birthDate === undefined ? false : isUnder18(entity.birthDate, now()))) return skip("minor_subject");

    // Wikimedia (sources 1 and 2): adults; a teen only once the article's own
    // text passed the floor; never a child (Wikimedia has no safe filter).
    // A person with no birth date on record gets the lead image only.
    const fromWikimedia = async (): Promise<Candidate[]> => {
      let allowed = input.band === "adult";
      if (input.band === "teen") {
        const extract = await wikipediaExtract(entity.wikipediaTitle, fetchJson).catch(() => null);
        allowed = extract !== null && !trips(extract, "teen");
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
      const rows = await imageSearch(entity.label, input.actor, input.band).catch(() => []);
      return rows.map((row): Candidate => {
        const width = widthOfResolution(row.resolution);
        return { url: row.image, page: row.url, title: row.title, description: "", lead: false, source: "search", ...(width !== undefined ? { width } : {}), ...(row.format ? { format: row.format } : {}) };
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
    const context = { names, searchNames, subjectIsPerson: entity.human, band: input.band, ...(entity.commonsCategory ? { commonsCategory: entity.commonsCategory } : {}), ...(entity.officialSite ? { officialSite: entity.officialSite } : {}) };
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
    const commonsFirst = [...candidates.filter((c) => c.source === "wikimedia"), ...candidates.filter((c) => c.source === "search")];
    for (const c of commonsFirst) {
      if (c.source === "search" && perSource.wikimedia >= COMMONS_ENOUGH * 2) { searchSkipped++; continue; }
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      if (trips(`${c.title}. ${c.description}`, input.band)) { droppedByFloor++; continue; }
      const off = judgeRelevance({ source: c.source, lead: c.lead, title: c.title, description: c.description, page: c.page, image: c.url, ...(c.objectName ? { objectName: c.objectName } : {}), ...(c.categories ? { categories: c.categories } : {}), ...(c.restrictions ? { restrictions: c.restrictions } : {}), ...(c.width !== undefined ? { width: c.width } : {}), ...(c.format ? { format: c.format } : {}), ...(c.nonPhoto ? { nonPhoto: true } : {}) }, context);
      if (off) { droppedByRelevance[off] = (droppedByRelevance[off] ?? 0) + 1; continue; }
      if (perSource[c.source] >= PER_SOURCE_SLOTS) continue;
      perSource[c.source]++;
      kept.push(c);
      if (kept.length >= MAX_CANDIDATES) break;
    }
    if (droppedByFloor > 0) trace.dropped_by_floor = droppedByFloor;
    if (Object.keys(droppedByRelevance).length > 0) trace.dropped_by_relevance = droppedByRelevance;
    if (searchSkipped > 0) trace.search_held_back = searchSkipped;
    if (kept.length === 0) return skip("no_candidates");

    const sources: AnswerImageSource[] = kept.map((c, i) => ({ id: `c${i}`, url: c.url, leadImage: c.lead }));
    const fetched = await fetchAnswerImages(sources, { ...deps.fetchOptions, ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}) });
    trace.dropped_by_fetch = fetched.dropped_by_fetch;
    trace.dropped_by_quality = fetched.dropped_by_quality as Record<string, number>;
    if (fetched.duplicate_check && fetched.duplicate_check.pairs > 0) trace.duplicate_check = fetched.duplicate_check;
    // The filter keeps the best of each near-duplicate group; the row keeps
    // the sources' own priority order (lead, Commons, search rank).
    let validated = [...fetched.images].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    // The open web only fills a row Commons cannot (see COMMONS_ENOUGH).
    const fromCommons = validated.filter((image) => kept[Number(image.id.slice(1))]!.source === "wikimedia");
    if (fromCommons.length >= COMMONS_ENOUGH && fromCommons.length < validated.length) {
      trace.search_not_needed = validated.length - fromCommons.length;
      validated = fromCommons;
    }
    const items: AnswerImageItem[] = [];
    const ids = new Set<string>();
    for (const image of validated) {
      const c = kept[Number(image.id.slice(1))]!;
      const id = await putAnswerImage({ tile: image.tile, full: image.full, band: input.band, originalUrl: c.url, leadImage: c.lead });
      if (ids.has(id)) continue;
      ids.add(id);
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
    const shown = items.length > ANSWER_IMAGES_VISIBLE && items.length - ANSWER_IMAGES_VISIBLE < 2 ? items.slice(0, ANSWER_IMAGES_VISIBLE) : items;
    trace.shown = shown.length;
    if (shown.length === 0) return skip("none_survived");
    return { set: { layout: "row", visible: Math.min(ANSWER_IMAGES_VISIBLE, shown.length), items: shown }, trace };
  } catch {
    return skip("error");
  }
}
