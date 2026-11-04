// MUSIC-FACTS-01: a locally kept Wikipedia summary reached only through a matched MusicBrainz recording.
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, musicSongFacts } from "@/db/schema";
import { isUnder18, wikimediaFetchJson, type FetchJson } from "@/lib/answerImages/wikimedia";
import { trackBackgroundWork } from "@/lib/backgroundWork";
import { nextHlc } from "@/lib/hlc";
import { getHouseholdSettingValue } from "@/lib/settings";
import { bandAllows } from "./band";
import type { MediaItem } from "./model";
import { artistWikimediaEnabled, shortBio, type ProfilePassResult } from "./artistProfiles";
import { sharedMusicBrainzClient, type MusicBrainzClient } from "./musicbrainzMatch";
import type { PersonRow } from "@/types";

const NONE_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;
const FOUND_RECHECK_MS = 90 * 24 * 60 * 60 * 1000;
const PASS_BUDGET = 25;
const MAX_CONSECUTIVE_FAILURES = 3;
export const SONG_WIKIMEDIA_KEY = "music.artist_wikimedia";

export interface SongFact { status: "found"; summary: string; pageUrl: string }
export type SongFactResult = SongFact | { status: "none" | "withheld" };
export interface SongFactDeps { client: MusicBrainzClient; fetchJson?: FetchJson; now?: () => Date }

type Entity = { claims?: Record<string, unknown[]>; sitelinks?: Record<string, { title?: string }> };
type Page = { title?: string; extract?: unknown; missing?: unknown; pageprops?: Record<string, unknown> };

function pageTitleFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "en.wikipedia.org") return null;
    const match = /^\/wiki\/(.+)$/.exec(url.pathname);
    return match ? decodeURIComponent(match[1]!).replace(/_/g, " ") : null;
  } catch { return null; }
}

/** Fetch only the page explicitly linked from this recording or its work; never search by song name. */
export async function lookupSongFact(recordingId: string, deps: SongFactDeps): Promise<SongFactResult> {
  const fetchJson = deps.fetchJson ?? wikimediaFetchJson;
  const relations = await deps.client.lookupRecordingRelations(recordingId);
  const urls = (relations.relations ?? []).filter((r) => r.type === "wikipedia").map((r) => r.url?.resource).filter((u): u is string => typeof u === "string");
  let title = urls.map(pageTitleFromUrl).find((candidate) => candidate !== null) ?? null;
  const qid = (relations.relations ?? []).filter((r) => r.type === "wikidata").map((r) => /^https?:\/\/(?:www\.)?wikidata\.org\/(?:wiki|entity)\/(Q\d+)$/.exec(r.url?.resource ?? "")?.[1]).find((candidate) => !!candidate);
  if (qid) {
    const body = await fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims%7Csitelinks&sitefilter=enwiki&format=json`) as { entities?: Record<string, Entity & { missing?: unknown }> };
    const entity = body.entities?.[qid];
    if (!entity || entity.missing !== undefined) return { status: "none" };
    const claims = entity.claims ?? {};
    const classes = (claims.P31 ?? []).map((value) => { const item = value as { mainsnak?: { datavalue?: { value?: { id?: unknown } } } }; return item.mainsnak?.datavalue?.value?.id; });
    const isHuman = classes.some((id) => id === "Q5");
    if (isHuman) {
      const claim = claims.P569?.[0] as { mainsnak?: { datavalue?: { value?: { time?: unknown } } } } | undefined;
      const birth = claim?.mainsnak?.datavalue?.value?.time;
      if (typeof birth !== "string" || isUnder18(birth, deps.now?.() ?? new Date())) return { status: "withheld" };
    }
    if (!title) title = entity.sitelinks?.enwiki?.title ?? null;
  }
  if (qid && !title) return { status: "none" };
  if (!title) return { status: "none" };
  const page = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`) as { title?: string; extract?: unknown; type?: string };
  if (page.type === "disambiguation" || typeof page.extract !== "string") return { status: "none" };
  const summary = shortBio(page.extract);
  if (!summary) return { status: "none" };
  const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent((page.title ?? title).replace(/ /g, "_"))}`;
  return { status: "found", summary, pageUrl };
}

function save(recordingId: string, answer: SongFactResult, now: Date): void {
  db.insert(musicSongFacts).values({ musicbrainzRecordingId: recordingId, status: answer.status, summary: answer.status === "found" ? answer.summary : null, pageUrl: answer.status === "found" ? answer.pageUrl : null, fetchedAt: now.toISOString(), hlc: nextHlc() })
    .onConflictDoUpdate({ target: musicSongFacts.musicbrainzRecordingId, set: { status: answer.status, summary: answer.status === "found" ? answer.summary : null, pageUrl: answer.status === "found" ? answer.pageUrl : null, fetchedAt: now.toISOString(), hlc: nextHlc() } }).run();
}

export interface SongFactView { summary: string; url: string }
export function songFactFor(item: MediaItem, reader: PersonRow): SongFactView | null {
  if (!item.musicbrainz_recording_id) return null;
  const row = db.select().from(musicSongFacts).where(eq(musicSongFacts.musicbrainzRecordingId, item.musicbrainz_recording_id)).get();
  if (!row || row.status !== "found" || !row.summary || !row.pageUrl) return null;
  if (!bandAllows(reader, { ...item, description: row.summary })) return null;
  return { summary: row.summary, url: row.pageUrl };
}

/** At scan cadence, one lookup per matched recording at a time. MusicBrainz calls use its shared paced queue. */
export async function runSongFactPass(deps: Partial<SongFactDeps> & { budget?: number } = {}): Promise<ProfilePassResult> {
  const now = deps.now ?? (() => new Date());
  const start = Date.now();
  const result: ProfilePassResult = { considered: 0, found: 0, none: 0, withheld: 0, failed: 0, ms: 0 };
  try {
    if (!artistWikimediaEnabled() || getHouseholdSettingValue(SONG_WIKIMEDIA_KEY) === false) return result;
    const client = deps.client ?? sharedMusicBrainzClient();
    const ids = db.selectDistinct({ id: mediaItems.musicbrainzRecordingId }).from(mediaItems).where(and(eq(mediaItems.kind, "track"), isNull(mediaItems.deletedAt), isNotNull(mediaItems.musicbrainzRecordingId))).all().map((r) => r.id!).filter((id) => !!id).sort();
    const known = new Map(db.select().from(musicSongFacts).all().map((r) => [r.musicbrainzRecordingId, r]));
    const due = ids.filter((id) => { const row = known.get(id); if (!row) return true; const days = row.status === "found" ? FOUND_RECHECK_MS : NONE_RECHECK_MS; return Date.now() - Date.parse(row.fetchedAt) > days; }).slice(0, deps.budget ?? PASS_BUDGET);
    let failed = 0;
    for (const id of due) {
      if (failed >= MAX_CONSECUTIVE_FAILURES || !artistWikimediaEnabled()) break;
      result.considered++;
      try { const answer = await lookupSongFact(id, { client, ...(deps.fetchJson ? { fetchJson: deps.fetchJson } : {}), now }); save(id, answer, now()); failed = 0; result[answer.status]++; }
      catch (error) { console.error(`[music] song wikimedia lookup failed ${error instanceof Error ? error.name + ":" + error.message : "unknown"}`); result.failed++; failed++; }
    }
  } catch (error) { console.error(`[music] song wikimedia pass failed ${error instanceof Error ? error.name + ":" + error.message : "unknown"}`); result.failed++; }
  result.ms = Date.now() - start;
  if (result.considered || result.failed) console.log(`[music] song wikimedia considered=${result.considered} found=${result.found} none=${result.none} withheld=${result.withheld} failed=${result.failed} ms=${result.ms}`);
  return result;
}

let running: Promise<ProfilePassResult> | null = null;
export function kickSongFacts(deps: Partial<SongFactDeps> & { budget?: number } = {}): Promise<ProfilePassResult> {
  const idle: ProfilePassResult = { considered: 0, found: 0, none: 0, withheld: 0, failed: 0, ms: 0 };
  if (process.env.MAIPAI_MUSICBRAINZ_NO_AUTOSTART === "1") return Promise.resolve(idle);
  if (running) return running;
  running = runSongFactPass(deps).finally(() => { running = null; });
  return trackBackgroundWork(running);
}
