// TURN-WATERFALL-01: where a reply's time went, as numbers only. No new store: every offset is read at request time from
// what a turn already records (stats.nodes and stats.generations on the turn row; first sentence and first audio from the
// voice timing store). The rows leave without a turn id, person id or date (rule 6a): the viewer's own recent turns by
// order only, plus household medians.
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, conversations } from "@/db/schema";
import { findVoiceTiming, voiceTimingRecords, type VoiceTimingRecord } from "@/lib/voiceTiming";
import { median } from "@/lib/performance";
import type { TurnStats } from "@/wire";

export interface WaterfallOffsets {
  /** Every value is ms from the turn's start; null when that stage did not happen or was not measured. */
  context_end_ms: number | null;
  prefill_end_ms: number | null;
  first_token_ms: number | null;
  first_sentence_ms: number | null;
  first_audio_ms: number | null;
  total_ms: number | null;
}
export interface TurnWaterfall { recent: WaterfallOffsets[]; median: WaterfallOffsets; turns: number }

const KEYS: (keyof WaterfallOffsets)[] = ["context_end_ms", "prefill_end_ms", "first_token_ms", "first_sentence_ms", "first_audio_ms", "total_ms"];
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

export function offsetsOf(stats: TurnStats, voice?: Pick<VoiceTimingRecord, "first_sentence_ms" | "first_audio_ms">): WaterfallOffsets {
  const context = stats.nodes?.find((n) => n.node === "context");
  const gen = stats.generations?.[0];
  const prefill = gen && num(gen.request_sent_ms) !== null && num(gen.prompt_ms) !== null ? gen.request_sent_ms + (gen.prompt_ms as number) : null;
  return {
    context_end_ms: context ? num(context.endMs - (stats.nodes?.[0]?.startMs ?? context.startMs)) : null,
    prefill_end_ms: num(prefill),
    first_token_ms: num(gen?.first_delta_ms),
    first_sentence_ms: num(voice?.first_sentence_ms),
    first_audio_ms: num(voice?.first_audio_ms),
    total_ms: num(stats.total_time_ms),
  };
}

function parse(raw: string | null): TurnStats | undefined {
  try { return raw ? (JSON.parse(raw) as TurnStats) : undefined; } catch { return undefined; }
}

export function medianOffsets(rows: readonly WaterfallOffsets[]): WaterfallOffsets {
  const out = {} as WaterfallOffsets;
  for (const key of KEYS) {
    const values = rows.map((r) => r[key]).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const m = median(values);
    out[key] = m === null ? null : Math.round(m);
  }
  return out;
}

export function turnWaterfall(personId: string, limit = 5): TurnWaterfall {
  const base = db.select({ id: conversationTurns.id, stats: conversationTurns.stats })
    .from(conversationTurns)
    .innerJoin(conversations, eq(conversationTurns.conversationId, conversations.id));
  const visible = and(isNotNull(conversationTurns.stats), eq(conversationTurns.status, "done"), ne(conversations.mode, "temporary"), ne(conversations.mode, "incognito"));
  const own = base.where(and(visible, eq(conversations.personId, personId))).orderBy(desc(conversationTurns.createdAt)).limit(limit).all();
  const recent: WaterfallOffsets[] = [];
  for (const row of own) {
    const stats = parse(row.stats);
    if (stats) recent.push(offsetsOf(stats, findVoiceTiming(row.id)));
  }
  // Household medians over the newest turns that carry stats; voice stamps come from the voice store's own recent records.
  const wide = base.where(visible).orderBy(desc(conversationTurns.createdAt)).limit(200).all();
  const voice = new Map(voiceTimingRecords().map((r) => [r.turn_id, r]));
  const all: WaterfallOffsets[] = [];
  for (const row of wide) {
    const stats = parse(row.stats);
    if (stats) all.push(offsetsOf(stats, voice.get(row.id)));
  }
  return { recent, median: medianOffsets(all), turns: all.length };
}
