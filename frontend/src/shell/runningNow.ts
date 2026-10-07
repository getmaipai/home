// ACTIVITY-01d: map /api/jobs into the safe activity rows rendered by the
// chat's shipped TaskCard and BackgroundInbox Elements. Copy follows
// UI-STUDY.md 8.4: children get friendly words, nobody reads engine names,
// and raw detail is an admin's only.
import type { HomeJobView } from "@/lib/api";

export type RunningNowBand = "child" | "teen" | "adult";

export interface RunningNowViewer {
  id: string;
  band: RunningNowBand;
  admin: boolean;
}

export type RunningNowActionKey = "stop" | "approve" | "deny" | "open";

export interface RunningNowRow {
  id: string;
  title: string;
  status: string;
  tone: "running" | "waiting" | "done" | "failed";
  detail?: string;
  progress?: number;
  actions: RunningNowActionKey[];
  details?: string;
  href?: string;
  /** The chat this row belongs to, when it has one. */
  conversationId?: string;
  /** Epoch ms the row finished (done rows only). */
  finishedAt?: number;
  /** Whether this row is the viewer's own (only those are announced). */
  own: boolean;
  /** A completed row may have ended unsuccessfully. */
  failed?: boolean;
}

export interface RunningNowView {
  running: RunningNowRow[];
  waiting: RunningNowRow[];
  done: RunningNowRow[];
  count: number;
  /** Finished in the last 15 minutes: keeps the header button in view a
   * while after work ends, so the person can see how it went. */
  recentDone: number;
}

const DAY_MS = 86_400_000;
const DONE_LIMIT = 5;
const RECENT_MS = 15 * 60_000;

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function progressOf(progress: Record<string, unknown> | null | undefined): number | undefined {
  if (!progress) return undefined;
  const fraction = num(progress.fraction);
  if (fraction !== undefined) return Math.max(0, Math.min(1, fraction));
  const percent = num(progress.percent);
  if (percent !== undefined) return Math.max(0, Math.min(1, percent / 100));
  const done = num(progress.completedBytes);
  const total = num(progress.totalBytes);
  if (done !== undefined && total !== undefined && total > 0) return Math.max(0, Math.min(1, done / total));
  return undefined;
}

function etaWords(seconds: number): string {
  if (seconds < 60) return "Less than a minute left";
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "About a minute left" : `About ${minutes} minutes left`;
}

function elapsedWords(seconds: number): string {
  if (seconds < 10) return "Just started";
  const plural = (n: number, unit: string) => `Started ${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (seconds < 60) return plural(Math.round(seconds), "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return plural(minutes, "minute");
  return plural(Math.round(minutes / 60), "hour");
}

function detailFor(job: HomeJobView, viewer: RunningNowViewer, now: number): string | undefined {
  const progress = job.progress ?? {};
  const stepIndex = num(progress.step_index);
  const stepCount = num(progress.step_count);
  if (stepIndex !== undefined && stepCount !== undefined && stepCount > 0) return `Step ${Math.min(stepCount, stepIndex + 1)} of ${stepCount}`;
  if (viewer.band === "child") return undefined;
  const eta = num(progress.eta_seconds) ?? num(progress.etaSeconds);
  if (eta !== undefined) return eta > 0 ? etaWords(eta) : undefined;
  if (job.state === "running" && job.createdAt) return elapsedWords((now - Date.parse(job.createdAt)) / 1000);
  return undefined;
}

function stoppedByGrownUp(job: HomeJobView): boolean {
  const actions = job.provenance?.actions;
  return Array.isArray(actions) && actions.some((entry) => typeof entry === "object" && entry !== null && (entry as { action?: unknown; admin?: unknown }).action === "stop" && (entry as { admin?: unknown }).admin === true);
}

function titleFor(job: HomeJobView, viewer: RunningNowViewer): string {
  const title = job.title?.trim() || "";
  if (job.kind === "model_download") return "Downloading a model";
  if (job.kind === "approval" && job.forPerson === viewer.id && viewer.band === "child") return "Asked a parent";
  if (job.kind === "routine" && title && !/routine/i.test(title)) return `The ${title} routine`;
  return title;
}

const STATUS: Record<string, { adult: string; child: string; tone: RunningNowRow["tone"] }> = {
  queued: { adult: "Waiting to start", child: "Waiting", tone: "running" },
  running: { adult: "Working", child: "Working on it", tone: "running" },
  paused: { adult: "Paused", child: "Paused", tone: "running" },
  waiting_for_you: { adult: "Needs you", child: "Waiting", tone: "waiting" },
  done: { adult: "Done", child: "Done", tone: "done" },
  failed: { adult: "Didn't finish", child: "Didn't work", tone: "failed" },
  cancelled: { adult: "Stopped", child: "Stopped", tone: "done" },
};

function rowFor(job: HomeJobView, viewer: RunningNowViewer, now: number): RunningNowRow | null {
  const state = job.state;
  // A row about another adult carries only its kind and duration (the
  // service's privacy projection); there is nothing plain to show.
  if (!state || !STATUS[state] || !job.title) return null;
  // The hub's own housekeeping (a memory sweep, an embedding retry) is
  // nobody's work and its titles are engine names; only a model download
  // is system-started work a person wants to see.
  if (job.startedBy === "system" && !job.forPerson && job.kind !== "model_download") return null;
  const status = STATUS[state]!;
  const own = job.forPerson === viewer.id;
  const actions: RunningNowActionKey[] = [];
  for (const action of job.actions ?? []) {
    if (action === "stop" || action === "approve" || action === "deny") actions.push(action);
  }
  let detail = state === "done" || state === "cancelled" || state === "failed" ? undefined : detailFor(job, viewer, now);
  if (state === "cancelled" && viewer.band === "child" && stoppedByGrownUp(job)) detail = "A grown-up stopped this.";
  if (state === "failed") detail = viewer.band === "child" ? "That didn't work this time." : "It stopped before it finished.";
  if (job.kind === "approval" && job.forPerson === viewer.id && viewer.band !== "child") detail = "Waiting for an answer";
  // Whose work it is, when it is not the viewer's (an admin sees a child's).
  if (!own && job.forPersonName && job.kind !== "approval") detail = detail ? `For ${job.forPersonName}. ${detail}` : `For ${job.forPersonName}`;
  if (job.kind === "chat_ask") detail = "Waiting for your answer in this chat";
  let href: string | undefined;
  if ((state === "done" || job.actions?.includes("open")) && job.conversationId) {
    href = `/chat?conversation=${encodeURIComponent(job.conversationId)}`;
    actions.push("open");
  }
  let details: string | undefined;
  if (viewer.admin) {
    const parts = [job.kind === "model_download" && job.title ? `Model: ${job.title}` : "", job.errorKind ? `Reason: ${job.errorKind}` : "", job.raw ?? ""].filter(Boolean);
    if (parts.length > 0) details = parts.join("\n");
  }
  return {
    id: job.id,
    title: titleFor(job, viewer),
    // A child's own ask already reads "Asked a parent" under "Waiting";
    // a third "Waiting" says nothing new.
    status: job.kind === "approval" && own && viewer.band === "child" ? "" : viewer.band === "child" ? status.child : status.adult,
    tone: status.tone,
    ...(detail ? { detail } : {}),
    ...(state === "running" || state === "paused" ? (() => { const p = progressOf(job.progress); return p === undefined ? {} : { progress: p }; })() : {}),
    actions,
    ...(details ? { details } : {}),
    ...(href ? { href } : {}),
    ...(job.conversationId ? { conversationId: job.conversationId } : {}),
    own,
    ...(state === "failed" ? { failed: true } : {}),
  };
}

export function runningNowView({ jobs, viewer, now }: {
  jobs: readonly HomeJobView[];
  viewer: RunningNowViewer;
  now: number;
}): RunningNowView {
  const running: RunningNowRow[] = [];
  const waiting: RunningNowRow[] = [];
  const done: Array<RunningNowRow & { at: number }> = [];
  for (const job of jobs) {
    const row = rowFor(job, viewer, now);
    if (!row) continue;
    if (row.tone === "waiting") waiting.push(row);
    else if (job.state === "done" || job.state === "failed" || job.state === "cancelled") {
      const at = Date.parse(job.updatedAt ?? job.createdAt ?? "");
      if (Number.isFinite(at) && now - at <= DAY_MS) done.push({ ...row, at });
    } else running.push(row);
  }
  done.sort((a, b) => b.at - a.at);
  return {
    running,
    waiting,
    done: done.slice(0, DONE_LIMIT).map(({ at, ...row }) => ({ ...row, finishedAt: at })),
    count: running.length + waiting.length,
    recentDone: done.filter((row) => now - row.at <= RECENT_MS).length,
  };
}

/** The one sentence a polite live region reads when the viewer's own
 * work changes. Never names another person's job (ACTIVITY-01d C4). */
export function runningNowAnnouncement(previous: RunningNowView | null, next: RunningNowView): string | undefined {
  if (!previous) return undefined;
  const before = new Map([...previous.running, ...previous.waiting].map((row) => [row.id, row]));
  for (const row of next.done) {
    if (!row.own || !before.has(row.id)) continue;
    return `${row.title}: ${row.status}.`;
  }
  const started = next.running.find((row) => row.own && !before.has(row.id));
  return started ? `${started.title}: ${started.status}.` : undefined;
}
