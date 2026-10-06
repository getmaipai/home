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
import { isUnder18, resolveWikimediaSubject, wikimediaCandidates, wikimediaFetchJson, wikipediaExtract, type FetchJson } from "./wikimedia";

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
  dropped_by_fetch?: Record<string, number>;
  dropped_by_quality?: Record<string, number>;
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
};

const trips = (text: string, band: AgeBand): boolean => text.trim().length > 0 && checkSafety(text, { isMinor: band !== "adult" }).flagged;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The pictures for `subject` that `actor` (in `band`) may see. Never
 * throws: any failure is no pictures (rule 6). */
export async function selectAnswerImages(input: { subject: string; actor: PersonRow; band: AgeBand; roster: readonly string[] }): Promise<AnswerImageSelection> {
  const subject = input.subject.trim().slice(0, 200);
  const trace: AnswerImageTrace = { subject };
  const skip = (why: AnswerImageSkip): AnswerImageSelection => ({ set: null, trace: { ...trace, skipped: why } });
  if (!subject) return skip("empty_subject");
  // Rule 1's deterministic household-name list: a family member's name never
  // leaves the house as a picture query.
  if (input.roster.length > 0 && speakerNamedAny(subject, input.roster)) return skip("household_name");
  if (trips(subject, input.band)) return skip("floor_subject");
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

    const candidates: Candidate[] = [];
    let wikimedia = 0, searxng = 0;
    // Wikimedia (sources 1 and 2): adults; a teen only once the article's own
    // text passed the floor; never a child (Wikimedia has no safe filter).
    // A person with no birth date on record gets the lead image only.
    let wikimediaAllowed = input.band === "adult";
    if (input.band === "teen") {
      const extract = await wikipediaExtract(entity.wikipediaTitle, fetchJson).catch(() => null);
      wikimediaAllowed = extract !== null && !trips(extract, "teen");
    }
    if (wikimediaAllowed) {
      const found = await wikimediaCandidates(entity, fetchJson, { leadOnly: entity.human && entity.birthDate === undefined }).catch(() => []);
      wikimedia = found.length;
      candidates.push(...found);
    }
    // SearXNG images (source 4): never for a person (it returns look-alikes
    // and strangers); a minor only through safe-search-capable engines.
    if (!entity.human) {
      const rows = await imageSearch(entity.label, input.actor, input.band).catch(() => []);
      searxng = rows.length;
      for (const row of rows) candidates.push({ url: row.image, page: row.url, title: row.title, description: "", lead: false });
    }
    // Source 3 (cited pages' og:image) is not built: no page read keeps it yet.
    trace.sources = { wikimedia, searxng };

    // Rule 10: captions and alt text are text and pass the person's floor.
    let droppedByFloor = 0;
    const seen = new Set<string>();
    const kept: Candidate[] = [];
    for (const c of candidates) {
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      if (trips(`${c.title}. ${c.description}`, input.band)) { droppedByFloor++; continue; }
      kept.push(c);
      if (kept.length >= MAX_CANDIDATES) break;
    }
    if (droppedByFloor > 0) trace.dropped_by_floor = droppedByFloor;
    if (kept.length === 0) return skip("no_candidates");

    const sources: AnswerImageSource[] = kept.map((c, i) => ({ id: `c${i}`, url: c.url, leadImage: c.lead }));
    const fetched = await fetchAnswerImages(sources, deps.fetchOptions ?? {});
    trace.dropped_by_fetch = fetched.dropped_by_fetch;
    trace.dropped_by_quality = fetched.dropped_by_quality as Record<string, number>;
    // The filter keeps the best of each near-duplicate group; the row keeps
    // the sources' own priority order (lead, Commons, search rank).
    const validated = [...fetched.images].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
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
