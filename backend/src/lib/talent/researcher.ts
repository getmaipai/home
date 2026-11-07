import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq, isNotNull } from "drizzle-orm";
import type { ShowFormat } from "@maipai/spec/gen/ts/show-format.js";
import { db } from "@/db";
import { memoryRecords, talentResearchRuns } from "@/db/schema";
import { completeBackground, type LlmCompleteOptions, type LlmMessage } from "@/lib/llm";
import { webSourcesFor } from "@/lib/retrieval/webSources";
import { releaseShelfItems } from "@/lib/shelf/shelfRead";
import { localDayKey, hubTimeZone } from "@/lib/news/dayParts";
import { embedQueryForRecall, similarByVector, supersede, list } from "@/lib/memory";
import { rememberBeat } from "@/lib/talent/life";
import { checkText } from "@/lib/talent/writer";
import { updateSynth, synthById, type SynthRecord } from "@/lib/synths";
import { listHouseholdCompanionIds } from "@/lib/householdCompanions";
import { synthFloor } from "@/lib/synths";
import { resolveSafeSearchLevel } from "@/lib/safeSearch";
import { getPersonSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";
import { searchReference } from "@/lib/referenceSearch";
import { loadArticleFor } from "@/lib/reference/article";

export const RESEARCH_SOURCE = "talent.research";
export const RESEARCH_PROMPT = `You research a real public figure from the material given (news items, search results, pages, reference articles) for a household app that lets people talk with a synth based on that person. Return JSON only, checked against the schema. Facts: at most five dated events since the given date, each with the address of the page it came from and your confidence. Style: how the person actually talks, as the speaking dials (how formal, how complex, how much they wander, how much they hedge, how warm, how funny, how much they take the lead), and up to six short phrases they are known to say, each at most one sentence, each with their source address. Views: up to six topics with the person's stated position, each with a source. Use only the material given; when the material does not show something, leave it out. Never copy more than one sentence from any page.`;

const dialsSchema = z.object({
  formality: z.enum(["casual", "neutral", "formal"]).optional(),
  complexity: z.enum(["simple", "standard", "advanced"]).optional(),
  engagement: z.enum(["brief", "balanced", "curious"]).optional(),
  filler_density: z.enum(["none", "light", "frequent"]).optional(),
  clock_style: z.enum(["formal", "plain", "loose"]).optional(),
  hedging: z.enum(["low", "medium", "high"]).optional(),
  social: z.object({ humor: z.enum(["low", "medium", "high"]).optional(), warmth: z.enum(["low", "medium", "high"]).optional(), initiative: z.enum(["low", "medium", "high"]).optional() }).strict().optional(),
}).strict() satisfies z.ZodType<Partial<ShowFormat["parts"][number]["dials"]>>;

export const RESEARCH_SCHEMA = z.object({
  facts: z.array(z.object({ date: z.string(), text: z.string().max(200), source: z.string().url(), confidence: z.number().min(0).max(1) }).strict()).max(5),
  style: z.object({ dials: dialsSchema, examples: z.array(z.object({ phrase: z.string().max(140), source: z.string().url() }).strict()).max(6) }).strict().nullable(),
  views: z.array(z.object({ topic: z.string().max(60), position: z.string().max(200), source: z.string().url() }).strict()).max(6),
}).strict();

type ResearchData = z.infer<typeof RESEARCH_SCHEMA>;
type Reference = { search: typeof searchReference; load: typeof loadArticleFor };
type Complete = typeof completeBackground;
type SearchResult = { text: string; rows: Array<{ title: string; url: string | null; snippet: string | null }>; pages?: Array<{ url: string; title: string; text: string }> };
type ResearchSearchInput = { args: unknown; band: "adult"; role: string; spoken: false; temporary: false; searxOpts: Record<string, unknown>; deadlineAt: number };
async function searchPicked(input: ResearchSearchInput): Promise<SearchResult> {
  const host = await import("@/lib/packageHost");
  return host.searchPickedWebSources(input);
}
let completeOverride: Complete | null = null;
let searchOverride: ((input: ResearchSearchInput) => Promise<SearchResult>) | null = null;
let referenceOverride: Reference | null = null;
let sourcesOverride: string[] | null = null;
const inFlight = new Set<string>();
export function __setResearchCompleterForTests(value: Complete | null): void { completeOverride = value; }
export function __setResearchSearchForTests(value: ((input: ResearchSearchInput) => Promise<SearchResult>) | null): void { searchOverride = value; }
export function __setResearchReferenceForTests(value: Reference | null): void { referenceOverride = value; }
export function __setResearchSourcesForTests(value: string[] | null): void { sourcesOverride = value; }
export function isResearchingSynth(synthId: string): boolean {
  return inFlight.has(synthId);
}
export function researchSince(synthId: string): string | null {
  const runs = db.select({ ranAt: talentResearchRuns.ranAt }).from(talentResearchRuns).where(eq(talentResearchRuns.synthId, synthId)).all().sort((a, b) => b.ranAt.localeCompare(a.ranAt));
  return runs[0]?.ranAt.slice(0, 10) ?? null;
}
export async function startInitialResearch(synth: SynthRecord, actor: PersonRow): Promise<void> {
  if (sourcesOverride !== null) return;
  await researchSynth(synth, actor, { since: null });
}

function responseFormat(): LlmCompleteOptions {
  return { thinking: false, dropReasoning: true, temperature: 0.2, max_tokens: 1800, response_format: { type: "json_schema", json_schema: { name: "talent_research", schema: z.toJSONSchema(RESEARCH_SCHEMA, { unrepresentable: "any" }) } } };
}
function parseResult(text: string): ResearchData | null {
  try { return RESEARCH_SCHEMA.parse(JSON.parse(text)); } catch { return null; }
}
function todayKey(now: Date): string { return localDayKey(now, hubTimeZone()); }
function birthDate(text: string): Date | null {
  const match = text.match(/(?:born|birth(?:day|date)?)[^\d]{0,30}(\d{4})-(\d{2})-(\d{2})/i);
  if (!match) return null;
  const value = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(value.getTime()) ? null : value;
}
function under18(dob: Date, now: Date): boolean {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDay = now.getUTCMonth() - dob.getUTCMonth() || now.getUTCDate() - dob.getUTCDate();
  if (monthDay < 0) age--;
  return age < 18;
}
function normalizeFactDate(value: string): string {
  if (/^\d{4}$/.test(value)) return `${value}-01-01T00:00:00.000Z`;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01T00:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  return value;
}
function makeMessages(synth: SynthRecord, since: string | null, material: unknown): LlmMessage[] {
  return [{ role: "system", content: RESEARCH_PROMPT }, { role: "user", content: JSON.stringify({ name: synth.based_on.name, since, material }) }];
}

export async function researchSynth(synth: SynthRecord, actor: PersonRow, opts: { since: string | null; complete?: Complete; search?: (input: Parameters<typeof searchPicked>[0]) => Promise<SearchResult>; reference?: Reference }): Promise<{ facts: number; style: boolean; views: number; skipped: string | null }> {
  inFlight.add(synth.id);
  try {
  const started = Date.now(), now = new Date(), empty = (skipped: string) => ({ facts: 0, style: false, views: 0, skipped });
  if (synth.forked_from != null) return empty("forks are not researched");
  if (synth.based_on.kind !== "real_person" || !synth.based_on.name) return empty("synth is not based on a real person");
  if ((sourcesOverride ?? webSourcesFor("adult", false, false)).length === 0) return empty("web search is off");
  const dayKey = todayKey(now);
  const householdRuns = db.select({ id: talentResearchRuns.id }).from(talentResearchRuns).where(eq(talentResearchRuns.dayKey, dayKey)).all();
  if (householdRuns.length >= 20) return empty("daily research budget is used");
  const existingToday = db.select({ id: talentResearchRuns.id }).from(talentResearchRuns).where(and(eq(talentResearchRuns.synthId, synth.id), eq(talentResearchRuns.dayKey, dayKey))).get();
  if (existingToday && opts.since !== null) return empty("already researched today");

  const name = synth.based_on.name;
  const query = (q: string) => (searchOverride ?? opts.search ?? searchPicked)({
    args: { query: q, read_page: true }, band: "adult", role: actor.role, spoken: false, temporary: false,
    searxOpts: { safeSearchLevel: resolveSafeSearchLevel(getPersonSettingValue(actor, "search.safe_search"), "adult"), speakerBand: "adult", deadlineAt: Date.now() + 20_000 },
    deadlineAt: Date.now() + 20_000,
  });
  let web: SearchResult[] = [];
  try {
    web.push(await query(`${name}${opts.since ? ` after:${opts.since}` : ""}`));
    if (opts.since === null) {
      web.push(await query(`${name} interview`));
      web.push(await query(`${name} speech transcript`));
    }
  } catch { /* A missing search answer leaves the other local material available. */ }
  const shelf = releaseShelfItems("adult", 200).filter((item) => `${item.title} ${item.summary}`.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  const reference = referenceOverride ?? opts.reference ?? { search: searchReference, load: loadArticleFor };
  const articles: Array<{ title: string; text: string }> = [];
  if (opts.since === null) {
    try {
      const found = await reference.search(actor, name);
      for (const hit of found.hits.slice(0, 3)) {
        const article = await reference.load(actor, hit.book, hit.path);
        if (article) articles.push({ title: hit.title, text: JSON.stringify(article).slice(0, 6000) });
      }
    } catch { /* Reference material is optional when the local library is unavailable. */ }
  }
  const material = {
    news: shelf.map(({ title, summary, url, published_at }) => ({ title, summary, url, published_at })),
    search: web.flatMap((result) => [...result.rows.map((row) => ({ title: row.title, url: row.url, text: row.snippet })), ...(result.pages ?? []).map((page) => ({ title: page.title, url: page.url, text: page.text }))]),
    reference: articles,
  };
  const model = opts.complete ?? completeOverride ?? completeBackground;
  let data: ResearchData | null = null;
  try {
    const reply = await model(makeMessages(synth, opts.since, material), responseFormat());
    if (reply.ok) data = parseResult(reply.text);
  } catch { /* A background research failure does not disrupt Home. */ }
  if (!data) return empty("research could not be completed");

  const baseId = synth.id;
  let facts = 0, views = 0, styleChanged = false, minor = synth.based_on.minor;
  const existingRecords = list(actor, { scope: "companion", companionId: baseId, includeSuperseded: true });
  for (const fact of data.facts) {
    const dob = birthDate(fact.text);
    if (dob) minor = under18(dob, now);
    const forgottenSource = db.select({ id: memoryRecords.id }).from(memoryRecords).where(and(eq(memoryRecords.companionId, baseId), eq(memoryRecords.source, `${RESEARCH_SOURCE}:${fact.source}`), isNotNull(memoryRecords.deletedAt))).get();
    if (forgottenSource) continue;
    const vector = await embedQueryForRecall(fact.text);
    const matches = vector ? similarByVector(actor, vector, { scope: "companion", companionId: baseId, includeSuperseded: true }) : [];
    const match = matches.find((item) => item.cosine > 0.9 && item.record.category === "event" && item.record.source.startsWith(RESEARCH_SOURCE));
    if (match) {
      if (match.record.deleted_at) continue;
      if (match.cosine > 0.95 && match.record.valid_from?.slice(0, 10) === fact.date.slice(0, 10)) continue;
      if (match.cosine > 0.9 && match.record.valid_from?.slice(0, 10) !== fact.date.slice(0, 10)) {
        const replaced = supersede(actor, match.record.id, { text: fact.text, category: "event", tier: "durable", source: `${RESEARCH_SOURCE}:${fact.source}`, valid_from: normalizeFactDate(fact.date), fact_confidence: fact.confidence, confidence_evidence: [{ source: fact.source, at: now.toISOString(), kind: "web" }], allow_same_text: true });
        if (replaced.ok) facts++;
        continue;
      }
    }
    const sameText = db.select().from(memoryRecords).where(and(eq(memoryRecords.companionId, baseId), eq(memoryRecords.text, fact.text))).all();
    if (sameText.some((record) => record.deletedAt !== null)) continue;
    const exactActive = sameText.find((record) => record.status === "active");
    if (exactActive) {
      const oldDate = exactActive.validFrom?.slice(0, 10) ?? null;
      if (oldDate === fact.date.slice(0, 10)) continue;
      const replaced = supersede(actor, exactActive.id, { text: fact.text, category: "event", tier: "durable", source: `${RESEARCH_SOURCE}:${fact.source}`, valid_from: normalizeFactDate(fact.date), fact_confidence: fact.confidence, confidence_evidence: [{ source: fact.source, at: now.toISOString(), kind: "web" }], allow_same_text: true });
      if (replaced.ok) facts++;
      continue;
    }
    if (vector) {
      const forgotten = existingRecords.some((r) => r.deleted_at && r.text === fact.text);
      if (forgotten) continue;
    }
    const saved = rememberBeat(baseId, actor, { text: fact.text, category: "event", tier: "durable", source: `${RESEARCH_SOURCE}:${fact.source}`, valid_from: fact.date, fact_confidence: fact.confidence, confidence_evidence: [{ source: fact.source, at: now.toISOString(), kind: "web" }] });
    if (saved.ok) facts++;
  }
  for (const view of data.views) {
    const saved = rememberBeat(baseId, actor, { text: `On ${view.topic}: ${view.position}`, category: "preference", tier: "durable", source: `${RESEARCH_SOURCE}:${view.source}` });
    if (saved.ok) views++;
  }
  if (minor !== synth.based_on.minor) {
    for (const target of [synth, ...listHouseholdCompanionIds().map((id) => synthById(id)).filter((item): item is SynthRecord => !!item && item.forked_from === baseId)]) updateSynth(actor, target.id, { based_on: { ...target.based_on, minor } });
  }
  if (data.style) {
    const targets = [synth, ...listHouseholdCompanionIds().map((id) => synthById(id)).filter((item): item is SynthRecord => !!item && item.forked_from === baseId)];
    for (const target of targets) {
      const persona = { ...target.persona };
      const pinnedDials = new Set(target.pins.dials);
      for (const [key, value] of Object.entries(data.style.dials)) {
        if (key === "social" && value) {
          const social = { ...persona.social };
          for (const [dial, dialValue] of Object.entries(value)) if (!pinnedDials.has(dial) && !pinnedDials.has(`social.${dial}`)) (social as Record<string, unknown>)[dial] = dialValue;
          persona.social = social;
        } else if (!pinnedDials.has(key)) (persona as Record<string, unknown>)[key] = value;
      }
      const pinned = new Set(target.pins.examples);
      const phrases = data.style.examples.filter((entry) => checkText(entry.phrase, synthFloor(target)) && !pinned.has(entry.phrase));
      const pinnedExamples = (target.persona.examples ?? []).filter((example) => pinned.has(example)).slice(0, 5);
      const examples = [...pinnedExamples, ...phrases.slice(0, Math.max(0, 5 - pinnedExamples.length)).map((entry) => entry.phrase)];
      persona.examples = examples.length >= 3 ? examples : target.persona.examples;
      const kept = new Set([...(persona.examples ?? []), ...target.pins.examples]);
      const phraseSources = Object.fromEntries(Object.entries(target.phrase_sources).filter(([phrase]) => kept.has(phrase)));
      const sources = Object.fromEntries(phrases.filter((entry) => kept.has(entry.phrase)).map((entry) => [entry.phrase, entry.source]));
      const result = updateSynth(actor, target.id, { persona, phrase_sources: { ...phraseSources, ...sources } });
      if (result.ok) styleChanged = true;
    }
  }
  const ranAt = now.toISOString();
  db.insert(talentResearchRuns).values({ id: randomUUID(), synthId: baseId, ranAt, dayKey, facts, views, style: Number(styleChanged) }).run();
  console.log(`talent.research facts=${facts} views=${views} style=${Number(styleChanged)} ms=${Date.now() - started}`);
  return { facts, views, style: styleChanged, skipped: null };
  } finally {
    inFlight.delete(synth.id);
  }
}
