// VIDEO-LORA-03 (docs/design/video-loras-2026-11-02.md 6.4 and 6.5, docs/dev/loras.md): what goes to the Stack as a clip's `loras`. The chosen LoRAs are Home
// records; the Stack names a file by id. Sending is behind the Stack's own report: LTX-2.5 (Standard, Boost, Max) takes a LoRA only when
// `qualities.ltx25.loras.supported` (or `ltx25max` for Max) is true, which lands with VIDEO-LORA-05. Until then nothing is sent to it and a clip that asked for
// one fails with a plain line before anything starts; it is never dropped silently (note 5.5). Quick (Wan) sends `{ id, strength }` as reported by its engine.
import { getLoraRecord } from "@/lib/loras/store";
import { LTX25_MAX_MODEL, LTX25_MODEL } from "./quality";
import { videoEngineStatus } from "./ready";
import type { StackVideoStatus } from "./stack";

export interface WiredLora { id: string; strength: number; /** Sent to a Stack that serves LoRAs on LTX-2.5: the file's identity. */ sha256?: string }

export const LORAS_UNSUPPORTED_LINE = "This level can't use a style yet. Pick another level, or make it without the style.";

/** Whether the Stack reports LoRA support for this LTX-2.5 model (Standard and Boost are `ltx25q8`, Max is `ltx25-max`). */
export function ltx25LorasSupported(engine: StackVideoStatus | null, model: string): boolean {
  const q = model === LTX25_MAX_MODEL ? engine?.qualities?.ltx25max : engine?.qualities?.ltx25;
  return q?.loras?.supported === true;
}

export type LoraWire = { ok: true; loras: WiredLora[] | undefined } | { ok: false; line: string };

/** The `loras` of a Stack request for this model, from the caller's `{ id, strength }` list. Strength is held inside the record's own range. */
export async function wireLoras(loras: ReadonlyArray<{ id: string; strength: number }> | undefined, model: string | undefined): Promise<LoraWire> {
  if (!loras || loras.length === 0) return { ok: true, loras: loras ? [] : undefined };
  const ltx25 = model === LTX25_MODEL || model === LTX25_MAX_MODEL;
  if (ltx25 && !ltx25LorasSupported(await videoEngineStatus(), model!)) return { ok: false, line: LORAS_UNSUPPORTED_LINE };
  const wired: WiredLora[] = [];
  for (const l of loras) {
    const record = getLoraRecord(l.id);
    const strength = record ? Math.min(record.strength.max, Math.max(record.strength.min, l.strength)) : l.strength;
    wired.push(ltx25 && record ? { id: l.id, strength, sha256: record.file.sha256 } : { id: l.id, strength });
  }
  return { ok: true, loras: wired };
}
