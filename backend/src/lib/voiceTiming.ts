/** Counts-only timings for recent spoken turns. No utterance or reply content is accepted here. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "@/lib/paths";

export interface VoiceTimingRecord {
  turn_id: string;
  stt_ms: number | null;
  turn_start_ms: number | null;
  first_token_ms: number | null;
  first_sentence_ms: number | null;
  first_audio_ms: number | null;
  first_playback_ms: number | null;
}

const CAPACITY = 200;
const storePath = join(dataDir, "local-app", "voice-timing.json");
let records: VoiceTimingRecord[] = loadRecords();
let nextId = 1;

function loadRecords(): VoiceTimingRecord[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(storePath, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((row): row is VoiceTimingRecord => Boolean(row) && typeof row === "object" && typeof (row as VoiceTimingRecord).turn_id === "string").slice(-CAPACITY) : [];
  } catch { return []; }
}

function persist(): void {
  try {
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
    const temp = `${storePath}.tmp`;
    writeFileSync(temp, JSON.stringify(records), { mode: 0o600 });
    renameSync(temp, storePath);
  } catch { /* timing is best effort and never affects the turn */ }
}

export function beginVoiceTiming(): VoiceTimingRecord {
  const record: VoiceTimingRecord = { turn_id: `voice-${nextId++}`, stt_ms: null, turn_start_ms: null, first_token_ms: null, first_sentence_ms: null, first_audio_ms: null, first_playback_ms: null };
  records.push(record);
  if (records.length > CAPACITY) records.shift();
  persist();
  return record;
}

export function beginVoiceTimingFor(turnId: string, sttMs: number | null, startedAtMs = Date.now()): VoiceTimingRecord {
  const record: VoiceTimingRecord = { turn_id: turnId, stt_ms: null, turn_start_ms: null, first_token_ms: null, first_sentence_ms: null, first_audio_ms: null, first_playback_ms: null };
  markVoiceTiming(record, "stt_ms", sttMs ?? -1);
  markVoiceTiming(record, "turn_start_ms", 0);
  records.push(record);
  if (records.length > CAPACITY) records.shift();
  persist();
  return record;
}

export function markVoiceTiming(record: VoiceTimingRecord | undefined, stage: keyof Omit<VoiceTimingRecord, "turn_id">, elapsedMs: number): void {
  if (record && record[stage] === null && Number.isFinite(elapsedMs) && elapsedMs >= 0) { record[stage] = Math.round(elapsedMs); persist(); }
}

export function setVoiceTiming(record: VoiceTimingRecord | undefined, stage: keyof Omit<VoiceTimingRecord, "turn_id">, elapsedMs: number): void {
  if (record && Number.isFinite(elapsedMs) && elapsedMs >= 0 && (record[stage] === null || stage === "first_sentence_ms" || stage === "first_playback_ms")) { record[stage] = Math.round(elapsedMs); persist(); }
}

export function findVoiceTiming(turnId: string): VoiceTimingRecord | undefined {
  return records.find((record) => record.turn_id === turnId);
}

export function voiceTimingRecords(limit = CAPACITY): readonly VoiceTimingRecord[] {
  records = loadRecords();
  return records.slice(-Math.max(0, Math.min(CAPACITY, Math.floor(limit))));
}

export function voiceTimingReport(limit = 50): string {
  const rows = voiceTimingRecords(limit);
  const median = (values: number[]) => {
    if (!values.length) return "n/a";
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return String(Math.round(values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2));
  };
  const p90 = (values: number[]) => {
    if (!values.length) return "n/a";
    values.sort((a, b) => a - b);
    return String(values[Math.ceil(values.length * 0.9) - 1]);
  };
  const stages = ["stt_ms", "turn_start_ms", "first_token_ms", "first_sentence_ms", "first_audio_ms", "first_playback_ms"] as const;
  return [`spoken turns: ${rows.length}`, `end to first playback median: ${median(rows.flatMap((r) => r.first_playback_ms === null ? [] : [r.first_playback_ms]))} ms`, `end to first playback p90: ${p90(rows.flatMap((r) => r.first_playback_ms === null ? [] : [r.first_playback_ms]))} ms`, ...stages.map((stage) => `${stage}: ${median(rows.flatMap((r) => r[stage] === null ? [] : [r[stage]!]))} ms median`)].join("\n");
}
