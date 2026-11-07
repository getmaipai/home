import { z } from "zod";
import type { ToolSpec } from "@/lib/llm";
import { outcomeOf, type ToolExecutionOutcome } from "@/lib/turnContext";
import type { PersonRow } from "@/types";
import { makeVoiceover } from "@/lib/voiceover";
import { changeVoice } from "@/lib/changeVoice";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export const VOICEOVER_TOOL_ID = "voiceover";
export const CHANGE_VOICE_TOOL_ID = "change_voice";
const voiceoverArgs = z.object({ script: z.string().min(1).max(2000), voice: z.string().min(1).optional() }).strict();
const changeVoiceArgs = z.object({ file: z.string().min(1), voice: z.string().min(1).optional() }).strict();

export function voiceoverToolSpec(): ToolSpec {
  return { id: VOICEOVER_TOOL_ID, description: "Record someone speaking words aloud (a voiceover, narration, read-aloud or spoken message) and save it as an audio file. Call this tool whenever the person asks for a voiceover or to have words spoken as a recording; never claim a recording was made without calling it. It is not for sound effects (make_sound) or songs (make_song). Never use this for a video in view; a voice over a video is an edit_video mix. Speak only the words the person asked for, adding nothing they did not ask for. The script is the exact words to speak and may include bracket tags offered by the voice list.", args: { type: "object", required: ["script"], properties: { script: { type: "string", minLength: 1, maxLength: 2000, description: "Exact words to speak, optionally with supported bracket tags." }, voice: { type: "string", minLength: 1, description: "Optional voice name or id the person named." } }, additionalProperties: false } };
}
export function changeVoiceToolSpec(): ToolSpec {
  return { id: CHANGE_VOICE_TOOL_ID, description: "Change the voice in one of the person's own Library audio or video files. Identify it by file id or exact file name. Do not use this to record typed words, translate a video, or edit a song. Never reveal the transcript.", args: { type: "object", required: ["file"], properties: { file: { type: "string", minLength: 1, description: "A Library file id or exact file name belonging to the person." }, voice: { type: "string", minLength: 1, description: "Optional voice name or id the person named." } }, additionalProperties: false } };
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
