import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources, people } from "@/db/schema";
import type { PersonRow } from "@/types";
import { createMediaProduction, getMediaProduction, listMediaProductions, setShowState, shareMediaProduction, type Production, type Show } from "@/lib/mediaProductions";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { synthById, listSynths, createSynth, ensureSubject, ownerActor, maySeeSynth, synthFloor, type SynthRecord } from "@/lib/synths";
import { companionFits } from "@/lib/robotCompanion";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import { newMediaSourceId, newMediaItemId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { completeBackground, type LlmMessage } from "@/lib/llm";
import { loadFormats, formatById } from "./formats";
import type { Part, Brief, Outline, Script, Line } from "./types";
import { buildBrief } from "./brief";
import { checkText, checkLines, writeOutline, writeSegment } from "./writer";
import { renderLines, layout, mixEpisode } from "./studio";
import { getStackClient } from "@/lib/stackEngine";
import type { StackClient } from "@/lib/stack/client";
import { storeFile } from "@/lib/attachments";
import { dataDir } from "@/lib/paths";
import { MediaItem } from "@/lib/media/model";
import { itemToRow } from "@/lib/media/model";
import { insertTranscript } from "@/lib/transcripts/store";
import { rememberBeat } from "./life";
import { localDayKey, hubTimeZone } from "@/lib/news/dayParts";
import { readFile } from "node:fs/promises";
import { allowedSources, queryItems, registerProductionSourceGate } from "@/lib/media/appHost";
import { isPresetVoice } from "@/lib/voiceForSpeech";

export type ShowSource = Show["sources"][number];
export type Schedule = NonNullable<Show["schedule"]>;
export interface CreateShowInput { title: string; format_id: string; cast: Array<{ synth_id: string; part: Part }> | "invent"; audience?: "all" | "teen" | "adult"; sources: ShowSource[]; schedule: Schedule | null; length_s?: number; household_facts?: boolean }
export type EpisodeOptions = { now?: Date; complete?: typeof completeBackground; stack?: StackClient };
const inventSchema = z.array(z.object({ part: z.string(), display_name: z.string().min(1).max(60), pronouns: z.string().max(40).optional(), tagline: z.string().max(120), backstory: z.string().max(300), interests: z.array(z.string().max(60)).length(3), formality: z.enum(["casual", "neutral", "formal"]), complexity: z.enum(["simple", "standard", "advanced"]), engagement: z.enum(["brief", "balanced", "curious"]), filler_density: z.enum(["none", "light", "frequent"]), clock_style: z.enum(["formal", "plain", "loose"]), hedging: z.enum(["low", "medium", "high"]), humor: z.enum(["low", "medium", "high"]), warmth: z.enum(["low", "medium", "high"]), initiative: z.enum(["low", "medium", "high"]) }));
const INVENT_PROMPT = "Invent the people for a show. For each part you are given, create one fictional adult: a name that is not a real public figure's, a tagline, a 300-character backstory, three interests, and the speaking dials (formality, complexity, engagement, filler_density, clock_style, hedging, humor, warmth, initiative) that suit the part. Make the cast different from each other in age, background and manner. Nothing about real people, companies or events.";
const episodeRunning = new Set<string>();
const stageCache = new Map<string, { brief: Brief; outline: Outline; script: Script; kept: Line[]; madeAt: string }>();
let showCompleter: typeof completeBackground | null = null;
export function __setTalentShowCompleterForTests(value: typeof completeBackground | null): void { showCompleter = value; }
function ageAudience(band: AgeBand): Show["audience"] { return band === "child" ? "all" : band; }
function audienceBand(audience: Show["audience"]): AgeBand { return audience === "all" ? "child" : audience; }
function refusal(error: string): Error { return new Error(error); }

export async function inventCast(actor: PersonRow, format: ReturnType<typeof loadFormats> extends Map<string, infer F> ? F : never, show: Pick<CreateShowInput, "title" | "audience">, complete: typeof completeBackground = completeBackground): Promise<Array<{ synth_id: string; part: Part }>> {
  const result = await complete([{ role: "system", content: INVENT_PROMPT }, { role: "user", content: JSON.stringify({ title: show.title, audience: show.audience, parts: format.parts.map((part) => ({ id: part.id, label: part.label, min: part.min, max: part.max, dials: part.dials })) }) }], { thinking: false, dropReasoning: true, temperature: 0.8, max_tokens: 1400, response_format: { type: "json_schema", json_schema: { name: "talent_cast", schema: z.toJSONSchema(inventSchema, { unrepresentable: "any" }) } } });
  try {
    if (!result.ok) throw new Error("model unavailable");
    const entries = inventSchema.parse(JSON.parse(result.text));
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.part, (counts.get(entry.part) ?? 0) + 1);
    if (entries.some((entry) => !format.parts.some((part) => part.id === entry.part)) || format.parts.some((part) => (counts.get(part.id) ?? 0) < part.min || (counts.get(part.id) ?? 0) > part.max)) throw new Error("cast shape mismatch");
    const band = audienceBand(show.audience ?? "adult"), out: Array<{ synth_id: string; part: Part }> = [];
    const usedVoices = new Set<string>();
    const { getOfferedVoices } = await import("@/lib/voiceResolve");
    const voices = (await getOfferedVoices() ?? []).filter((voice) => isPresetVoice(voice.id));
    for (let index = 0; index < entries.length; index++) {
      const row = entries[index]!;
      if (![row.display_name, row.tagline, row.backstory, ...row.interests].every((text) => checkText(text, band))) throw new Error("cast text refused");
      const picked = voices.find((voice) => !usedVoices.has(voice.id)) ?? voices[index % Math.max(1, voices.length)];
      if (picked) usedVoices.add(picked.id);
      const made = await createSynth(actor, { persona: { display_name: row.display_name, pronouns: row.pronouns, tagline: row.tagline, backstory: row.backstory, interests: row.interests, audience: show.audience ?? "adult", formality: row.formality, complexity: row.complexity, engagement: row.engagement, filler_density: row.filler_density, clock_style: row.clock_style, hedging: row.hedging, social: { humor: row.humor, warmth: row.warmth, initiative: row.initiative }, status: "ready", voice_id: picked?.id } as never, based_on: { kind: "none", person_id: null, name: null, refresh: "7d", minor: false }, life: { enabled: true, seed: "" } });
      if (!made.ok) throw new Error("synth creation failed");
      out.push({ synth_id: made.value.id, part: row.part as Part });
    }
    return out;
  } catch { throw refusal("The cast could not be invented. Try again in a moment."); }
}

export async function createShow(actor: PersonRow, input: CreateShowInput): Promise<Production> {
  const format = formatById(input.format_id);
  if (!format) throw refusal("That show format does not exist. Pick one from the list.");
  const band = speakerAgeBand(actor, new Date()), audience = input.audience ?? ageAudience(band), floor = audienceBand(audience);
  const rank = { child: 0, teen: 1, adult: 2 };
  if (rank[floor] > rank[band]) throw refusal("You can only make shows for your own age group or younger.");
  if (band !== "adult" && getHouseholdSettingValue("talent.minors.make") === false) throw refusal("Shows are off for children and teens in this household. A parent can turn them on in Settings.");
  if (({ child: 0, teen: 1, adult: 2 } as const)[floor] < ({ child: 0, teen: 1, adult: 2 } as const)[format.min_audience === "all" ? "child" : format.min_audience]!) throw refusal("This format is not for your age group.");
  for (const source of input.sources) if (!format.sources_allowed.includes(source.kind)) throw refusal(`This format cannot use ${source.kind} as a source.`);
  const cast = input.cast === "invent" ? await inventCast(actor, format, { title: input.title, audience }, showCompleter ?? completeBackground) : input.cast;
  const entries: Production["cast"] = [];
  for (const member of cast) {
    const synth = synthById(member.synth_id);
    if (!synth || !maySeeSynth(actor, synth)) throw refusal("That synth is not available to you. Choose another synth.");
    if (!companionFits(floor, synthFloor(synth))) throw refusal(`${synth.persona.display_name} is for adults and this show is for everyone. Pick another synth or make the show adults only.`);
    const subjectId = await ensureSubject(synth);
    entries.push({ subject_id: subjectId, synth_id: synth.id, part: member.part, role: member.part, wardrobe_variant_ids: [], voice_choice: null, notes: "" });
  }
  const length = Math.min(format.length_s.max, Math.max(format.length_s.min, Math.round(input.length_s ?? format.length_s.default)));
  const show: Show = { format_id: format.id as Show["format_id"], audience, household_facts: input.household_facts ?? true, sources: input.sources, schedule: input.schedule, length_s: length, state: null, stand_in_synth_id: null };
  const production = createMediaProduction(actor, { title: input.title, summary: "", cast: entries, show }, "talent");
  const sourceId = newMediaSourceId(), now = new Date().toISOString();
  db.insert(mediaSources).values({ id: sourceId, kind: "production", scope: "person", ownerPersonId: actor.id, label: production.title, productionId: production.id, visibleTo: JSON.stringify([actor.id, ...production.shared_to]), createdAt: now, hlc: nextHlc(), provenance: "talent:show" }).run();
  return production;
}

export function listShows(actor: PersonRow): Production[] { return listMediaProductions(actor).filter((row) => row.show !== null); }
export function getShow(actor: PersonRow, id: string): Production | null { const row = getMediaProduction(actor, id); return row?.show ? row : null; }

function sourceFor(productionId: string) { return db.select().from(mediaSources).where(and(eq(mediaSources.productionId, productionId), eq(mediaSources.kind, "production"), isNull(mediaSources.deletedAt))).get(); }
function localParts(now: Date) { const zone = hubTimeZone(); const date = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); return { date: date.replaceAll("-", ""), day: new Date(`${date}T12:00:00Z`).getUTCDay(), key: localDayKey(now, zone) }; }

export function dueShows(now: Date): Array<{ production: Production; owner: PersonRow }> {
  const parts = localParts(now), local = new Intl.DateTimeFormat("en-GB", { timeZone: hubTimeZone(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const result: Array<{ production: Production; owner: PersonRow }> = [];
  const owners = db.select().from(people).where(isNull(people.deletedAt)).all().filter((person) => person.enabled && !person.memorializedAt);
  const all = owners.flatMap((owner) => listMediaProductions(owner));
  for (const production of all.filter((row) => row.show?.schedule)) {
    const schedule = production.show!.schedule!;
    if (schedule.days?.length && !schedule.days.includes(parts.day)) continue;
    const [hour, minute] = schedule.at.split(":").map(Number);
    const state = production.show!.state as (Show["state"] & { last_make_ms?: number }) | null;
    const lead = state?.last_make_ms ?? 600_000, currentMinutes = Number(local.slice(0, 2)) * 60 + Number(local.slice(3, 5));
    if (currentMinutes < hour! * 60 + minute! - Math.ceil(lead / 60_000)) continue;
    if (production.episodes.some((episode) => episode.id.startsWith(`ep-${parts.date}-`))) continue;
    const owner = owners.find((person) => person.id === production.owner_person_id);
    if (owner && owner.enabled && !owner.memorializedAt) result.push({ production, owner });
  }
  return result;
}

function cachePath(productionId: string, episodeId: string) { return join(dataDir, "talent", productionId, `${episodeId}.json`); }
function writeCache(productionId: string, episodeId: string, value: unknown) { const path = cachePath(productionId, episodeId); mkdirSync(join(dataDir, "talent", productionId), { recursive: true }); writeFileSync(path, JSON.stringify(value)); }
function readCache<T>(productionId: string, episodeId: string): T | null { try { return JSON.parse(readFileSync(cachePath(productionId, episodeId), "utf8")) as T; } catch { return null; } }
function stage(production: Production, episodeId: string, name: NonNullable<Show["state"]>["stage"], now: Date, patch: Record<string, unknown> = {}) { setShowState(production.owner_person_id, production.id, { ...(production.show?.state ?? {}), episode_id: episodeId, stage: name, started_at: now.toISOString(), ...patch } as never); }

export async function makeEpisode(actor: PersonRow, productionId: string, opts: EpisodeOptions = {}): Promise<{ episode_id: string; item_id: string }> {
  const now = opts.now ?? new Date(), complete = opts.complete ?? completeBackground, stack = opts.stack ?? getStackClient(), started = Date.now();
  let production = getShow(actor, productionId);
  if (!production || production.owner_person_id !== actor.id) throw refusal("That show is not available to you. Open one of your shows and try again.");
  if (episodeRunning.has(productionId)) throw Object.assign(refusal("An episode is being made right now. Wait for it to finish."), { status: 409 });
  const old = production.show?.state;
  if (old?.started_at && now.getTime() - Date.parse(old.started_at) > 7_200_000 && old.stage !== "done") {
    setShowState(actor.id, productionId, { ...old, started_at: now.toISOString() }); production = getShow(actor, productionId)!;
  }
  episodeRunning.add(productionId);
  const local = localParts(now), episodeId = old?.stage && old.stage !== "done" && old.episode_id ? old.episode_id : `ep-${local.date}-${randomBytes(3).toString("hex")}`;
  let currentStage = old?.stage && old.stage !== "done" && old.stage !== "failed" ? old.stage : "brief";
  try {
    let state = stageCache.get(episodeId) ?? readCache<typeof stageCache extends Map<string, infer V> ? V : never>(productionId, episodeId);
    let brief = state?.brief, outline = state?.outline, script = state?.script, kept = state?.kept;
    const format = formatById(production.show!.format_id);
    if (!format) throw refusal("That show format does not exist. Pick one from the list.");
    if (currentStage === "brief") { stage(production, episodeId, "brief", now); brief = await buildBrief(actor, production, format, now); stateCache(productionId, episodeId, { brief, madeAt: now.toISOString() }); currentStage = "outline"; stage(production, episodeId, "outline", now); }
    if (currentStage === "outline") { brief ??= await buildBrief(actor, production, format, now); outline = await writeOutline(brief, complete); stateCache(productionId, episodeId, { brief, outline, madeAt: now.toISOString() }); currentStage = "script"; stage(production, episodeId, "script", now); }
    if (currentStage === "script") {
      brief ??= await buildBrief(actor, production, format, now); outline ??= await writeOutline(brief, complete);
      const segments: Script["segments"] = []; let previous: Line[] = [];
      for (let index = 0; index < outline.segments.length; index++) {
        const plan = outline.segments[index]!;
        const lines = await writeSegment(brief, outline, index, complete, previous);
        segments.push({ kind: plan.kind, goal: plan.goal, lines }); previous = [...previous, ...lines].slice(-6);
      }
      script = { title: outline.title, segments }; stateCache(productionId, episodeId, { brief, outline, script, madeAt: now.toISOString() }); currentStage = "check"; stage(production, episodeId, "check", now);
    }
    if (currentStage === "check") {
      if (!script) throw refusal("The saved episode script is missing. Start a new episode to rebuild it.");
      const bySegment = script.segments.map((segment) => ({ ...segment, lines: checkLines(segment.lines, brief!.audience, { minorInCast: brief!.cast.some((member) => member.minor) }).kept }));
      if (bySegment.some((segment) => segment.lines.length === 0)) throw refusal("A segment has no lines that fit the show's audience. Change the show or try another episode.");
      kept = bySegment.flatMap((segment) => segment.lines); script = { ...script, segments: bySegment }; currentStage = "voices"; stage(production, episodeId, "voices", now);
    }
    stateCache(productionId, episodeId, { brief, outline, script, kept, madeAt: now.toISOString() });
    if (currentStage === "voices") {
      brief ??= await buildBrief(actor, production, format, now); script ??= { title: "Morning Update", segments: [] };
      const outDir = join(dataDir, "talent", productionId, episodeId); mkdirSync(outDir, { recursive: true });
      const rendered = await renderLines(script, brief.cast, outDir, stack);
      (stageCache as Map<string, unknown>).set(`${episodeId}:rendered`, rendered);
      currentStage = "mix"; stage(production, episodeId, "mix", now);
      stateCache(productionId, episodeId, { brief, outline, script, kept, madeAt: now.toISOString(), rendered });
    }
    if (currentStage === "mix") {
      state = stageCache.get(episodeId) ?? readCache<typeof state>(productionId, episodeId);
      brief = state?.brief ?? brief; outline = state?.outline ?? outline; script = state?.script ?? script; kept = state?.kept ?? kept;
      if (!brief || !outline || !script) throw refusal("The saved episode plan is missing. Start a new episode to rebuild it.");
      const rendered = (state as { rendered?: Awaited<ReturnType<typeof renderLines>> } | null)?.rendered ?? (stageCache.get(`${episodeId}:rendered`) as unknown as Awaited<ReturnType<typeof renderLines>> | undefined);
      if (!rendered) throw refusal("The saved speech files are missing. Start a new episode to render them again.");
      const arranged = layout(script, rendered, format), output = join(dataDir, "talent", productionId, episodeId, "episode.m4a");
      const mixed = await mixEpisode(arranged.tracks, arranged.chapters, { intro: null, outro: null }, output, stack);
      currentStage = "keep";
      stage(production, episodeId, "keep", now);
      const bytes = await readFile(mixed.path);
      const file = storeFile(actor, { conversationId: null, turnId: null, mediaType: "audio/mp4", bytes, name: `${outline.title}.m4a`, provenance: `show:${JSON.stringify({ v: 1, kind: "show", production_id: productionId, episode_id: episodeId, format_id: format.id, synth_ids: brief.cast.map((member) => member.synth_id), model: "home", engines: { tts: "media.tts", mix: "media.mix" }, made_at: now.toISOString() })}` });
      if (!file.ok) throw refusal(file.error);
      const source = sourceFor(productionId); if (!source) throw refusal("The show's media source is missing. Reopen the show or create it again.");
      const chapterRows = arranged.chapters.map((chapter) => ({ start_s: chapter.start_ms / 1000, title: chapter.title || "Segment", source: "manual" as const }));
      const stamp = nextHlc(), itemId = newMediaItemId();
      const record = MediaItem.parse({ id: itemId, kind: "podcast_episode", title: outline.title, subtitle: production.title, description: outline.segments.map((segment) => segment.goal).join(". "), source_id: source.id, location: { file_id: file.value.id }, locator_kind: "none", media_type: "audio/mp4", duration_s: mixed.duration_s, playable: "original", artwork: null, chapters: chapterRows, subtitles: [], previews: null, external: null, advisory: { explicit: production.show!.audience === "adult", source: "platform" }, band_ok: production.show!.audience === "adult" ? "adult" : production.show!.audience === "teen" ? "teen" : "child", verified_by_person_id: null, hidden: false, added_at: now.toISOString(), created_at: now.toISOString(), hlc: stamp, provenance: `show:${episodeId}` });
      db.insert(mediaItems).values(itemToRow(record)).run();
      const durations = new Map(rendered.map((line) => [line.line_id, line.duration_ms])); let cursor = 0;
      const transcriptSegments = script.segments.flatMap((segment, segmentIndex) => segment.lines.map((line, index) => { const id = `${segmentIndex + 1}-${index + 1}`, start = cursor; const duration = durations.get(id) ?? 0; cursor += duration + (line.timing.gap_ms ?? format.gap_ms); return { id, start: start / 1000, end: (start + duration) / 1000, text: line.text, speaker: line.part }; }));
      insertTranscript(actor, { itemId, language: "en", segments: transcriptSegments as never, provenance: { source_kind: "generated", engine: "talent.show", model_id: "home" }, author: actor.id });
      const scenes = script.segments.map((segment, index) => ({ id: `${index + 1}`, title: segment.goal, shots: segment.lines.map((line, lineIndex) => ({ id: `${index + 1}-${lineIndex + 1}`, subject_ids: production!.cast.filter((member) => member.part === line.part).map((member) => member.subject_id) })) }));
      const updatedEpisodes = [...production.episodes, { id: episodeId, title: outline.title, scenes }];
      const finalState = { episode_id: episodeId, stage: "done" as const, started_at: now.toISOString(), last_make_ms: Date.now() - started, reason: null };
      const { updateMediaProduction } = await import("@/lib/mediaProductions");
      updateMediaProduction(actor, productionId, { episodes: updatedEpisodes, finished_cut_file_ids: [...production.finished_cut_file_ids, file.value.id] });
      setShowState(actor.id, productionId, finalState);
      const lead = brief.cast.find((member) => format.parts.find((part) => part.id === member.part)?.leads) ?? brief.cast[0];
      if (lead) {
        const leadSynth = synthById(lead.synth_id), leadOwner = leadSynth && ownerActor(leadSynth);
        if (leadSynth && leadOwner) for (const member of brief.cast.filter((entry) => entry.absent)) rememberBeat(leadSynth.id, leadOwner, { text: `${member.display_name} was away this episode; ${lead.display_name} told listeners.`, category: "event", tier: "episodic", source: `talent.episode:${episodeId}` });
      }
      const recapSchema = z.array(z.object({ synth_id: z.string(), text: z.string().max(180).nullable() }));
      try {
        const recap = await complete([{ role: "system", content: "In one sentence each, what did each cast member say about their own life in this script, if anything; return null when nothing." }, { role: "user", content: JSON.stringify({ cast: brief.cast.map((member) => ({ synth_id: member.synth_id, name: member.display_name })), script: script.segments.map((segment) => segment.lines.map((line) => ({ part: line.part, text: line.text }))) }) }], { thinking: false, dropReasoning: true, temperature: 0.2, max_tokens: 500, response_format: { type: "json_schema", json_schema: { name: "talent_episode_recaps", schema: z.toJSONSchema(recapSchema, { unrepresentable: "any" }) } } });
        if (recap.ok) for (const row of recapSchema.parse(JSON.parse(recap.text))) {
          const member = brief.cast.find((entry) => entry.synth_id === row.synth_id), synth = member && synthById(member.synth_id), synthOwner = synth && ownerActor(synth);
          if (row.text && member && synth && synthOwner && checkText(row.text, brief.audience)) rememberBeat(synth.id, synthOwner, { text: row.text, category: "event", tier: "episodic", source: `talent.episode:${episodeId}` });
        }
      } catch { /* A missing recap does not make the finished episode unavailable. */ }
      cleanup( productionId, episodeId );
      console.log(`talent.episode stage=keep lines=${kept?.length ?? 0} ms=${Date.now() - started} ok=true`);
      return { episode_id: episodeId, item_id: itemId };
    }
    throw refusal("The episode stopped before it could be kept. Try making it again.");
  } catch (error) {
    setShowState(actor.id, productionId, { ...(production.show?.state ?? {}), episode_id: episodeId, stage: currentStage as never, started_at: now.toISOString(), reason: error instanceof Error ? error.message : "The episode could not be made. Try again." } as never);
    console.log(`talent.episode stage=${currentStage} ms=${Date.now() - started} ok=false`);
    throw error;
  } finally { episodeRunning.delete(productionId); }
}
function stateCache(productionId: string, episodeId: string, value: { brief?: Brief; outline?: Outline; script?: Script; kept?: Line[]; madeAt: string; rendered?: Awaited<ReturnType<typeof renderLines>> }) {
  stageCache.set(episodeId, value as never); writeCache(productionId, episodeId, value);
}
function cleanup(productionId: string, episodeId: string) { const dir = join(dataDir, "talent", productionId, episodeId); try { rmSync(dir, { recursive: true, force: true }); } catch { /* working files may already be gone */ } try { rmSync(cachePath(productionId, episodeId), { force: true }); } catch { /* cache may already be gone */ } stageCache.delete(episodeId); stageCache.delete(`${episodeId}:rendered`); }

function realPersonHidden(actor: PersonRow, production: Production): boolean {
  if (speakerAgeBand(actor, new Date()) === "adult") return false;
  const mode = getPersonSettingValue(actor, "synths.real_people");
  if (mode === true || mode === "all") return false;
  const allowed = getPersonSettingValue(actor, "synths.real_people_allowed");
  return production.cast.some((member) => { const synth = member.synth_id ? synthById(member.synth_id) : null; return synth?.based_on.kind === "real_person" && !(mode === "ask" && Array.isArray(allowed) && allowed.includes(synth.id)); });
}
export function briefingToday(actor: PersonRow, now = new Date()): { item: unknown | null; offer: boolean } {
  const band = speakerAgeBand(actor, now), preferred = band === "child" ? "kids_news" : "news_briefing";
  const shows = listShows(actor).filter((show) => show.show?.format_id === preferred && show.show.audience === (band === "child" ? "all" : band));
  if (shows.length === 0) return { item: null, offer: true };
  const key = localParts(now).date;
  const candidates = [...shows.filter((show) => show.owner_person_id === actor.id), ...shows.filter((show) => show.owner_person_id !== actor.id && show.shared_to.includes(actor.id))];
  for (const candidate of candidates) {
    if (realPersonHidden(actor, candidate)) continue;
    const episode = candidate.episodes.find((entry) => entry.id === `ep-${key}` || entry.id.startsWith(`ep-${key}-`));
    if (!episode) continue;
    const source = sourceFor(candidate.id); if (!source) continue;
    const row = db.select().from(mediaItems).where(and(eq(mediaItems.sourceId, source.id), eq(mediaItems.provenance, `show:${episode.id}`), isNull(mediaItems.deletedAt))).get();
    if (!row || row.bandOk !== (band === "child" ? "child" : band)) continue;
    const item = queryItems(actor, "podcasts", { where: eq(mediaItems.id, row.id), limit: 1 })[0];
    if (item) return { item, offer: false };
  }
  return { item: null, offer: true };
}

registerProductionSourceGate((actor, productionId) => {
  const production = getShow(actor, productionId);
  return !!production && !realPersonHidden(actor, production);
});
