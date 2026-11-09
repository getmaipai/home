import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { completeBackground, type LlmCompleteOptions } from "@/lib/llm";
import { evaluateReply } from "@/lib/safety";
import { remember, list, recall, embedQueryForRecall, similarByVector, registerCompanionReadGate, registerCompanionWriteGate, type MemoryOpResult } from "@/lib/memory";
import { renderProfileCard, PROFILE_CARD_MAX_CHARS, PROFILE_CARD_MAX_LINES, type ProfileCard } from "@/lib/memoryProfile";
import { synthById, synthFloor, synthPersona, maySeeSynth, type SynthRecord } from "@/lib/synths";
import { localDayKey, hubTimeZone } from "@/lib/news/dayParts";
import { getHouseholdSettingValue } from "@/lib/settings";
import { db } from "@/db";
import { memoryRecords } from "@/db/schema";
import type { MemoryRecord } from "@maipai/spec/gen/ts/memory-record.js";
import type { PersonRow } from "@/types";

export const LIFE_SOURCE = "talent.life";
export const ORIGIN_SCHEMA = z.object({
  born_year: z.number().int(),
  hometown: z.string().max(60),
  occupation: z.string().max(80),
  events: z.array(z.object({ date: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/), text: z.string().max(140) })).min(3).max(5),
  memories: z.array(z.object({ date: z.string(), text: z.string().max(160) })).min(2).max(3),
});
export const TICK_SCHEMA = z.object({ beat: z.union([z.null(), z.object({ kind: z.enum(["plan", "outcome", "mood", "person", "absence"]), text: z.string().max(160), from: z.string(), to: z.string().nullable() })]) });

export const ORIGIN_PROMPT = `You write the life so far of a fictional person for a family app. You are given their name, backstory, interests and the audience (all ages, teen or adult). Return only the JSON asked for. Rules: the birth year makes them an adult (at least 21 years old today) unless the backstory says otherwise; events are small and ordinary (a move, a job, a trip, a friendship, a hobby milestone), dated, in the past, none this month; memories are told the way a person tells them, in the first person, one sentence each; nothing about real public events, real companies, illness, money trouble, or anything an audience of all ages should not hear; do not repeat the backstory, extend it.`;
export const TICK_PROMPT = `You keep a fictional person's life moving one small step at a time for a family app. You are given today's date, their backstory, and their current life (dated lines). Return only the JSON asked for. Most days return null. About one day in five return one small development: a plan with a date, the outcome of an earlier plan, a passing mood, a person they mention, or, about one day in twenty, an absence (a trip or a few days away) with a return date within seven days. Never contradict a current line; never mention real news, real companies, illness, money trouble, politics or anything an audience of all ages should not hear; keep it the kind of thing a coworker would mention in passing.`;

type Completer = typeof completeBackground;
let testCompleter: Completer | null = null;
export function __setTalentLifeCompleterForTests(value: Completer | null): void { testCompleter = value; }
function jsonOptions(schema: typeof ORIGIN_SCHEMA | typeof TICK_SCHEMA, name: string): LlmCompleteOptions {
  return { thinking: false, dropReasoning: true, temperature: 0.7, max_tokens: 900, response_format: { type: "json_schema", json_schema: { name, schema: z.toJSONSchema(schema, { unrepresentable: "any" }) } } };
}
function parseJson<T>(text: string, schema: z.ZodType<T>): T | null {
  try { return schema.parse(JSON.parse(text)); } catch { return null; }
}
function disclosure(synth: SynthRecord): "child_ok" | "teen_ok" | "adult_only" {
  return synth.persona.audience === "all" ? "child_ok" : synth.persona.audience === "teen" ? "teen_ok" : "adult_only";
}
function memoryDate(value: string | null | undefined, end = false): string | null | undefined {
  if (!value || !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) return value;
  const date = value.length === 4 ? `${value}-01-01` : value.length === 7 ? `${value}-01` : value;
  const parsed = new Date(`${date}T${end ? "23:59:59.999" : "00:00:00.000"}`);
  const [year, month, day] = date.split("-").map(Number);
  return Number.isNaN(parsed.getTime()) || parsed.getFullYear() !== year || parsed.getMonth() + 1 !== month || parsed.getDate() !== day ? value : parsed.toISOString();
}

export function rememberBeat(synthId: string, actor: PersonRow, beat: { text: string; category: string; tier: string; source: string; valid_from?: string | null; valid_to?: string | null; importance?: number; fact_confidence?: number | null; confidence_evidence?: Array<{ source: string; at: string; kind: string }> }): MemoryOpResult<MemoryRecord> {
  const synth = synthById(synthId);
  if (!synth || !synthPersona(synth)) return { ok: false, status: 404, error: "That synth is not here anymore." };
  if (actor.id !== synth.owner_person_id && actor.role !== "owner" && actor.role !== "admin") return { ok: false, status: 403, error: "Only the synth's maker or an admin can change its life." };
  if (evaluateReply({ text: beat.text }, synthFloor(synth)).effective.action === "refuse") {
    return { ok: false, status: 422, error: "That line is not suitable for this synth's audience, so it was not saved." };
  }
  return remember(actor, { text: beat.text, category: beat.category, tier: beat.tier, scope: "companion", companion_id: synthId, source: beat.source, importance: beat.importance ?? 0.5, child_disclosure: disclosure(synth), valid_from: memoryDate(beat.valid_from), valid_to: memoryDate(beat.valid_to, true), fact_confidence: beat.fact_confidence, confidence_evidence: beat.confidence_evidence });
}

registerCompanionReadGate((actor, id) => { const synth = synthById(id); return !!synth && maySeeSynth(actor, synth); });
registerCompanionWriteGate((actor, id) => { const synth = synthById(id); return !!synth && (actor.id === synth.owner_person_id || actor.role === "owner" || actor.role === "admin"); });

function promptData(synth: SynthRecord) {
  return { name: synth.persona.display_name, backstory: synth.persona.backstory ?? "", interests: synth.persona.interests ?? [], audience: synth.persona.audience ?? "adult" };
}

export async function writeOrigin(synth: SynthRecord, actor: PersonRow, complete: Completer = completeBackground): Promise<number> {
  const model = complete === completeBackground && testCompleter ? testCompleter : complete, reply = await model([{ role: "system", content: ORIGIN_PROMPT }, { role: "user", content: JSON.stringify(promptData(synth)) }], jsonOptions(ORIGIN_SCHEMA, "talent_life_origin"));
  if (!reply.ok) return 0;
  const origin = parseJson(reply.text, ORIGIN_SCHEMA);
  if (!origin) return 0;
  const beats: Array<Parameters<typeof rememberBeat>[2]> = [
    { text: `Born in ${origin.born_year}.`, category: "identity", tier: "durable", source: LIFE_SOURCE, valid_from: String(origin.born_year), importance: 0.8 },
    { text: `Grew up in ${origin.hometown}.`, category: "identity", tier: "durable", source: LIFE_SOURCE, importance: 0.8 },
    { text: `Works as ${origin.occupation}.`, category: "identity", tier: "durable", source: LIFE_SOURCE, importance: 0.8 },
    ...origin.events.map((event) => ({ text: event.text, category: "event", tier: "durable", source: LIFE_SOURCE, valid_from: event.date, importance: 0.65 })),
    ...origin.memories.map((memory) => ({ text: memory.text, category: "event", tier: "episodic", source: LIFE_SOURCE, valid_from: memory.date, importance: 0.45 })),
  ];
  let written = 0;
  for (const beat of beats) if (rememberBeat(synth.id, actor, beat).ok) written++;
  if (synth.life.seed.trim()) {
    const seed = rememberBeat(synth.id, actor, { text: synth.life.seed.trim(), category: "state", tier: "durable", source: LIFE_SOURCE, valid_from: localDayKey(new Date(), hubTimeZone()), importance: 0.8 });
    if (seed.ok) written++;
  }
  return written;
}

export function activeBeats(synthId: string, actor: PersonRow, now = new Date()): MemoryRecord[] {
  const synth = synthById(synthId);
  const own = list(actor, { scope: "companion", companionId: synthId, asOf: now });
  const inheritedResearch = synth?.forked_from ? list(actor, { scope: "companion", companionId: synth.forked_from, asOf: now }).filter((record) => record.source.startsWith("talent.research")) : [];
  return [...own, ...inheritedResearch].filter((record) => {
    const from = record.valid_from ? Date.parse(record.valid_from) : NaN;
    const to = record.valid_to ? Date.parse(record.valid_to.length === 10 ? `${record.valid_to}T23:59:59.999` : record.valid_to) : NaN;
    return (Number.isNaN(from) || from <= now.getTime()) && (Number.isNaN(to) || to >= now.getTime());
  });
}

export async function tickLife(synth: SynthRecord, actor: PersonRow, today: string, complete: Completer = completeBackground): Promise<"beat" | "none" | "skipped"> {
  if (!synth.life.enabled || getHouseholdSettingValue("talent.life.enabled") === false) return "skipped";
  const records = list(actor, { scope: "companion", companionId: synth.id });
  const todayRows = db.select({ source: memoryRecords.source, createdAt: memoryRecords.createdAt }).from(memoryRecords)
    .where(and(eq(memoryRecords.scope, "companion"), eq(memoryRecords.companionId, synth.id), eq(memoryRecords.status, "active"), isNull(memoryRecords.deletedAt))).all();
  if (todayRows.some((record) => record.source.startsWith(LIFE_SOURCE) && localDayKey(new Date(record.createdAt), hubTimeZone()) === today)) return "skipped";
  const current = records.map((record) => `(${record.valid_from ?? record.created_at.slice(0, 10)}${record.valid_to ? ` to ${record.valid_to}` : ""}) ${record.text}`);
  const model = complete === completeBackground && testCompleter ? testCompleter : complete;
  const reply = await model([{ role: "system", content: TICK_PROMPT }, { role: "user", content: JSON.stringify({ today, ...promptData(synth), current_life: current }) }], jsonOptions(TICK_SCHEMA, "talent_life_tick"));
  if (!reply.ok) return "skipped";
  const result = parseJson(reply.text, TICK_SCHEMA);
  if (!result) return "skipped";
  if (!result.beat) return "none";
  const item = result.beat;
  const vector = await embedQueryForRecall(item.text);
  if (vector && similarByVector(actor, vector, { scope: "companion", companionId: synth.id }).some((match) => match.cosine > 0.92)) return "none";
  const temporal = item.kind === "plan" || item.kind === "absence";
  const write = rememberBeat(synth.id, actor, { text: item.text, category: temporal ? "state" : item.kind === "person" ? "relationship" : item.kind === "mood" ? "state" : "event", tier: "episodic", source: item.kind === "absence" ? `${LIFE_SOURCE}.absence` : LIFE_SOURCE, valid_from: temporal ? item.from : undefined, valid_to: temporal ? item.to : null, importance: 0.5 });
  return write.ok ? "beat" : write.status === 422 ? "none" : "skipped";
}

export function synthCard(synthId: string, actor: PersonRow, now = new Date()): string {
  const synth = synthById(synthId);
  if (!synth) return "";
  const lines = activeBeats(synthId, actor, now)
    .filter((record) => ["identity", "event", "state", "relationship"].includes(record.category))
    .sort((a, b) => b.importance - a.importance || b.created_at.localeCompare(a.created_at))
    .map((record) => ({ id: record.id, text: record.text, at: record.valid_from ?? record.created_at, disclosure: record.child_disclosure ?? "adult_only" }));
  const card: ProfileCard = { ruleLine: `${synth.persona.display_name}'s life so far:`, lines: lines.slice(0, Math.max(0, PROFILE_CARD_MAX_LINES - 1)) };
  while (card.lines.length && renderProfileCard(card).length > PROFILE_CARD_MAX_CHARS) card.lines.pop();
  return card.lines.length ? renderProfileCard(card) : "";
}

export function isOnAir(_synthId: string): boolean {
  // TALENT-04 has not added show blocks to Productions yet.
  return false;
}
