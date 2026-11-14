import { z } from "zod";
import type { ToolSpec } from "@/lib/llm";
import { outcomeOf, type ToolExecutionOutcome } from "@/lib/turnContext";
import type { PersonRow } from "@/types";
import { makeVoiceover } from "@/lib/voiceover";
import { changeVoice } from "@/lib/changeVoice";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { mayUseClipVoices } from "@/lib/access";
import { readAttachment } from "@/lib/attachments";
import { saveInspiredVoice, deleteClonedVoice, listClonedVoices, MAX_BYTES as MAX_CLONED_VOICE_BYTES } from "@/lib/clonedVoices";
import { isInspiredLevel } from "@/lib/voiceShift";
import { renderHouseholdVoice, cacheHouseholdPreview } from "@/lib/householdVoiceCheck";

export const VOICEOVER_TOOL_ID = "voiceover";
export const CHANGE_VOICE_TOOL_ID = "change_voice";
export const MAKE_INSPIRED_VOICE_TOOL_ID = "make_inspired_voice";
const voiceoverArgs = z.object({ script: z.string().min(1).max(2000), voice: z.string().min(1).optional() }).strict();
const changeVoiceArgs = z.object({ file: z.string().min(1), voice: z.string().min(1).optional() }).strict();
const inspiredVoiceArgs = z.object({ clip: z.string().min(1), name: z.string().trim().min(1).max(60), level: z.enum(["much_lower", "lower", "different", "very_different"]).default("different"), blend_with: z.string().min(1).optional() }).strict();

export function voiceoverToolSpec(): ToolSpec {
  return { id: VOICEOVER_TOOL_ID, description: "Record requested words as speech. Use generate_music with kind=sound for sound effects or ambience, and generate_music for songs. Never use this for a video in view; a voice over a video is an edit_video mix. Speak only the words the person asked for. The script is the exact words to speak and may include bracket tags offered by the voice list.", args: { type: "object", required: ["script"], properties: { script: { type: "string", minLength: 1, maxLength: 2000, description: "Exact words to speak, optionally with supported bracket tags." }, voice: { type: "string", minLength: 1, description: "Optional voice name or id the person named." } }, additionalProperties: false } };
}
export function changeVoiceToolSpec(): ToolSpec {
  return { id: CHANGE_VOICE_TOOL_ID, description: "Change the voice in one of the person's own Library audio or video files. Identify it by file id or exact file name. Do not use this to record typed words, translate a video, or edit a song. Never reveal the transcript.", args: { type: "object", required: ["file"], properties: { file: { type: "string", minLength: 1, description: "A Library file id or exact file name belonging to the person." }, voice: { type: "string", minLength: 1, description: "Optional voice name or id the person named." } }, additionalProperties: false } };
}
export function makeInspiredVoiceToolSpec(): ToolSpec {
  return { id: MAKE_INSPIRED_VOICE_TOOL_ID, description: "Make a new household voice inspired by one of the person's own audio recordings. Use a Library audio file id or latest for the newest audio attachment in this chat. The source must belong to the person. Optionally name one of the existing household voices to blend with. Never use a video or someone else's file.", args: { type: "object", required: ["clip", "name"], properties: { clip: { type: "string", minLength: 1, description: "The person's own Library audio file id, or latest for the most recent audio attachment in this chat." }, name: { type: "string", minLength: 1, maxLength: 60, description: "The new voice's label." }, level: { type: "string", enum: ["much_lower", "lower", "different", "very_different"], default: "different" }, blend_with: { type: "string", minLength: 1, description: "Optional existing household voice id or name." } }, additionalProperties: false } };
}

function success(callId: string, tool: string, args: Record<string, unknown>, fileId: string, label: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: tool, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `${label} was made. The person can find it in the Library.` }, data: { fileId }, actions: [] } });
}
function failed(callId: string, tool: string, args: Record<string, unknown>, line: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: tool, status: "failed", via: "tool_call", args, errorCode: "voice_tool_failed", failureKind: "unavailable", userMessage: line, durationMs: 0 });
}
export async function runVoiceoverTool(actor: PersonRow, raw: Record<string, unknown>, callId: string): Promise<ToolExecutionOutcome> {
  const parsed = voiceoverArgs.safeParse(raw);
  if (!parsed.success) return failed(callId, VOICEOVER_TOOL_ID, { voice: raw.voice }, "The recording request was invalid. Try again with a script from 1 to 2000 characters.");
  const result = await makeVoiceover(actor, parsed.data);
  return result.ok ? success(callId, VOICEOVER_TOOL_ID, { voice: parsed.data.voice }, result.file_id, "The voiceover") : failed(callId, VOICEOVER_TOOL_ID, { voice: parsed.data.voice }, result.line);
}
export async function runChangeVoiceTool(actor: PersonRow, raw: Record<string, unknown>, callId: string): Promise<ToolExecutionOutcome> {
  const parsed = changeVoiceArgs.safeParse(raw);
  if (!parsed.success) return failed(callId, CHANGE_VOICE_TOOL_ID, {}, "The file request was invalid. Name one of your own audio or video files.");
  const candidate = parsed.data.file.trim();
  const byId = db.select().from(attachments).where(and(eq(attachments.id, candidate), eq(attachments.ownerPersonId, actor.id), isNull(attachments.deletedAt))).get();
  const row = byId ?? db.select().from(attachments).where(and(eq(attachments.name, candidate), eq(attachments.ownerPersonId, actor.id), isNull(attachments.deletedAt))).all().find((item) => item.mediaType.startsWith("audio/") || item.mediaType.startsWith("video/"));
  if (!row || (!row.mediaType.startsWith("audio/") && !row.mediaType.startsWith("video/"))) return failed(callId, CHANGE_VOICE_TOOL_ID, { voice: parsed.data.voice }, "I can't find that file.");
  const result = await changeVoice(actor, { file_id: row.id, voice: parsed.data.voice });
  return result.ok ? success(callId, CHANGE_VOICE_TOOL_ID, { voice: parsed.data.voice }, result.file_id, "The changed voice file") : failed(callId, CHANGE_VOICE_TOOL_ID, { voice: parsed.data.voice }, result.line);
}

export async function runMakeInspiredVoiceTool(actor: PersonRow, raw: Record<string, unknown>, callId: string, conversationId?: string, attachedAudioIds: string[] = []): Promise<ToolExecutionOutcome> {
  const parsed = inspiredVoiceArgs.safeParse(raw);
  const safeArgs = parsed.success ? { name: parsed.data.name, level: parsed.data.level } : {};
  if (!parsed.success) return failed(callId, MAKE_INSPIRED_VOICE_TOOL_ID, safeArgs, "The voice request was invalid. Give it a name and choose one of the four levels.");
  if (!mayUseClipVoices(actor)) return failed(callId, MAKE_INSPIRED_VOICE_TOOL_ID, safeArgs, "Guests cannot make a voice. Ask the person who manages Home to add you as a member.");
  if (!isInspiredLevel(parsed.data.level)) return failed(callId, MAKE_INSPIRED_VOICE_TOOL_ID, safeArgs, "That voice level is not available. Choose much_lower, lower, different or very_different.");
  const clipToken = parsed.data.clip.trim();
  const row = clipToken.toLowerCase() === "latest"
    ? conversationId ? db.select().from(attachments).where(and(eq(attachments.ownerPersonId, actor.id), eq(attachments.conversationId, conversationId), isNull(attachments.deletedAt))).orderBy(desc(attachments.createdAt), desc(attachments.hlc)).all().find((item) => item.mediaType.startsWith("audio/") && attachedAudioIds.includes(item.id)) : undefined
    : db.select().from(attachments).where(and(eq(attachments.id, clipToken), eq(attachments.ownerPersonId, actor.id), isNull(attachments.deletedAt))).get();
  if (!row || row.ownerPersonId !== actor.id || !row.mediaType.startsWith("audio/")) return failed(callId, MAKE_INSPIRED_VOICE_TOOL_ID, safeArgs, "I can only use your own audio file. Choose one of your audio files in the Library or attach it in this chat.");
  if (row.size > MAX_CLONED_VOICE_BYTES) return failed(callId, MAKE_INSPIRED_VOICE_TOOL_ID, safeArgs, `That recording is too large. Choose an audio file under ${MAX_CLONED_VOICE_BYTES / (1024 * 1024)} MB.`);
  const source = readAttachment(actor, row.id);
  if (!source.ok) return failed(callId, MAKE_INSPIRED_VOICE_TOOL_ID, safeArgs, "I could not open that recording. Choose another audio file from your Library.");
  let baseVoiceId: string | null = null;
  if (parsed.data.blend_with) {
    const voice = listClonedVoices().find((item) => item.id === parsed.data.blend_with!.trim() || item.label.toLocaleLowerCase() === parsed.data.blend_with!.trim().toLocaleLowerCase());
    if (!voice) return failed(callId, MAKE_INSPIRED_VOICE_TOOL_ID, safeArgs, "I could not find that household voice. Choose a voice shown on the Voices page.");
    baseVoiceId = voice.id;
  }
  try {
    const saved = await saveInspiredVoice(actor, parsed.data.name, source.value.bytes, row.mediaType, parsed.data.level, baseVoiceId);
    if (!saved.ok) return failed(callId, MAKE_INSPIRED_VOICE_TOOL_ID, safeArgs, `${saved.error} Choose a valid audio recording and try again.`);
    const check = await renderHouseholdVoice(saved.value.id);
    if (!check.ok) {
      deleteClonedVoice(actor, saved.value.id);
      return failed(callId, MAKE_INSPIRED_VOICE_TOOL_ID, safeArgs, `${check.error} Choose a recording between 6 and 30 seconds and try again.`);
    }
    if (check.audio && check.audio.byteLength > 44) cacheHouseholdPreview(saved.value.id, check.audio);
    return outcomeOf({ callId, packageId: MAKE_INSPIRED_VOICE_TOOL_ID, status: "succeeded", via: "tool_call", args: safeArgs, durationMs: 0, result: { reply: { text: `The inspired voice “${saved.value.label}” was made at the ${parsed.data.level.replaceAll("_", " ")} level. It now appears on the Voices page.` }, data: { voiceId: saved.value.id }, actions: [] } });
  } catch {
    return failed(callId, MAKE_INSPIRED_VOICE_TOOL_ID, safeArgs, "I could not make that voice right now. Check the recording and try again.");
  }
}
