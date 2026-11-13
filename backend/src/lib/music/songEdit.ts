// AUDIT-DUP-ROUTES-01: the one path every "make this song again with a change" route walks (revise, details, length, quality).
// Find the song's latest finished version, check the maker is ready, plan the edit, refuse unsuitable words,
// clamp the length to what the maker can do, start the job. The routes supply only their plan input and their own tier checks.
import type { PersonRow } from "@/types";
import { getMusicJobFor, musicVersions, plainMusicFailure, startMusicJob, type MusicJob } from "@/lib/music/jobs";
import { musicEngineStatus, musicStatusReady } from "@/lib/music/ready";
import { prepareMusicEdit } from "@/lib/music/tool";
import { MUSIC_REFUSAL_LINE, refuseMusicPrompt } from "@/lib/music/policy";
import { StackMusicError } from "@/lib/music/stack";
import { musicJobLockState } from "@/lib/music/lock";

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
  if (root && musicJobLockState(root, actor) !== "open") return refuse({ status: 404, error: SONG_GONE_LINE });
  const versions = root ? musicVersions(actor, root).filter((j) => j.state === "done" && j.fileId && musicJobLockState(j, actor) === "open" && (!options.skipStems || j.task !== "stems")) : [];
  const latest = () => versions.sort((a, b) => (b.chosenAt ?? b.createdAt).localeCompare(a.chosenAt ?? a.createdAt))[0];
  const source = (options.fileId ? versions.find((j) => j.fileId === options.fileId) : latest()) ?? null;
  if (!root || !source || !source.conversationId || !source.turnId) return refuse({ status: 404, error: SONG_GONE_LINE });
  const engine = await musicEngineStatus();
  if (!musicStatusReady(engine)) return refuse({ status: 503, error: plainMusicFailure("not_installed") });
  const ready = engine!;
  const early = options.beforePlan?.(ready);
  if (early) return refuse(early);
  const plan = prepareMusicEdit(source, { track: source.fileId!, ...options.input(source) } as EditInput, ready.limits);
  if (!plan.ok) return refuse({ status: 422, error: plan.line });
  options.patch?.(plan);
  const words = [plan.request.description, plan.request.lyrics, plan.request.written_lyrics, plan.request.title, plan.request.key, plan.request.language].filter(Boolean).join(" ");
  const refusal = refuseMusicPrompt(words);
  if (refusal) return refuse({ status: 403, error: MUSIC_REFUSAL_LINE[refusal] });
  const late = options.extraChecks?.(plan, ready);
  if (late) return refuse(late);
  plan.request.seconds = Math.min(plan.request.seconds, ready.limits.max_seconds);
  plan.body.duration_s = plan.request.seconds;
  try { await startMusicJob({ actor, conversationId: source.conversationId, turnId: source.turnId, temporary: source.temporary, task: plan.task, request: plan.request, body: plan.body, parentFileId: source.fileId }); }
  catch (error) { return refuse({ status: 503, error: plainMusicFailure(error instanceof StackMusicError ? error.code : "failed") }); }
  return { ok: true, root };
}
