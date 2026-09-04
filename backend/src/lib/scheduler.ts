// The durable scheduler (platform plan 4.7): "one-shot and recurring
// jobs... persisted, survives restarts. Timers, reminders, routines,
// warming, backups and updates are all jobs." Backs host.schedule for
// real (packageHost.ts) and, separately, is what finally lets
// lib/memory.ts's runMaintenance() run on a timer instead of only by a
// manual `POST /api/memory/maintenance/run` (its own comment has named
// this exact gap since it shipped).
//
// Scope, deliberately narrower than the full 4.7 description, same
// discipline as every other slice this session: no device target (3.1's
// Device record doesn't exist), no quiet-hours policy (no settings key
// declared for it), no notification-system integration (4.13 isn't
// built; a fired job just runs and logs, the way safety.ts's HTTP route
// stands in for the turn engine that doesn't exist yet). `when`'s
// "recurrence expression" (recipe.schema.json's own words) is a
// deliberately minimal `every:<n><unit>` grammar here, not RRULE; a
// one-shot `when` is a plain ISO datetime. See this file's `parseWhen`.
//
// A real, narrow gap worth knowing before extending this: the Host
// interface's `schedule(when, job)` (spec/emulators/ts/host-emulator.ts)
// takes no recipe inputs, and neither does the interpreter's own
// schedule-step handling (spec/interpreters/ts/recipe-interpreter.ts
// calls `host.schedule(when, step.job ?? recipe.id)`, nothing else). So
// a job scheduled from within a recipe re-fires its package with an
// EMPTY input scope, not the inputs the original call had. Carrying
// inputs through needs an interpreter-level change (both TS and Python,
// kept behaviorally identical) that's out of scope here; ad-hoc jobs
// scheduled directly via scheduleJob() (not through a recipe step) don't
// have this limitation, since callers pass inputs explicitly.
import { eq, and, lte, isNull } from "drizzle-orm";
import { db } from "@/db";
import { scheduledJobs, people } from "@/db/schema";
import { newJobId } from "@/lib/id";
import { isOwnerOrAdmin } from "@/lib/access";
import { runMaintenance } from "@/lib/memory";
import { runRetention } from "@/lib/conversationHistory";
import { runBackup, pruneBackups } from "@/lib/backup";
import type { SkillOpResult } from "@/lib/skills";
import type { SkillResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";
import type { PersonRow } from "@/types";

// lib/skills.ts's runSkill isn't imported directly: skills.ts already
// imports lib/packageHost.ts (createHost), and packageHost.ts imports
// this file (its host.schedule needs scheduleJob below), so importing
// skills.ts here too would close a real circular-import loop. The
// caller (index.ts, or a test) passes its own runSkill in instead.
type RunSkillFn = (id: string, actor: PersonRow, inputs: Record<string, unknown>) => SkillOpResult<SkillResult>;

export type SchedulerOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404; error: string };

export type JobKind = "skill" | "core";

const RECURRENCE = /^every:(\d+)(m|h|d)$/;
const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

interface ParsedWhen {
  nextRunAt: Date;
  recurring: boolean;
  intervalMs?: number;
}

/** A plain ISO datetime (one-shot) or `every:<n><m|h|d>` (recurring, a
 * deliberately minimal placeholder for a real recurrence grammar). Null
 * for anything else, including a one-shot time already in the past. */
export function parseWhen(when: string, from: Date = new Date()): ParsedWhen | null {
  const recurrence = RECURRENCE.exec(when);
  if (recurrence) {
    const n = Number(recurrence[1]);
    const unitMs = UNIT_MS[recurrence[2]!]!;
    if (n <= 0) return null;
    const intervalMs = n * unitMs;
    return { nextRunAt: new Date(from.getTime() + intervalMs), recurring: true, intervalMs };
  }
  const oneShot = new Date(when);
  if (Number.isNaN(oneShot.getTime())) return null;
  if (oneShot.getTime() < from.getTime()) return null;
  return { nextRunAt: oneShot, recurring: false };
}

/** Schedules a "skill" job: re-runs `packageId` for `actor` with `inputs`
 * when `when` next fires. `job` is the recipe step's own job id (or the
 * recipe id, per the interpreter's fallback), kept for display/audit,
 * not resolved to anything else here. */
export function scheduleJob(
  actor: PersonRow,
  packageId: string,
  job: string,
  when: string,
  inputs: Record<string, unknown>,
): SchedulerOpResult<{ id: string }> {
  const parsed = parseWhen(when);
  if (!parsed) return { ok: false, status: 400, error: `unrecognized or past-due "when": ${when}` };
  const id = newJobId();
  db.insert(scheduledJobs)
    .values({
      id,
      kind: "skill",
      packageId,
      job,
      personId: actor.id,
      inputs: JSON.stringify(inputs),
      when,
      recurring: parsed.recurring,
      nextRunAt: parsed.nextRunAt.toISOString(),
      status: "pending",
      createdAt: new Date().toISOString(),
    })
    .run();
  return { ok: true, value: { id } };
}

/** Idempotent: only inserts if a pending job with this `job` id doesn't
 * already exist, so calling this on every boot (index.ts) is safe. */
export function ensureCoreJob(job: string, when: string): void {
  const existing = db
    .select({ id: scheduledJobs.id })
    .from(scheduledJobs)
    .where(and(eq(scheduledJobs.kind, "core"), eq(scheduledJobs.job, job), eq(scheduledJobs.status, "pending")))
    .get();
  if (existing) return;
  const parsed = parseWhen(when);
  if (!parsed) throw new Error(`ensureCoreJob: unrecognized "when": ${when}`);
  db.insert(scheduledJobs)
    .values({
      id: newJobId(),
      kind: "core",
      packageId: "core",
      job,
      inputs: "{}",
      when,
      recurring: parsed.recurring,
      nextRunAt: parsed.nextRunAt.toISOString(),
      status: "pending",
      createdAt: new Date().toISOString(),
    })
    .run();
}

export type JobRow = typeof scheduledJobs.$inferSelect;

/** Owner/admin see every job; anyone else sees only their own. */
export function listJobs(actor: PersonRow): JobRow[] {
  if (isOwnerOrAdmin(actor)) return db.select().from(scheduledJobs).all();
  return db.select().from(scheduledJobs).where(eq(scheduledJobs.personId, actor.id)).all();
}

export function cancelJob(actor: PersonRow, id: string): SchedulerOpResult<true> {
  const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
  if (!row) return { ok: false, status: 404, error: "job not found" };
  if (row.personId !== actor.id && !isOwnerOrAdmin(actor)) {
    return { ok: false, status: 403, error: "cannot cancel another person's job" };
  }
  // Cancelling only ever means "don't run this pending job." Without
  // this check, cancelling an already-"done" job flips it to
  // "cancelled" after the fact, corrupting the one field (status) an
  // operator or future UI would read to answer "did this actually run."
  if (row.status !== "pending") {
    return { ok: false, status: 400, error: `job ${id} is already ${row.status}, not pending` };
  }
  db.update(scheduledJobs).set({ status: "cancelled" }).where(eq(scheduledJobs.id, id)).run();
  return { ok: true, value: true };
}

const CORE_JOBS: Record<string, () => void> = {
  "memory.maintenance": () => {
    runMaintenance();
  },
  "conversation.retention": () => {
    runRetention();
  },
  "backup.run": () => {
    runBackup();
    pruneBackups();
  },
};

/** Fires every pending job whose nextRunAt has passed. Synchronous and
 * idempotent per call (no concurrent invocations in this single-process
 * hub); safe to call from a test directly or from index.ts's interval.
 * A recurring job's next fire is computed from its own recurrence
 * interval, not from "now", so a late tick doesn't compress the
 * schedule. A one-shot job never retries: a failure is recorded on the
 * row and it's marked done, the same "never a silent retry loop" choice
 * lib/memory.ts's forget() makes for its own one-shot erasure. */
export function runDueJobs(runSkillFn: RunSkillFn, now: Date = new Date()): { ran: number; errors: number } {
  const due = db
    .select()
    .from(scheduledJobs)
    .where(and(eq(scheduledJobs.status, "pending"), lte(scheduledJobs.nextRunAt, now.toISOString())))
    .all();

  let ran = 0;
  let errors = 0;
  for (const row of due) {
    let error: string | null = null;
    try {
      if (row.kind === "core") {
        const handler = CORE_JOBS[row.job];
        if (!handler) throw new Error(`no core job registered for ${row.job}`);
        handler();
      } else {
        if (!row.personId) throw new Error(`skill job ${row.id} has no personId`);
        const actor = db.select().from(people).where(and(eq(people.id, row.personId), isNull(people.deletedAt))).get();
        if (!actor) throw new Error(`person ${row.personId} no longer exists`);
        const result = runSkillFn(row.packageId, actor, JSON.parse(row.inputs));
        if (!result.ok) throw new Error(result.error);
      }
      ran++;
    } catch (err) {
      errors++;
      error = err instanceof Error ? err.message : String(err);
    }

    if (row.recurring) {
      // Advance from the job's own scheduled nextRunAt, not from `now`,
      // and land on the next slot at or after `now` in one step rather
      // than one interval at a time: a late tick (the process was down,
      // or many jobs came due at once) must not push a daily job's
      // time-of-day later, and a long outage must not mean firing once
      // per missed day to catch up. `originalNextRunAt + N*intervalMs`
      // keeps the original phase exactly, however large N is.
      const parsed = parseWhen(row.when, new Date(row.nextRunAt));
      let nextRunAt = parsed?.nextRunAt ?? new Date(now.getTime() + 3_600_000);
      if (parsed?.intervalMs && nextRunAt.getTime() < now.getTime()) {
        const originalNextRunAt = new Date(row.nextRunAt).getTime();
        const steps = Math.ceil((now.getTime() - originalNextRunAt) / parsed.intervalMs);
        nextRunAt = new Date(originalNextRunAt + steps * parsed.intervalMs);
      }
      db.update(scheduledJobs)
        .set({
          lastRunAt: now.toISOString(),
          lastError: error,
          nextRunAt: nextRunAt.toISOString(),
        })
        .where(eq(scheduledJobs.id, row.id))
        .run();
    } else {
      db.update(scheduledJobs)
        .set({ status: "done", lastRunAt: now.toISOString(), lastError: error })
        .where(eq(scheduledJobs.id, row.id))
        .run();
    }
  }
  return { ran, errors };
}
