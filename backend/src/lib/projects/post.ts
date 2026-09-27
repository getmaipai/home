// PROJECT-START-01: a finished project's own two surfaces (design record,
// "What the person sees" - "completion posts the artifact into the
// thread and sends a notification per NOTIFICATIONS.md"). Reuses
// lib/artifacts.ts's createArtifact() exactly as write_document's own
// `op: "artifact"` does - artifactsByTurn() looks an artifact up by
// turnId at READ time, whenever that is, so attaching a project's result
// to the turn that started it (project.provenance.turnId) makes it
// appear in the thread with no new conversation_turns row, no new
// `source` value, and no synthetic message.
//
// The one real gap this closes: turnMachine/turnNext.ts (unlike the
// legacy turnEngine.ts's prepareTurn()) writes conversationTurns' own row
// only at the very end (logResult(), turnNext.ts), never a provisional
// one up front - so a project that finishes fast enough (every scripted
// test; a real one-step project on a fast engine) can reach its terminal
// state before that row exists, and createArtifact()'s own FK to
// conversationTurns would fail. postProjectResult() is idempotent and
// called from two places (runner.ts's own terminal hook, the moment it
// happens; turnNext.ts's logResult(), once the row is guaranteed to
// exist) so whichever runs second finishes the job - never both: the
// first call to actually see the row write the artifact wins,
// `alreadyPosted()` is what the second one reads to become a no-op.
import { readFileSync } from "node:fs";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { artifacts, conversationTurns } from "@/db/schema";
import { createArtifact } from "@/lib/artifacts";
import { trigger } from "@/lib/notifications";
import { loadProject } from "./store";
import { planSteps } from "./types";
import type { Project } from "./types";

function turnRowExists(turnId: string): boolean {
  return db.select({ id: conversationTurns.id }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get() !== undefined;
}

const PROJECT_ARTIFACT_PROVENANCE_PREFIX = "project:";

function alreadyPosted(turnId: string, projectId: string): boolean {
  return (
    db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(and(eq(artifacts.turnId, turnId), eq(artifacts.provenance, `${PROJECT_ARTIFACT_PROVENANCE_PREFIX}${projectId}`)))
      .get() !== undefined
  );
}

/** PROJECT-PROGRESS-01: routes/projects.ts's own GET response gains this
 * as a sibling field (`posted_artifact`) so the live progress card can
 * show the finished document without waiting for a reload - the exact
 * `project:<id>` provenance tag this file's own createArtifact() call
 * below writes, looked up the same way alreadyPosted() above already
 * does, just returning the row instead of a boolean. Null before the
 * project posts (still running, or terminal with nothing to show -
 * `cancelled` never posts one at all, this file's own header above). */
export function postedProjectArtifact(projectId: string): { id: string; version: number } | null {
  // alreadyPosted() guards against a second post today, so exactly one
  // row is the normal case - `orderBy` is here anyway (a code review's
  // own finding) so a future path that legitimately posts more than one
  // under this same tag can never return a stale one: `createdAt` is a
  // real timestamp, not insertion order left to SQLite's own discretion.
  const row = db
    .select({ id: artifacts.id, version: artifacts.version })
    .from(artifacts)
    .where(eq(artifacts.provenance, `${PROJECT_ARTIFACT_PROVENANCE_PREFIX}${projectId}`))
    .orderBy(desc(artifacts.createdAt))
    .get();
  return row ?? null;
}

/** The plan's own sink step (the one step nothing else `needs`) is the
 * deliverable - for the linear text/assemble plans this item builds,
 * that's the final assemble step; a branching plan (none exist yet)
 * could have more than one, so every sink is tried before the fallback.
 * Falls back to the project's own last-created artifact overall (an
 * "adhoc" plan this registry has no ProjectType for, or a sink step that
 * itself produced no artifact) rather than posting nothing. */
function deliverableText(project: Project): string | null {
  const steps = planSteps(project.plan);
  const neededIds = new Set(steps.flatMap((s) => s.needs));
  const sinkStepIds = steps.filter((s) => !neededIds.has(s.id)).map((s) => s.id);
  const candidates = sinkStepIds.map((id) => project.steps.find((s) => s.stepId === id)).filter((s): s is Project["steps"][number] => s !== undefined);
  for (const state of candidates) {
    const artifactId = state.artifactIds.at(-1);
    const artifact = artifactId ? project.artifacts.find((a) => a.id === artifactId) : undefined;
    if (artifact?.kind !== "document") continue;
    try {
      return readFileSync(artifact.path, "utf8");
    } catch {
      continue;
    }
  }
  // PROJECT-MEDIA-01: an image/video/audio/file artifact can't become a
  // chat Artifact today (lib/artifacts.ts's kind is markdown/code/html
  // only) - out of scope here, named rather than silently skipped; no
  // real plan can produce one yet anyway (steps.ts's refusalFor() refuses
  // any media/tool step before the plan ever runs).
  const last = project.artifacts.at(-1);
  if (last?.kind === "document") {
    try {
      return readFileSync(last.path, "utf8");
    } catch {
      /* fall through to null below */
    }
  }
  return null;
}

function deliverableBody(project: Project): string {
  return deliverableText(project) ?? `${project.title} finished, but no output was found.`;
}

function failureBody(project: Project): string {
  const lines = project.steps.map((s) => `- ${s.stepId}: ${s.state}${s.error ? ` (${s.error})` : ""}`);
  return `**${project.title}** didn't finish: ${project.error ?? "something went wrong"}.\n\n${lines.join("\n")}`;
}

// The same "fire-and-forget, but never an unhandled rejection" shape
// every other notify-in-the-background call site already uses
// (modelDownloadJobs.ts's own model.download_ready/failed, issues.ts's
// repairs.resolved) - a review's own finding caught the first cut
// missing the .catch() entirely, which would have silently dropped a
// transient trigger() failure with no log trail at all.
function fireAndLog(typeId: string, vars: Record<string, string>, opts: Parameters<typeof trigger>[2]): void {
  trigger(typeId, vars, opts).catch((err: unknown) => console.error(`[projects] ${typeId} notification failed: ${(err as Error).message}`));
}

function notifyResult(project: Project, personId: string, turnId: string | undefined): void {
  if (project.state === "done") {
    fireAndLog("project.done", { title: project.title }, { personId, subjectTurnId: turnId });
  } else if (project.state === "failed") {
    fireAndLog("project.failed", { title: project.title, reason: project.error ?? "something went wrong" }, { personId, subjectTurnId: turnId });
  }
}

/** Safe to call any number of times, from either caller, at any point in
 * a project's life - a no-op until the project is actually terminal, a
 * no-op again once it's already been posted. `cancelled` gets neither an
 * artifact nor a notification: the person who cancelled it already
 * knows, the same reasoning `scheduler.ts`'s own cancelJob() posture
 * carries (cancelling is never itself an event worth announcing). */
export function postProjectResult(projectId: string): void {
  const project = loadProject(projectId);
  if (!project) return;
  if (project.state !== "done" && project.state !== "failed") return;
  const { person, conversationId, turnId } = project.provenance;

  if (!conversationId || !turnId) {
    // No thread to post to (an incognito thread, or a temporary
    // conversation - the design record's own retention rule: "its
    // provenance then records the person and no thread"). The
    // notification is the only surface, and runner.ts's own terminal
    // hook is the ONLY caller that ever reaches this branch (tool.ts
    // never gives a temporary/incognito project a real turnId for
    // turnNext.ts's own logResult() hook to find), so there's no
    // double-notify race to guard here.
    notifyResult(project, person, undefined);
    return;
  }
  if (!turnRowExists(turnId)) return; // the FK race - turnNext.ts's own post-logResult call finishes this
  if (alreadyPosted(turnId, project.id)) return; // the other caller already finalized this project

  const body = project.state === "done" ? deliverableBody(project) : failureBody(project);
  createArtifact({
    conversationId,
    turnId,
    kind: "markdown",
    title: project.title,
    body,
    createdBy: person,
    provenance: `${PROJECT_ARTIFACT_PROVENANCE_PREFIX}${project.id}`,
  });
  notifyResult(project, person, turnId);
}
