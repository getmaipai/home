import sharp from "sharp";
import { createHash } from "node:crypto";
import type { PersonRow } from "@/types";
import { storeFile } from "@/lib/attachments";
import { checkImages } from "@/lib/pictures/ageCheck";
import { gateFinished } from "@/lib/pictures/laneGate";
import { submitGeneration, getGenerationJob, fetchPicture, cancelOrDelete } from "@/lib/pictures/stack";
import { createMediaProduction } from "@/lib/mediaProductions";
import { createMediaSubject, listMediaSubjects } from "@/lib/mediaSubjects";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { runGenerateMusic } from "@/lib/music/tool";
import { getMusicJobFor } from "@/lib/music/jobs";
import { runGenerateVideo } from "@/lib/videos/tool";
import { makeAudienceOf } from "@/lib/videos/make";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { runEditVideo } from "@/lib/videos/editTool";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { planFilm, type FilmPlan, type PlanFilmInput } from "./plan";
import { changeMusic, redoShot, runFilm, type FilmEngines, type FilmStage } from "./run";

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

function backgroundTurn(actor: PersonRow) {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "Make a film", { reply: { text: "Making your film." }, source: "plugin", plugin_id: "film", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conversation.value.id, turn_id: turnId });
  return { conversationId: conversation.value.id, turnId };
}

export function realFilmEngines(input: { actor: PersonRow; signal: AbortSignal; productionId: string }): FilmEngines {
  const { actor, signal, productionId } = input;
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
    async makeStill({ shot, castLocked }) {
      const prompt = [shot.still, ...castLocked].filter(Boolean).join(" ");
      const seed = createHash("sha256").update(shot.id).digest().readUInt32BE(0);
      const submitted = await submitGeneration({ prompt, size: "1024x576", n: 1, seed, audience: "adult", timeout_ms: 1 });
      try {
        let data = submitted.done;
        const deadline = Date.now() + 8 * 60_000;
        while (!data?.length && Date.now() < deadline) {
          if (signal.aborted) throw signal.reason ?? new Error("Aborted");
          const job = await getGenerationJob(submitted.job);
          if (job.state === "failed" || job.state === "cancelled") throw new Error("The picture could not be made.");
          if (job.state === "done") data = job.data;
          else await sleep(250, signal);
        }
        if (!data?.length) throw new Error("The picture took too long. Try again.");
        const bytes = await fetchPicture(submitted.job, 0);
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
    async makeClip({ shot }) {
      const prompt = `${shot.motion}${shot.line ? ` Say "${shot.line}".` : ""}`;
      const result = await runGenerateVideo({ state, args: { prompt, production: productionId, shot: shot.id, seconds: shot.seconds }, callId: `film-${shot.id}`, spoken: false, audience: makeAudienceOf(actor) });
      const jobId = (result.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
      if (!jobId) throw new Error("The video could not be started.");
      const job = await poll(() => getVideoJobFor(actor, jobId), signal, 25 * 60_000, (value) => value.state === "failed" || value.state === "cancelled" ? "The video did not finish." : null);
      const id = job.files[0]?.id;
      if (!id) throw new Error("The finished video is unavailable.");
      return id;
    },
    async makeMusic({ brief, seconds }) {
      turn ??= backgroundTurn(actor);
      const result = await runGenerateMusic({ state: { actor, surface: "chat", conversationId: turn.conversationId, turnId: turn.turnId, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: brief, musicAllowed: true, musicEditAllowed: true, crisis: false } as never, args: { description: brief, instrumental: true, seconds, tier: "standard" }, callId: "film-music", spoken: false });
      const jobId = (result.result?.data as { musicJobId?: string } | undefined)?.musicJobId;
      if (!jobId) throw new Error("The song could not be started.");
      const job = await poll(() => getMusicJobFor(actor, jobId), signal, 15 * 60_000, (value) => value.state === "failed" || value.state === "cancelled" ? value.errorLine ?? "The song did not finish." : null);
      if (!job.fileId) throw new Error("The finished song is unavailable.");
      return job.fileId;
    },
    async assemble({ plan, musicFileId }) {
      const film = await runEditVideo({ state, args: { change: "film", production: productionId, ...(plan.look ? { look: plan.look } : {}), ...(plan.letterbox ? { letterbox: plan.letterbox } : {}) }, callId: "film-assemble", spoken: false });
      let id = (film.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
      if (!id) throw new Error("The film could not be assembled.");
      let job = await poll(() => getVideoJobFor(actor, id!), signal, 25 * 60_000, (value) => value.state === "failed" || value.state === "cancelled" ? "The film could not be assembled." : null);
      const cut = job.files[0]?.id;
      if (!cut) throw new Error("The assembled film is unavailable.");
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

export async function makeFilm(input: { actor: PersonRow; idea: string; shots?: number; look?: string; castHints?: string[]; signal: AbortSignal; onProgress?: FilmEngines["onProgress"] }): Promise<{ productionId: string; plan: FilmPlan; filmFileId: string; note?: string } | { line: string }> {
  if (input.actor.role === "guest" || laneOfPerson(input.actor) !== "adult") return { line: "Making a film is for adults on their own written screen." };
  const planned = await planFilm({ idea: input.idea, shots: input.shots, look: input.look, castHints: input.castHints });
  if (!planned.ok) return { line: planned.line };
  const production = createMediaProduction(input.actor, { title: planned.plan.title, summary: planned.plan.summary });
  const engines = realFilmEngines({ actor: input.actor, signal: input.signal, productionId: production.id });
  engines.onProgress = input.onProgress;
  const completed = await runFilm({ actor: input.actor, productionId: production.id, plan: planned.plan, engines, signal: input.signal });
  const filmFileId = completed.finished_cut_file_ids.at(-1);
  if (!filmFileId) throw new Error("The film did not finish.");
  return { productionId: production.id, plan: planned.plan, filmFileId, ...(engines.note ? { note: engines.note } : {}) };
}

export async function resumeFilm(input: { actor: PersonRow; productionId: string; plan: FilmPlan; signal: AbortSignal; onProgress?: FilmEngines["onProgress"] }) {
  const engines = realFilmEngines({ actor: input.actor, signal: input.signal, productionId: input.productionId }); engines.onProgress = input.onProgress;
  return runFilm({ ...input, engines });
}
export async function redoFilmShot(input: { actor: PersonRow; productionId: string; plan: FilmPlan; shotId: string; signal: AbortSignal; onProgress?: FilmEngines["onProgress"] }) {
  const engines = realFilmEngines({ actor: input.actor, signal: input.signal, productionId: input.productionId }); engines.onProgress = input.onProgress;
  return redoShot({ ...input, engines });
}
export async function changeFilmMusic(input: { actor: PersonRow; productionId: string; plan: FilmPlan; signal: AbortSignal; onProgress?: FilmEngines["onProgress"] }) {
  const engines = realFilmEngines({ actor: input.actor, signal: input.signal, productionId: input.productionId }); engines.onProgress = input.onProgress;
  return changeMusic({ ...input, engines });
}
