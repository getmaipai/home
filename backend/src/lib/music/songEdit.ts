// AUDIT-DUP-ROUTES-01: the one path every "make this song again with a change" route walks (revise, details, length, quality).
// Find the song's latest finished version, check the maker is ready, plan the edit, refuse unsuitable words and likenesses,
// clamp the length to what the maker can do, start the job. The routes supply only their plan input and their own tier checks.
import type { PersonRow } from "@/types";
import { getMusicJobFor, musicVersions, plainMusicFailure, startMusicJob, type MusicJob } from "@/lib/music/jobs";
import { musicEngineStatus, musicStatusReady } from "@/lib/music/ready";
import { prepareMusicEdit, sizeSong } from "@/lib/music/tool";
import { musicProtections } from "@/lib/music/policy";
import { routeAudience } from "@/lib/pictures/audience";
import { laneOf, reserveKid, releaseKid, CHILD_LIMIT_LINE } from "@/lib/pictures/lane";
import { rewriteForChild } from "@/lib/contentPolicy/rewrite";
import { likenessRefusal } from "@/lib/likeness";
import { StackMusicError } from "@/lib/music/stack";

export const SONG_GONE_LINE = "That song isn't available any more. Ask for it again.";

type Engine = NonNullable<Awaited<ReturnType<typeof musicEngineStatus>>>;
type EditInput = Parameters<typeof prepareMusicEdit>[1];
type Plan = Extract<ReturnType<typeof prepareMusicEdit>, { ok: true }>;
export type SongEditRefusal = { status: 403 | 404 | 422 | 503; error: string };
export type SongEditResult = { ok: true; root: MusicJob } | ({ ok: false } & SongEditRefusal);

export type SongEditOptions = {
  actor: PersonRow;
  jobId: string;
  /** A specific version to edit; the latest finished one when absent. */
  fileId?: string;
  /** Details and Stems skip stem results when choosing the source. */
  skipStems?: boolean;
  /** What to ask `prepareMusicEdit` for, from the chosen source (revise builds its new description from it). */
  input: (source: MusicJob) => Omit<EditInput, "track">;
  /** Checks that come before the plan is made (the quality route's Boost line). */
  beforePlan?: (engine: Engine) => SongEditRefusal | null;
  /** Adjust the plan before the word and likeness refusals read it (revise puts its new description in). */
  patch?: (plan: Plan) => void;
  /** Checks after the refusals that may also finish the plan (the quality route's Max lines and quality fields). */
  extraChecks?: (plan: Plan, engine: Engine) => SongEditRefusal | null;
};

const refuse = (refusal: SongEditRefusal): SongEditResult => ({ ok: false, ...refusal });

export async function runSongEdit(options: SongEditOptions): Promise<SongEditResult> {
  const { actor } = options;
  const root = getMusicJobFor(actor, options.jobId);
  const versions = root ? musicVersions(actor, root).filter((j) => j.state === "done" && j.fileId && (!options.skipStems || j.task !== "stems")) : [];
  const latest = () => versions.sort((a, b) => (b.chosenAt ?? b.createdAt).localeCompare(a.chosenAt ?? a.createdAt))[0];
  const source = (options.fileId ? versions.find((j) => j.fileId === options.fileId) : latest()) ?? null;
  if (!root || !source || !source.conversationId || !source.turnId) return refuse({ status: 404, error: SONG_GONE_LINE });
  const engine = await musicEngineStatus();
  if (!musicStatusReady(engine)) return refuse({ status: 503, error: plainMusicFailure("not_installed") });
  const ready = engine!;
  const early = options.beforePlan?.(ready);
  if (early) return refuse(early);
  const editInput = options.input(source);
  const audience = routeAudience(actor), lane = laneOf(audience);
  if (lane === "child" && ["make_full", "extend"].includes(editInput.change)) return refuse({ status: 422, error: "Let's keep your song short." });
  // An instrumental remake of a sung song is a cover the Stack does not transcribe, so a minor cannot ask for one.
  if (lane !== "adult" && editInput.change === "instrumental") return refuse({ status: 403, error: "You can change only your own song from this chat." });
  const plan = prepareMusicEdit(source, { track: source.fileId!, ...editInput } as EditInput, ready.limits);
  if (!plan.ok) return refuse({ status: 422, error: plan.line });
  options.patch?.(plan);
  if (lane !== "adult") {
    if (source.request.ownedFile || source.conversationId !== root.conversationId) return refuse({ status: 403, error: "You can change only your own song from this chat." });
    if (lane === "child") {
      const rewritten = await rewriteForChild({ kind: "song", description: plan.request.description, ...(plan.request.lyrics !== undefined ? { lyrics: plan.request.lyrics } : {}), ...(plan.request.title !== undefined ? { title: plan.request.title } : {}) });
      if (!rewritten.ok) return refuse({ status: 403, error: rewritten.redirect });
      plan.request.description = rewritten.description; plan.request.lyrics = rewritten.usedTemplate ? undefined : rewritten.lyrics;
      plan.request.title = rewritten.title; plan.request.instrumental = rewritten.usedTemplate || plan.request.instrumental;
      plan.request.length = "quick"; sizeSong(plan.request, plan.request.written_lyrics ?? plan.request.lyrics, { min_seconds: ready.limits.min_seconds, max_seconds: Math.min(60, ready.limits.max_seconds) });
      plan.body.caption = plan.request.description; plan.body.lyrics = plan.request.lyrics; plan.body.instrumental = plan.request.instrumental;
    }
    plan.request.transcribe = true; plan.body.transcribe = true;
  }
  const protections = musicProtections(audience);
  const words = [plan.request.description, plan.request.lyrics, plan.request.written_lyrics, plan.request.title, plan.request.key, plan.request.language].filter(Boolean).join(" ");
  const combinedRefusal = protections.checkWords(words, "prompt");
  if (combinedRefusal) return refuse({ status: 403, error: combinedRefusal });
  for (const [text, field] of [[plan.request.description, "prompt"], [plan.request.lyrics, "lyrics"], [plan.request.written_lyrics, "lyrics"], [plan.request.title, "title"]] as const) {
    if (text === undefined) continue;
    const line = protections.checkWords(text, field);
    if (line) return refuse({ status: 403, error: line });
  }
  const likeness = likenessRefusal(actor, [plan.request.description, plan.request.lyrics, plan.request.written_lyrics, plan.request.title].filter(Boolean).join(" "));
  if (likeness) return refuse({ status: 403, error: likeness });
  const late = options.extraChecks?.(plan, ready);
  if (late) return refuse(late);
  plan.request.seconds = Math.min(plan.request.seconds, ready.limits.max_seconds);
  plan.body.duration_s = plan.request.seconds;
  const kidSlot = lane === "child" ? reserveKid(actor, "picture", 1, plan.request.description) : null;
  if (lane === "child" && !kidSlot) return refuse({ status: 422, error: CHILD_LIMIT_LINE });
  try { await startMusicJob({ actor, conversationId: source.conversationId, turnId: source.turnId, temporary: source.temporary, task: plan.task, request: plan.request, body: plan.body, parentFileId: source.fileId, kidUsageId: kidSlot }); }
  catch (error) { releaseKid(kidSlot); return refuse({ status: 503, error: plainMusicFailure(error instanceof StackMusicError ? error.code : "failed") }); }
  return { ok: true, root };
}
