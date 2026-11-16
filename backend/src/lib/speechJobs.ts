import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, musicJobs, people } from "@/db/schema";
import { createAttachment } from "@/lib/attachments";
import { videoRefusalFor } from "@/lib/videos/tool";
import { makeAudienceOf } from "@/lib/videos/make";
import { voicesFor, speakToBytes } from "@/lib/voiceover";
import { newMusicJobId } from "@/lib/id";
import type { PersonRow } from "@/types";
import { saveMusicJob, liveJobs } from "@/lib/music/store";
import type { MusicJob, MusicRequest } from "@/lib/music/types";

export type SpeechInput = { script: string; voice?: string; delivery?: string };
export type SpeechStart = { ok: true; job: MusicJob } | { ok: false; status: 400 | 403 | 422 | 409; line: string };

const deliveryAliases: Array<[RegExp, string[]]> = [
  [/\b(whisper|whispering|hushed)\b/i, ["whispers", "softly"]],
  [/\b(laugh|laughing|laughs)\b/i, ["laughs"]],
  [/\b(sigh|sighing|sighs)\b/i, ["sighs"]],
  [/\b(gasp|gasping|gasps)\b/i, ["gasps"]],
  [/\b(cough|coughing|coughs)\b/i, ["coughs"]],
  [/\b(clear(?:s|ing)? throat)\b/i, ["clears throat"]],
  [/\b(pause|pause briefly|dramatic pause)\b/i, ["pause"]],
  [/\b(soft|gently|quietly)\b/i, ["softly"]],
  [/\b(hesitat|uncertain|nervous)\w*\b/i, ["hesitates"]],
];

export function tagsForDelivery(delivery: string, supported: readonly string[]): string[] {
  const found = new Set<string>();
  const names = new Set(supported.map((tag) => tag.toLocaleLowerCase()));
  for (const [pattern, aliases] of deliveryAliases) if (pattern.test(delivery)) {
    for (const alias of aliases) if (names.has(alias)) found.add(alias);
  }
  return [...found];
}

function finishFailed(job: MusicJob, code: string, line: string): void {
  job.state = "failed"; job.stage = "failed"; job.errorCode = code; job.errorLine = line;
  saveMusicJob(job); liveJobs.delete(job.id);
}
const speechState = (job: MusicJob): MusicJob["state"] => job.state;

async function runSpeech(job: MusicJob, actor: PersonRow): Promise<void> {
  const speech = job.request.speech!;
  job.state = "running"; job.stage = "speaking"; job.progress = 0.1; job.etaSeconds = null; saveMusicJob(job);
  try {
    let turnExists = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (speechState(job) === "cancelled") return;
      turnExists = !!db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.id, job.turnId!), eq(conversationTurns.personId, actor.id))).get();
      if (turnExists) break;
      await new Promise<void>((resolve) => { setTimeout(() => resolve(), 250); });
    }
    if (!turnExists) { finishFailed(job, "lost_turn", "The recording did not finish. Ask for it again."); return; }
    const text = `${speech.script}${speech.tags.length ? ` ${speech.tags.map((tag) => `[${tag}]`).join(" ")}` : ""}`;
    const spoken = await speakToBytes(text, speech.voice);
    if (speechState(job) === "cancelled") return;
    if (!spoken.ok) { finishFailed(job, "speech_unavailable", spoken.line); return; }
    const stored = createAttachment(actor, {
      conversationId: job.conversationId!, turnId: job.turnId!, mediaType: "audio/wav", bytes: spoken.bytes,
      provenance: `voiceover:${JSON.stringify({ v: 1, engine: spoken.engine, ...(spoken.revision ? { revision: spoken.revision } : {}), voice: speech.voice, kind: speech.kind, delivery_tags: speech.tags })}`,
      deduplicate: false, retention: "kept", name: `Speech ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    });
    if (!stored.ok) { finishFailed(job, "save_failed", "Home could not save that recording. Check your Library storage and try again."); return; }
    job.fileId = stored.value.id; job.durationS = spoken.seconds; speech.engine = spoken.engine;
    job.state = "done"; job.stage = "ready"; job.progress = 1; job.etaSeconds = 0; job.errorCode = null; job.errorLine = null; saveMusicJob(job);
  } catch { if (speechState(job) !== "cancelled") finishFailed(job, "speech_failed", "Home could not make that recording. Try again in a minute."); }
  finally { if (speechState(job) !== "queued" && speechState(job) !== "running") liveJobs.delete(job.id); }
}

export async function startSpeechJob(input: { actor: PersonRow; conversationId: string; turnId: string; companionId?: string | null; temporary?: boolean; args: SpeechInput }): Promise<SpeechStart> {
  const script = input.args.script.trim();
  const delivery = (input.args.delivery ?? "").trim().slice(0, 240);
  if (!script || script.length > 4000) return { ok: false, status: 400, line: "Write a script from 1 to 4000 characters." };
  const refusal = videoRefusalFor(makeAudienceOf(input.actor), { prompt: script });
  if (refusal) return { ok: false, status: 403, line: refusal.line };
  if ([...liveJobs.values()].some((job) => job.personId === input.actor.id && ["queued", "running"].includes(job.state)) || db.select({ id: musicJobs.id }).from(musicJobs).where(and(eq(musicJobs.personId, input.actor.id), eq(musicJobs.state, "running"))).get()) {
    return { ok: false, status: 409, line: "A recording is already being made. Wait for it to finish, then try again." };
  }
  const options = await voicesFor(input.actor);
  const voice = options.find((item) => item.id === (input.args.voice ?? ""));
  if (!voice) return { ok: false, status: 422, line: "Choose a voice from the list, then try again." };
  const tags = tagsForDelivery(delivery, voice.tags);
  const now = new Date().toISOString();
  const request: MusicRequest = { description: "", instrumental: false, seconds: Math.max(1, Math.ceil(script.length / 14)), speech: { script, voice: voice.id, voiceName: voice.label, delivery, tags, kind: voice.kind } };
  const job: MusicJob = { id: newMusicJobId(), personId: input.actor.id, conversationId: input.conversationId, turnId: input.turnId, companionId: input.companionId ?? null, task: "text2music", request, stackJob: null, state: "queued", stage: "queued", progress: 0, etaSeconds: null, position: null, errorCode: null, errorLine: null, fileId: null, parentFileId: null, coverJobId: null, coverFileId: null, seed: null, durationS: null, lrc: null, timedWords: null, chosenAt: null, createdAt: now, updatedAt: now, temporary: false };
  liveJobs.set(job.id, job); saveMusicJob(job); void runSpeech(job, input.actor);
  return { ok: true, job };
}

export async function resumeSpeechJob(job: MusicJob): Promise<void> {
  if (!job.request.speech) return;
  const row = db.select().from(people).where(eq(people.id, job.personId)).get() as PersonRow | undefined;
  if (!row) { finishFailed(job, "lost_person", "The recording did not finish. Ask for it again."); return; }
  liveJobs.set(job.id, job); await runSpeech(job, row);
}
