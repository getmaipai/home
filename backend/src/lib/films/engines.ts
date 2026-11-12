import sharp from "sharp";
import { createHash } from "node:crypto";
import type { PersonRow } from "@/types";
import { readAttachment, storeFile } from "@/lib/attachments";
import { checkImages } from "@/lib/pictures/ageCheck";
import { gateFinished } from "@/lib/pictures/laneGate";
import { submitGeneration, submitEdit, getGenerationJob, fetchPicture, cancelOrDelete } from "@/lib/pictures/stack";
import { fullViewForJob } from "@/lib/stack/fullView";
import { createMediaProduction } from "@/lib/mediaProductions";
import { createMediaSubject, listMediaSubjects, subjectsForNames } from "@/lib/mediaSubjects";
import { pickStarter } from "./pictures";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { runGenerateMusic } from "@/lib/music/tool";
import { getMusicJobFor } from "@/lib/music/jobs";
import { musicJobLockState, LOCKED_MUSIC_START_LINE } from "@/lib/music/lock";
import { fileLockState } from "@/lib/adultLock";
import { runGenerateVideo } from "@/lib/videos/tool";
import { makeAudienceOf } from "@/lib/videos/make";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { runEditVideo } from "@/lib/videos/editTool";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { voiceForSpeech } from "@/lib/voiceForSpeech";
import { speakToBytes } from "@/lib/voiceover";
import { refuseVideoPrompt } from "@/lib/videos/policy";
import { audioSeconds } from "@/lib/videos/audioLength";
import { extractKeyframes } from "@/lib/pictures/keyframes";
import { runStackEdit } from "@/lib/videos/stackEdit";
import { filmOps, filmOverhead, MAX_EDIT_OPS, MAX_EDIT_SECONDS, overlayOp, type JoinTransition } from "@/lib/videos/editPlan";
import { planFilm, type FilmPlan, type PlanFilmInput } from "./plan";
import { changeMusic, isTransientStackError, redoShot, runFilm, type FilmEngines, type FilmStage } from "./run";

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason ?? new Error("Aborted"));
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  const abort = () => { clearTimeout(timer); reject(signal.reason ?? new Error("Aborted")); };
  signal.addEventListener("abort", abort, { once: true });
});

async function poll<T>(read: () => T | null, signal: AbortSignal, timeout: number, failed: (job: T) => string | null): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason ?? new Error("Aborted");
    const job = read();
    if (job) { const issue = failed(job); if (issue) throw new Error(issue); if ((job as { state?: string }).state === "done") return job; }
    await sleep(250, signal);
  }
  throw new Error("The job took too long. Try again.");
}

export function backgroundTurn(actor: PersonRow) {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "Make a film", { reply: { text: "Making your film." }, source: "plugin", plugin_id: "film", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conversation.value.id, turn_id: turnId });
  return { conversationId: conversation.value.id, turnId };
}

/** How far a still may move away from a supplied character picture (0 keeps it, 1 ignores it). */
const REFERENCE_STILL_STRENGTH = 0.6;
/** FILM-COMPOSE-01: the place (else the person, else the object) is the picture the image engine edits; the others are its references (at most two). */
export async function submitComposition(pictured: ReadonlyArray<{ subject: { name: string; kind: string }; picture: { bytes: Uint8Array; mediaType: string } }>, scene: string): Promise<{ job: string; done: null }> {
  const order = ["place", "character", "prop"];
  const sorted = [...pictured].sort((a, b) => order.indexOf(a.subject.kind) - order.indexOf(b.subject.kind));
  const base = sorted[0]!, references = sorted.slice(1, 3);
  const instruction = `${scene} Photorealistic photograph, natural light. This picture is the setting${base.subject.kind === "place" ? "" : " and the first subject"}. ${references.map((ref, i) => `Reference picture ${i + 1} shows ${ref.subject.name}: keep it exactly as it looks there${ref.subject.kind === "character" ? ", the person facing the camera and holding the object if there is one" : ", its shape and color; any writing or printing on it is turned away from the camera and not visible"}.`).join(" ")}`.slice(0, 1500);
  const form = new FormData();
  form.append("image", new File([new Uint8Array(base.picture.bytes)], "picture", { type: base.picture.mediaType }));
  form.append("operation", "edit");
  form.append("instruction", instruction);
  form.append("image_source", "uploaded");
  const fields = ["reference", "reference2"] as const;
  references.forEach((ref, i) => { form.append(fields[i]!, new File([new Uint8Array(ref.picture.bytes)], "reference", { type: ref.picture.mediaType })); form.append(`${fields[i]}_source`, "uploaded"); });
  form.append("timeout_ms", "1");
  return { ...(await submitEdit(form)), done: null };
}

export function realFilmEngines(input: { actor: PersonRow; signal: AbortSignal; productionId: string; faceless?: boolean }): FilmEngines {
  const { actor, signal, productionId, faceless = false } = input;
  let turn: ReturnType<typeof backgroundTurn> | null = null;
  const state = { actor, surface: "chat", planBasis: { surfaceClass: "written" }, conversationId: null, turnId: null, temporary: false, ephemeral: false } as never;
  const engines: FilmEngines = {
    async waitForIdle() {},
    async ensureSubject({ name, kind, locked }) {
      const found = listMediaSubjects(actor).find((subject) => subject.name === name);
      if (found) return found.id;
      const subject = createMediaSubject(actor, { name, kind, look: locked, referenceIds: [] }, "film");
      try { const { makeSubjectSheet } = await import("@/lib/mediaSubjectSheet"); await makeSubjectSheet(actor, subject.id); } catch { /* Model sheets are optional; the saved subject remains usable. */ }
      return subject.id;
    },
    async makeStill({ shot, castLocked, exactReference }) {
      // A product that was held back and is shown now keeps its own picture: an image model redraws printed writing as nonsense (seen 2026-11-12:
      // "LITOKCUE RONHICSE"), and the writing is what the reveal is for. The picture is fitted to the film's frame on a soft copy of itself.
      const aloneNames = castLocked.map((line) => line.split(":")[0]!.trim()).filter((name) => subjectsForNames(actor, [name])?.[0]?.references[0]);
      // Only when the product is the one supplied picture in the shot: with the actor and the place also there, the shot is composed from all three below.
      if (exactReference && aloneNames.length < 2) {
        const picture = subjectsForNames(actor, [exactReference])?.[0]?.references[0];
        if (picture) {
          const base = sharp(Buffer.from(picture.bytes), { failOn: "error" }).rotate();
          const backdrop = await base.clone().resize(1024, 576, { fit: "cover" }).blur(28).modulate({ brightness: 0.85 }).png().toBuffer();
          const front = await base.clone().resize(1024, 576, { fit: "inside" }).png().toBuffer();
          const fitted = await sharp(backdrop).composite([{ input: front, gravity: "centre" }]).png().toBuffer();
          const kept = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: fitted, provenance: `picture-gen:${JSON.stringify({ v: 1, audience: "all-ages", job: `reference-${shot.id}`, index: 0, seed: 0, width: 1024, height: 576 })}`, retention: "kept", name: `Film still ${shot.id}`, deduplicate: false });
          if (kept.ok) return kept.value.id;
        }
      }
      const prompt = [shot.still, ...castLocked].filter(Boolean).join(" ");
      const seed = createHash("sha256").update(shot.id).digest().readUInt32BE(0);
      const view = fullViewForJob("adult", actor);
      // A character the person supplied pictures for starts the still from that picture, so the face carries through (retry from words alone if the Stack declines it).
      const starter = pickStarter(shot.still, castLocked.map((line) => line.split(":")[0]!.trim()).flatMap((name) => { const picture = subjectsForNames(actor, [name])?.[0]?.references[0]; return picture ? [{ name, picture }] : []; }))?.picture;
      const body = { prompt, size: "1024x576", n: 1, seed, audience: "adult" as const, timeout_ms: 1 };
      // A shot that shows several supplied pictures together (the actor holding the product outside the factory) is composed from them: the place is the
      // picture that is edited and the person and the object ride along as references (the image engine takes two), so each keeps its own look.
      const pictured = castLocked.map((line) => line.split(":")[0]!.trim()).flatMap((name) => { const found = subjectsForNames(actor, [name])?.[0]; return found?.references[0] ? [{ subject: found.subject, picture: found.references[0] }] : []; });
      const composed = pictured.length >= 2 ? await submitComposition(pictured, prompt).catch((error) => { if (isTransientStackError(error)) throw error; return null; }) : null;
      const submitted = composed ?? (starter
        ? await submitGeneration({ ...body, init_image: Buffer.from(starter.bytes).toString("base64"), image_source: "uploaded", strength: REFERENCE_STILL_STRENGTH }).catch(() => submitGeneration(body))
        : await submitGeneration(body));
      try {
        let finished = !!submitted.done?.length;
        const deadline = Date.now() + 8 * 60_000;
        while (!finished && Date.now() < deadline) {
          if (signal.aborted) throw signal.reason ?? new Error("Aborted");
          const job = await getGenerationJob(submitted.job, view);
          if (job.state === "failed" || job.state === "cancelled") throw new Error("The picture could not be made.");
          if (job.state === "done") finished = true;
          else await sleep(250, signal);
        }
        if (!finished) throw new Error("The picture took too long. Try again.");
        const bytes = await fetchPicture(submitted.job, 0, view);
        const meta = await sharp(bytes, { failOn: "error" }).metadata();
        if (meta.format !== "png" || !meta.width || !meta.height) throw new Error("The picture could not be checked.");
        const checks = await checkImages([bytes], "picture");
        const decision = await gateFinished({ actor, kind: "picture", jobId: `film-still:${shot.id}`, adultOnly: true, checks, images: [bytes], prompt });
        if (decision.action === "withhold") throw new Error(decision.line);
        const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes, provenance: `picture-gen:${JSON.stringify({ v: 1, audience: "all-ages", job: submitted.job, index: 0, seed, width: meta.width, height: meta.height })}`, retention: "kept", name: `Film still ${shot.id}`, deduplicate: false });
        if (!saved.ok) throw new Error(saved.error);
        return saved.value.id;
      } catch (error) { void cancelOrDelete(submitted.job); throw error; }
    },
    async makeClip({ shot, endStillFileId }) {
      const prompt = `${shot.motion}${shot.line ? ` Say "${shot.line}".` : ""}`;
      const result = await runGenerateVideo({ state, args: { prompt, production: productionId, shot: shot.id, seconds: shot.seconds, ...(endStillFileId ? { end_frame: endStillFileId } : {}) }, callId: `film-${shot.id}`, spoken: false, audience: makeAudienceOf(actor) });
      const jobId = (result.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
      if (!jobId) {
        const why = JSON.stringify(result.result?.reply ?? result).slice(0, 500);
        console.error(`[film] clip ${shot.id} refused: ${why}`);
        // The engine being unavailable (a restarting Stack answers "no video model is installed") is a wait, not an end: the step runner retries it.
        const unavailable = (result as { failureKind?: string; errorCode?: string }).failureKind === "unavailable" || (result as { errorCode?: string }).errorCode === "no_engine";
        throw Object.assign(new Error(`The video could not be started: ${why}`), unavailable ? { code: "unavailable" } : {});
      }
      const job = await poll(() => getVideoJobFor(actor, jobId), signal, 25 * 60_000, (value) => value.state === "failed" || value.state === "cancelled" ? "The video did not finish." : null);
      const id = job.files[0]?.id;
      if (!id) throw new Error("The finished video is unavailable.");
      return id;
    },
    async makeNarration({ shot }) {
      if (!shot.line || refuseVideoPrompt(shot.line, { lane: "adult" })) throw new Error("The narration line could not be used.");
      const voice = voiceForSpeech({ actor });
      const spoken = await speakToBytes(shot.line, voice);
      if (!spoken.ok || spoken.seconds === null) throw new Error("Home can't speak right now. Try again in a minute.");
      const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "audio/wav", bytes: spoken.bytes, provenance: `voiceover:${JSON.stringify({ v: 1, source: "film-narration", shot: shot.id, engine: spoken.engine, ...(spoken.revision ? { revision: spoken.revision } : {}), voice, kind: "household" })}`, retention: "kept", name: `Film narration ${shot.id}`, deduplicate: false });
      if (!saved.ok) throw new Error("Home could not keep the narration file.");
      return { fileId: saved.value.id, seconds: spoken.seconds };
    },
    async readNarration({ fileId }) {
      const result = readAttachment(actor, fileId);
      if (!result.ok) throw new Error("The saved narration could not be read.");
      const seconds = audioSeconds(result.value.bytes);
      if (seconds === null) throw new Error("The saved narration length could not be measured.");
      return { fileId, seconds };
    },
    async makeMotionClip({ shot, stillFileId, narrationFileId, seconds }) {
      const still = readAttachment(actor, stillFileId), narration = readAttachment(actor, narrationFileId);
      if (!still.ok || !narration.ok) throw new Error("A film picture or narration file is missing.");
      const direction = shot.motion.toLowerCase();
      const pan = direction === "pan left" ? "left" : direction === "pan right" ? "right" : "none";
      const zoomFrom = direction === "zoom out" ? 1.2 : 1;
      const zoomTo = direction === "zoom out" ? 1 : direction === "zoom in" ? 1.2 : 1;
      const duration = Math.max(shot.seconds, seconds + 0.6);
      const edited = await runStackEdit({ inputs: [{ bytes: still.value.bytes, ext: "png" }, { bytes: narration.value.bytes, ext: "wav" }], ops: [{ op: "kenburns", zoom_from: zoomFrom, zoom_to: zoomTo, pan, duration_s: duration }, { op: "audio_overlay", input: 1, gain_db: 0, clip_gain_db: -60, start_s: 0, duck: false }], name: `film-${shot.id}.mp4`, signal });
      if (!edited.ok) throw new Error(edited.line);
      const frames = await extractKeyframes(edited.bytes, edited.seconds);
      if (!frames?.length) throw new Error("The finished clip could not be checked.");
      const checks = await checkImages(frames, "video");
      const decision = await gateFinished({ actor, kind: "video", jobId: `film-motion:${shot.id}`, adultOnly: true, checks, images: frames, prompt: shot.still });
      if (decision.action === "withhold") throw new Error(decision.line);
      const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: edited.bytes, provenance: `video-edit:${JSON.stringify({ v: 1, kind: "film-motion", shot: shot.id, still: stillFileId, narration: narrationFileId, seconds: edited.seconds })}`, retention: "kept", name: `Film clip ${shot.id}`, deduplicate: false });
      if (!saved.ok) throw new Error(saved.error);
      return saved.value.id;
    },
    async makeMusic({ brief, seconds }) {
      turn ??= backgroundTurn(actor);
      const result = await runGenerateMusic({ state: { actor, surface: "chat", conversationId: turn.conversationId, turnId: turn.turnId, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: brief, musicAllowed: true, musicEditAllowed: true, crisis: false } as never, args: { description: brief, instrumental: true, seconds, tier: "standard" }, callId: "film-music", spoken: false });
      const jobId = (result.result?.data as { musicJobId?: string } | undefined)?.musicJobId;
      if (!jobId) throw new Error("The song could not be started.");
      const job = await poll(() => getMusicJobFor(actor, jobId), signal, 15 * 60_000, (value) => value.state === "failed" || value.state === "cancelled" ? value.errorLine ?? "The song did not finish." : null);
      if (musicJobLockState(job, actor) !== "open") throw new Error(LOCKED_MUSIC_START_LINE);
      if (!job.fileId) throw new Error("The finished song is unavailable.");
      return job.fileId;
    },
    async assemble({ plan, clipFileIds, musicFileId }) {
      if (fileLockState(actor, musicFileId) !== "open") throw new Error(LOCKED_MUSIC_START_LINE);
      if (faceless) {
        const production = await import("@/lib/mediaProductions").then(({ getMediaProduction }) => getMediaProduction(actor, productionId));
        if (!production) throw new Error("The film production is unavailable.");
        const shots = production.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots));
        const clipIds = clipFileIds;
        if (clipIds.length < 2) throw new Error("Make at least two shots first.");
        const transitionCount = Math.max(0, clipIds.length - 1);
        const videoSeconds = shots.map((shot) => plan.shots.find((item) => item.id === shot.id)?.seconds ?? null);
        const baseLength = videoSeconds.every((seconds): seconds is number => seconds !== null)
          ? videoSeconds.reduce<number>((sum, seconds) => sum + seconds, 0) - transitionCount * 0.5
          : videoSeconds.reduce<number>((sum, seconds) => sum + (seconds ?? 0), 0);
        const creditLines = plan.credits_card === false ? [] : [...plan.credits.filter((entry) => !/^(unnamed|unknown|n\/a|none|tbd|(?:a )?real person'?s name)$/i.test(entry.name.trim()) && entry.name.trim().length > 0), { role: "Made with", name: "MaiPai" }];
        const showTitle = plan.title_card !== false, showCredits = plan.credits_card !== false;
        const added = filmOverhead(showTitle, showCredits, creditLines.length);
        const totalSeconds = baseLength + added;
        if (totalSeconds > MAX_EDIT_SECONDS) throw new Error("That film would be longer than 10 minutes. Use shorter videos or fewer title and credit lines.");
        const clips = clipIds.map((id) => readAttachment(actor, id));
        const music = readAttachment(actor, musicFileId);
        if (clips.some((item) => !item.ok) || !music.ok) throw new Error("A film clip or music file is missing.");
        const credits = creditLines;
        const transitions = plan.shots.slice(1).map((shot) => (shot.transition ?? "fade") as JoinTransition);
        const ops: import("@/lib/videos/stackEdit").EditOp[] = [];
        if (transitions.length) ops.push(...filmOps({ transition: transitions[0], includeJoin: true }));
        for (let i = 1; i < transitions.length; i++) ops.push(...filmOps({ transition: transitions[i], includeJoin: true }));
        ops.push(...filmOps({ includeJoin: false, title: showTitle ? plan.title : undefined, summary: plan.summary, credits: showCredits ? credits : undefined, look: plan.look, letterbox: plan.letterbox }));
        ops.push(overlayOp(clipIds.length, { gain_db: -12, clip_gain_db: 0, fade_out_s: 2 }, 0, false));
        if (ops.length > MAX_EDIT_OPS) throw new Error("That film needs too many editing steps.");
        const editInputs = clips.map((item) => {
          if (!item.ok) throw new Error("A film clip is missing.");
          return { bytes: item.value.bytes, ext: "mp4" };
        });
        const edited = await runStackEdit({ inputs: [...editInputs, { bytes: music.value.bytes, ext: "mp3" }], ops, name: "film-faceless.mp4", signal });
        if (!edited.ok) throw new Error(edited.line);
        const frames = await extractKeyframes(edited.bytes, edited.seconds);
        if (!frames?.length) throw new Error("The finished film could not be checked.");
        const checks = await checkImages(frames, "video");
        const decision = await gateFinished({ actor, kind: "video", jobId: `film-faceless:${productionId}`, adultOnly: true, checks, images: frames, prompt: plan.shots.map((shot) => shot.still).join(" ") });
        if (decision.action === "withhold") throw new Error(decision.line);
        const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: edited.bytes, provenance: `video-edit:${JSON.stringify({ v: 1, kind: "film-faceless", clips: clipIds, music: musicFileId })}`, retention: "kept", name: `${plan.title}.mp4`, deduplicate: false });
        if (!saved.ok) throw new Error(saved.error);
        return saved.value.id;
      }
      const film = await runEditVideo({ state, args: { change: "film", production: productionId, ...(plan.title_card === false ? { no_title: true } : {}), ...(plan.credits_card === false ? { no_credits: true } : {}), ...(plan.look ? { look: plan.look } : {}), ...(plan.letterbox ? { letterbox: plan.letterbox } : {}) }, callId: "film-assemble", spoken: false });
      let id = (film.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
      if (!id) { console.error("[film] assemble refused", JSON.stringify(film.result?.reply ?? film).slice(0, 600)); throw new Error("The film could not be assembled."); }
      let job = await poll(() => getVideoJobFor(actor, id!), signal, 25 * 60_000, (value) => value.state === "failed" || value.state === "cancelled" ? "The film could not be assembled." : null);
      const cut = job.files[0]?.id;
      if (!cut) throw new Error("The assembled film is unavailable.");
      const made = job.files[0]?.seconds;
      if (plan.target_seconds && typeof made === "number" && Math.abs(made - plan.target_seconds) > 1.5) engines.note = `It came out about ${Math.round(made)} seconds; you asked for ${plan.target_seconds}.`;
      const mixed = await runEditVideo({ state, args: { change: "mix", clip: job.id, sound: "music", track: musicFileId }, callId: "film-mix", spoken: false });
      id = (mixed.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
      if (!id) { engines.note = "The film is ready, but I couldn't add its music."; return cut; }
      try {
        job = await poll(() => getVideoJobFor(actor, id!), signal, 25 * 60_000, (value) => value.state === "failed" || value.state === "cancelled" ? "The music mix failed." : null);
        if (job.files[0]?.id) return job.files[0].id;
        engines.note = "The film is ready, but I couldn't add its music.";
        return cut;
      } catch (error) {
        if (signal.aborted) throw error;
        engines.note = "The film is ready, but I couldn't add its music.";
        return cut;
      }
    },
  };
  return engines;
}

export async function makeFilm(input: { actor: PersonRow; idea: string; shots?: number; look?: string; castHints?: string[]; faceless?: boolean; signal: AbortSignal; onProgress?: FilmEngines["onProgress"] }): Promise<{ productionId: string; plan: FilmPlan; filmFileId: string; note?: string } | { line: string }> {
  if (input.actor.role === "guest" || laneOfPerson(input.actor) !== "adult") return { line: "Making a film is for adults on their own written screen." };
  const planned = await planFilm({ idea: input.idea, shots: input.shots, look: input.look, castHints: input.castHints, faceless: input.faceless });
  if (!planned.ok) return { line: planned.line };
  const production = createMediaProduction(input.actor, { title: planned.plan.title, summary: planned.plan.summary });
  const engines = realFilmEngines({ actor: input.actor, signal: input.signal, productionId: production.id, faceless: input.faceless });
  engines.onProgress = input.onProgress;
  const completed = await runFilm({ actor: input.actor, productionId: production.id, plan: planned.plan, faceless: input.faceless, engines, signal: input.signal });
  const filmFileId = completed.finished_cut_file_ids.at(-1);
  if (!filmFileId) throw new Error("The film did not finish.");
  return { productionId: production.id, plan: planned.plan, filmFileId, ...(engines.note ? { note: engines.note } : {}) };
}

export async function resumeFilm(input: { actor: PersonRow; productionId: string; plan: FilmPlan; faceless?: boolean; signal: AbortSignal; onProgress?: FilmEngines["onProgress"] }) {
  const engines = realFilmEngines({ actor: input.actor, signal: input.signal, productionId: input.productionId, faceless: input.faceless }); engines.onProgress = input.onProgress;
  return runFilm({ ...input, engines });
}
export async function redoFilmShot(input: { actor: PersonRow; productionId: string; plan: FilmPlan; faceless?: boolean; shotId: string; signal: AbortSignal; onProgress?: FilmEngines["onProgress"] }) {
  const engines = realFilmEngines({ actor: input.actor, signal: input.signal, productionId: input.productionId, faceless: input.faceless }); engines.onProgress = input.onProgress;
  return redoShot({ ...input, engines });
}
export async function changeFilmMusic(input: { actor: PersonRow; productionId: string; plan: FilmPlan; faceless?: boolean; signal: AbortSignal; onProgress?: FilmEngines["onProgress"] }) {
  const engines = realFilmEngines({ actor: input.actor, signal: input.signal, productionId: input.productionId, faceless: input.faceless }); engines.onProgress = input.onProgress;
  return changeMusic({ ...input, engines });
}
