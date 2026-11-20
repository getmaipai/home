// VF-CHECK-01 (Home half): after a film is exported, the Stack's `media.verify` job checks the FINISHED file against the film's own shot
// list (picture not black or frozen, sound where a shot needs it, no shot carrying another shot's sound, each spoken line heard once in its
// own shot). Home runs nothing itself (E3): it builds the shot list, passes its one rule table (CLIP_RULES) in `rules`, and turns the
// Stack's verdict into plain lines for the film's own card (S6: the progress note, no new status surface). The check is advisory: a Stack
// that cannot answer, a remote Stack or a result whose length does not match the plan means "not checked", never "passed" and never a failure.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import { newFileId } from "@/lib/id";
import { CLIP_RULES } from "@/lib/videos/frameCheck";
import { creditsSecondsFor, SEAM_SECONDS, TITLE_CARD_SECONDS } from "@/lib/videos/editPlan";
import { getStackClient, isRemoteStackSelected } from "@/lib/stackEngine";
import { stageClipForStack } from "@/lib/videos/stackEdit";
import type { FilmPlan } from "@/lib/films/plan";

export interface VerifyShot { id: string; start_s: number; end_s: number; kind: "moving"; line?: string }
export interface FilmShotList { shots: VerifyShot[]; /** Where the plan says the picture ends, before the credits. */ picture_end_s: number; total_s: number }

/** The shot windows of an exported film, from the plan: the title card first, then each kept shot, each seam but a cut overlapping by the blend length. */
export function filmShotList(plan: Pick<FilmPlan, "shots" | "title_card" | "credits_card" | "credits">): FilmShotList {
  const kept = plan.shots.filter((shot) => (shot as { kept?: boolean }).kept !== false);
  let at = plan.title_card === false ? 0 : TITLE_CARD_SECONDS;
  const shots: VerifyShot[] = [];
  kept.forEach((shot, i) => {
    if (i > 0 && (shot.transition ?? "fade") !== "cut") at -= SEAM_SECONDS;
    shots.push({ id: shot.id, start_s: Math.round(at * 100) / 100, end_s: Math.round((at + shot.seconds) * 100) / 100, kind: "moving", ...(shot.line?.trim() ? { line: shot.line.trim() } : {}) });
    at += shot.seconds;
  });
  const credits = plan.credits_card === false ? 0 : creditsSecondsFor(plan.credits?.length ?? 1);
  return { shots, picture_end_s: Math.round(at * 100) / 100, total_s: Math.round((at + credits) * 100) / 100 };
}

interface Check { check: string; status: string; shot_id?: string; other_shot_id?: string; value?: number | string }
export interface VerifyReply { verdict: "pass" | "fail" | "incomplete"; checks: Check[]; file: { duration_s: number | null } }
export interface FilmVerdict { checked: boolean; lines: string[] }
const AGAIN = "Render that shot again.";

/** The film's card lines for a verdict, by shot number in the film. Plain words, what is wrong and what to do. */
export function verdictLines(reply: VerifyReply, shotIds: string[]): string[] {
  const n = (id?: string): number => shotIds.indexOf(id ?? "") + 1;
  const out: string[] = [];
  for (const c of reply.checks.filter((item) => item.status === "fail")) {
    const a = n(c.shot_id), b = n(c.other_shot_id);
    if (c.check === "speech.line") {
      if (b) out.push(`Shot ${a}: its line is heard in shot ${b} instead. Render shot ${a} again.`);
      else if (typeof c.value === "number" && c.value >= 2) out.push(`Shot ${a}: its line is heard twice. ${AGAIN}`);
      else if (c.value === 0) out.push(`Shot ${a}: no speech is heard where a line is expected. ${AGAIN}`);
      else out.push(`Shot ${a}: the words heard are not the line. ${AGAIN}`);
    } else if (c.check === "sound.copied") out.push(`Shots ${a} and ${b} carry the same sound. Render them again.`);
    else if (c.check === "sound.silent") out.push(`Shot ${a}: there is no sound where sound is expected. ${AGAIN}`);
    else if (c.check === "sound.quiet") out.push(`Shot ${a} is much quieter than the others. ${AGAIN}`);
    else if (c.check === "picture.black") out.push(a ? `Shot ${a}: the picture goes black. ${AGAIN}` : "Part of the film is black. Render the film again.");
    else if (c.check === "picture.frozen") out.push(a ? `Shot ${a}: the picture stops moving. ${AGAIN}` : "Part of the film stops moving. Render the film again.");
    else if (c.check.startsWith("shape.")) out.push("The finished film is not the size or length that was asked for. Make it again.");
  }
  return [...new Set(out)];
}

export interface VerifyDeps {
  submit(input: Record<string, unknown>): Promise<{ id: string; state: string; result?: unknown }>;
  job(id: string): Promise<{ id: string; state: string; result?: unknown }>;
  sleep(ms: number): Promise<void>;
  remote(): boolean;
}
const realDeps = (): VerifyDeps => ({
  submit: (input) => getStackClient().submitJob({ kind: "media.verify", input }) as Promise<{ id: string; state: string; result?: unknown }>,
  job: (id) => getStackClient().job(id) as Promise<{ id: string; state: string; result?: unknown }>,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  remote: isRemoteStackSelected,
});
const DEADLINE_MS = 10 * 60_000, POLL_MS = 1000, DURATION_SLACK_S = 2;

/** Asks the Stack to verify a finished film file at `path` (a path the Stack may read). Never throws. */
export async function verifyFinishedFilm(input: { path: string; plan: Parameters<typeof filmShotList>[0]; signal?: AbortSignal }, deps: VerifyDeps = realDeps()): Promise<FilmVerdict> {
  const unchecked: FilmVerdict = { checked: false, lines: [] };
  try {
    if (deps.remote()) return unchecked;
    const list = filmShotList(input.plan);
    const expectShots = list.shots.map(({ id, start_s, end_s, kind, line }) => ({ id, start_s, end_s, kind, ...(line ? { line } : {}) }));
    const rules = { blackLuma: CLIP_RULES.blackLuma, blackSeconds: CLIP_RULES.blackSeconds, frozenDiff: CLIP_RULES.frozenDiff, frozenSeconds: CLIP_RULES.frozenSeconds };
    let job = await deps.submit({ path: input.path, expect: { shots: expectShots, has_audio: true }, rules });
    const deadline = Date.now() + DEADLINE_MS;
    while (["queued", "running", "paused", "stalled"].includes(job.state)) {
      if (Date.now() > deadline || input.signal?.aborted) return unchecked;
      await deps.sleep(POLL_MS);
      job = await deps.job(job.id);
    }
    const reply = job.state === "done" ? job.result as VerifyReply | undefined : undefined;
    if (!reply || !Array.isArray(reply.checks)) return unchecked;
    // The shot windows come from the plan. If the finished file's length is not what the plan adds up to, the windows are not trustworthy
    // and a per-shot finding could be wrong, so the film is reported as not checked rather than wrongly failed.
    const actual = reply.file?.duration_s;
    if (typeof actual !== "number" || Math.abs(actual - list.total_s) > DURATION_SLACK_S) return unchecked;
    return { checked: true, lines: verdictLines(reply, list.shots.map((s) => s.id)) };
  } catch {
    return unchecked;
  }
}

/** Stages the finished film's bytes where the Stack can read them, verifies, cleans up. */
export async function verifyFinishedFilmBytes(bytes: Uint8Array, plan: Parameters<typeof filmShotList>[0], signal?: AbortSignal, deps?: VerifyDeps): Promise<FilmVerdict> {
  const tmp = join(dataDir, "tmp", "film-verify"); const file = join(tmp, `${newFileId()}.mp4`);
  try {
    mkdirSync(tmp, { recursive: true, mode: 0o700 });
    writeFileSync(file, bytes, { mode: 0o600 });
    const staged = await stageClipForStack(file);
    if (!staged) return { checked: false, lines: [] };
    try { return await verifyFinishedFilm({ path: staged.path, plan, signal }, deps); } finally { staged.cleanup(); }
  } catch { return { checked: false, lines: [] }; } finally { rmSync(file, { force: true }); }
}
