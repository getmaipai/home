// VOICEOVER-PAGE: the one start of "Make voiceover" on a finished clip: a typed line, spoken in a chosen voice, laid over the clip. The Voiceover page's action
// (`POST /api/plugins/video/actions/voiceover`) calls it; the edit is the chat tool's `edit_video` change `mix` with sound `voice`, so the age and surface gate, the
// screening of the line, the lock check, the voice lookup and the speech normalizer are written once, in clipEditStart and the edit tool.
import type { PersonRow } from "@/types";
import { startClipEdit, type ClipEditStart } from "./clipEditStart";
import { MIX_LEVEL_IDS, type MixLevel } from "./editPlan";

export const VOICEOVER_MAX_LINE = 600;
export const VOICEOVER_NO_LINE = "Type what the voice should say, then try again.";
export const VOICEOVER_LONG_LINE = `That line is too long. Keep it under ${VOICEOVER_MAX_LINE} characters and try again.`;
export const VOICEOVER_NO_CLIP = "Pick the clip to add the voice to, then try again.";
export const VOICEOVER_BAD_LEVEL = "Choose how loud the voice should be: quiet, soft, balanced, loud or very loud.";

export function startVoiceover(actor: PersonRow, id: string, asked: { line?: unknown; voice?: unknown; level?: unknown }): Promise<ClipEditStart> {
  if (!id.trim()) return Promise.resolve({ ok: false, status: 422, error: VOICEOVER_NO_CLIP, code: "no_clip" });
  const line = typeof asked.line === "string" ? asked.line.trim() : "";
  if (!line) return Promise.resolve({ ok: false, status: 422, error: VOICEOVER_NO_LINE, code: "no_line" });
  if (line.length > VOICEOVER_MAX_LINE) return Promise.resolve({ ok: false, status: 422, error: VOICEOVER_LONG_LINE, code: "line_too_long" });
  const level = typeof asked.level === "string" && asked.level.trim() ? asked.level.trim() : undefined;
  if (level && !(MIX_LEVEL_IDS as readonly string[]).includes(level)) return Promise.resolve({ ok: false, status: 422, error: VOICEOVER_BAD_LEVEL, code: "bad_level" });
  // "default" (or nothing) is the person's own usual voice: the edit tool picks it.
  const voice = typeof asked.voice === "string" && asked.voice.trim() && asked.voice.trim() !== "default" ? asked.voice.trim().slice(0, 80) : undefined;
  return startClipEdit(actor, id, { change: "mix", sound: "voice", line, ...(voice ? { voice } : {}), ...(level ? { level: level as MixLevel } : {}) },
    "I couldn't add the voice to that video. Try again.", "voiceover_failed");
}
