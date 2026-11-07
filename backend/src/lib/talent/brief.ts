import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";
import type { Production } from "@/lib/mediaProductions";
import type { ShowFormat } from "@maipai/spec/gen/ts/show-format.js";
import { adaptPersonaToBand, type Persona } from "@/lib/persona";
import { synthById, synthPersona, ownerActor } from "@/lib/synths";
import { activeBeats, synthCard } from "@/lib/talent/life";
import { releaseShelfItems } from "@/lib/shelf/shelfRead";
import { storedKeyPoints, summarizeStory } from "@/lib/news/summary";
import { voiceForSpeech, isPresetVoice } from "@/lib/voiceForSpeech";
import { getOfferedVoices } from "@/lib/voiceResolve";
import { list, type ListOptions } from "@/lib/memory";
import { listLists } from "@/lib/lists";
import { listComingUp } from "@/lib/comingUp";
import { runPlugin } from "@/lib/plugins";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { hubTimeZone } from "@/lib/news/dayParts";
import type { Brief, CastMember } from "./types";

function bandAllows(disclosure: string | null | undefined, band: AgeBand): boolean { return disclosure === "child_ok" || (band !== "child" && disclosure !== "adult_only") || band === "adult"; }
function topicOf(item: { topics?: string[] }): string | null { return item.topics?.[0] ?? null; }
function dated(value: string | null | undefined, fallback: string): number { const time = Date.parse(value ?? fallback); return Number.isFinite(time) ? time : 0; }
function formatDials(persona: Persona, format: ShowFormat, partId: string): Persona {
  const dials = format.parts.find((part) => part.id === partId)?.dials;
  if (!dials) return persona;
  return { ...persona, ...dials, social: dials.social ? { ...persona.social, ...dials.social } : persona.social };
}
function householdLines(actor: PersonRow, show: Production, band: AgeBand): string[] {
  const result: string[] = [];
  const scopes: ListOptions[] = [{ scope: "household" }, ...(show.shared_to.length === 0 ? [{ scope: "person", person: actor.id } as ListOptions] : [])];
  for (const options of scopes) for (const record of list(actor, options)) {
    if (record.sensitive || !bandAllows(record.child_disclosure, band)) continue;
    result.push(record.text);
  }
  if (show.shared_to.length === 0) {
    for (const item of listLists(actor)) result.push(`${item.title} has ${item.items.length} items on its list.`);
    const now = Date.now();
    for (const item of listComingUp(actor)) if (Date.parse(item.at) >= now && Date.parse(item.at) <= now + 7 * 86_400_000) result.push(`${item.kind}: ${item.text} is coming up.`);
  }
  return result.slice(0, 12);
}

/** A younger audience gets a calmer show: `all` lowers talk_over one step, `teen` only tames `heated` (section 4.1). */
function talkOverFor(level: ShowFormat["talk_over"], audience: AgeBand): ShowFormat["talk_over"] {
  if (audience === "child") return level === "heated" ? "lively" : level === "lively" ? "light" : level;
  if (audience === "teen") return level === "heated" ? "lively" : level;
  return level;
}
export async function buildBrief(actor: PersonRow, show: Production, given: ShowFormat, now = new Date()): Promise<Brief> {
  if (!Array.isArray(given.parts)) throw new Error(`The show format is invalid. Load a validated format before building a brief (received parts: ${Object.prototype.toString.call(given.parts)} with keys ${Object.keys(given.parts ?? {}).join(", ")}).`);
  const audience = show.show?.audience === "all" ? "child" : show.show?.audience ?? "adult";
  const format: ShowFormat = { ...given, talk_over: talkOverFor(given.talk_over, audience) };
  const usedVoices = new Set<string>();
  const offered = audience === "adult" ? null : await getOfferedVoices();
  const cast: CastMember[] = [];
  for (const entry of show.cast) {
    if (!entry.synth_id || !entry.part) continue;
    const synth = synthById(entry.synth_id), base = synth && synthPersona(synth);
    if (!synth || !base) continue;
    const part = format.parts.find((p) => p.id === entry.part);
    let persona = formatDials(base, format, entry.part);
    if (audience === "child") persona = adaptPersonaToBand(persona, "child");
    else if (audience === "teen") persona = adaptPersonaToBand(persona, "teen");
    const synthOwner = ownerActor(synth);
    if (!synthOwner) continue;
    let voice = voiceForSpeech({ actor: synthOwner, companionVoice: synth.persona.voice_id });
    if (audience !== "adult" && !isPresetVoice(voice)) {
      const fallback = offered?.find((candidate) => isPresetVoice(candidate.id) && !usedVoices.has(candidate.id));
      if (fallback) voice = fallback.id;
    }
    usedVoices.add(voice);
    const beats = activeBeats(synth.id, synthOwner, now);
    const absence = beats.find((beat) => beat.source === "talent.life.absence" && (!beat.valid_from || Date.parse(beat.valid_from) <= now.getTime()) && (!beat.valid_to || Date.parse(beat.valid_to.length === 10 ? `${beat.valid_to}T23:59:59.999` : beat.valid_to) >= now.getTime()));
    let minor = synth.based_on.kind === "real_person" && synth.based_on.minor;
    if (synth.based_on.kind === "household_member" && synth.based_on.person_id) {
      const subject = db.select().from(people).where(eq(people.id, synth.based_on.person_id)).get();
      minor = !!subject && speakerAgeBand(subject, now) !== "adult";
    }
    cast.push({ synth_id: synth.id, part: (part?.id ?? entry.part) as CastMember["part"], display_name: synth.persona.display_name, persona, voice, minor, absent: absence ? { text: absence.text, back: absence.valid_to } : null });
  }
  const sources = show.show?.sources ?? [];
  const news = sources.find((source) => source.kind === "news");
  const stories = news ? await Promise.all(releaseShelfItems(audience, 60).filter((item) => !news.topics.length || (item.topics ?? []).some((topic) => news.topics.includes(topic))).sort((a, b) => dated(b.published_at, b.fetched_at) - dated(a.published_at, a.fetched_at)).slice(0, 12).map(async (item, index) => {
    const stored = index < 8 ? storedKeyPoints(item.id, audience)?.text : undefined;
    const points = index < 8 ? (stored ? stored.split("\n").filter((line) => line.startsWith("• ")).map((line) => line.slice(2)) : (await summarizeStory(item.id, audience))?.points ?? []) : [];
    return { id: item.id, title: item.title, summary: item.summary, points, publisher: item.publisher, published_at: item.published_at ?? null, topic: topicOf(item) };
  })) : [];
  const cards: Record<string, string> = {}, beatsByCast: Brief["beats"] = {};
  const recapRows: Brief["recaps"] = [];
  for (const member of cast) {
    const synth = synthById(member.synth_id), synthOwner = synth && ownerActor(synth);
    if (!synthOwner) continue;
    cards[member.synth_id] = synthCard(member.synth_id, synthOwner, now);
    const active = activeBeats(member.synth_id, synthOwner, now);
    beatsByCast[member.synth_id] = active.slice(0, 8).map((beat) => ({ at: beat.valid_from ?? beat.created_at, text: beat.text }));
    recapRows.push(...active.filter((beat) => beat.source.startsWith("talent.episode:")).map((beat) => ({ at: beat.valid_from ?? beat.created_at, text: beat.text })));
  }
  const zone = hubTimeZone();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const localDate = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const datePart = (type: string) => localDate.find((part) => part.type === type)?.value ?? "";
  let weather: string | null = null;
  if (sources.some((source) => source.kind === "weather")) {
    try {
      const result = await runPlugin("weather", actor, {}, undefined, { band: audience });
      const details = result.ok ? (result.value as typeof result.value & { appDetails?: { summary?: unknown } }).appDetails : undefined;
      if (typeof details?.summary === "string") weather = details.summary;
    } catch { weather = null; }
  }
  const recaps = recapRows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 3);
  return { show, format, cast, audience, date: `${datePart("year")}-${datePart("month")}-${datePart("day")}`, weekday: get("weekday"), air_time: `${get("hour")}:${get("minute")} ${get("dayPeriod")}`, stories, weather, household: show.show?.household_facts && sources.some((source) => source.kind === "household") ? householdLines(actor, show, audience) : [], documents: [], item: null, cards, beats: beatsByCast, recaps, person_name: show.shared_to.length === 0 ? actor.displayName : null };
}
