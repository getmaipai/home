// The Health/Repairs surface's backing store (platform plan 4.11-4.12,
// docs/plans/session-f-platform-and-trust.md step 1). Mirrors
// spec/schemas/issue.schema.json: one row per (source, key), never
// duplicated - raiseIssue() upserts, reopening a resolved row rather than
// inserting a second one, so a household never sees the same real-world
// problem listed twice just because its owner re-checked it. resolveIssue()
// is the contract's own clearing half.
//
// The wave-2 contract (docs/plans/wave-2.md, "F to C and D: issues and
// sidecars") ships this alone, merged to main first, so C's engine faults
// and D's smoke failures can call raiseIssue()/resolveIssue() the moment
// they land.
import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "@/db";
import { issues } from "@/db/schema";
import { newIssueId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { trigger } from "@/lib/notifications";
import { Issue } from "@maipai/spec/gen/ts/issue.js";

export type IssueSeverity = Issue["severity"];
export type IssueFix = NonNullable<Issue["fix"]>;

type IssueRow = typeof issues.$inferSelect;

// Every response that hands an issue back over the API goes through here
// (the same "convert AND validate through the generated Zod schema"
// discipline lib/personShape.ts's toPerson() established) - a code
// review (2026-09-06) found the first version of routes/repairs.ts
// returning this module's camelCase DB-row shape directly, which drifted
// from the snake_case wire shape every spec-backed route otherwise uses
// and that spec/gen/ts/issue.ts's own Issue.parse() would reject.
function toIssue(row: IssueRow): Issue {
  return Issue.parse({
    id: row.id,
    source: row.source,
    key: row.key,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    fix: row.fix ? (JSON.parse(row.fix) as IssueFix) : null,
    learn_more: row.learnMore,
    created_at: row.createdAt,
    resolved_at: row.resolvedAt,
    dismissed_at: row.dismissedAt,
    hlc: row.hlc,
  });
}

export interface RaiseIssueInput {
  source: string;
  key: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  fix?: IssueFix | null;
  learnMore?: string | null;
}

function findRow(source: string, key: string): IssueRow | undefined {
  return db.select().from(issues).where(and(eq(issues.source, source), eq(issues.key, key))).get();
}

/** Upserts by (source, key): a still-broken thing raised again just
 * refreshes this row rather than piling up a duplicate. `created_at` is
 * preserved across a refresh - a still-open issue keeps its original
 * age, per the schema's own field comment.
 *
 * `dismissed_at` is preserved (not cleared) across a refresh of a row
 * that was never actually resolved - a code review (2026-09-06) found
 * the first version cleared it on every raise, so a person's dismiss of
 * a still-broken issue lasted only until the source's own next routine
 * recheck re-raised it. A dismissal only lifts when resolveIssue() marks
 * the underlying problem genuinely gone, or a person reopens it by hand;
 * see spec/schemas/issue.schema.json's dismissed_at field comment.
 *
 * Fires the `repairs.new` notification only on the transition into an
 * open, un-dismissed `error` (a brand new row, or one that had been
 * genuinely resolved before) - never on a repeated raise of an
 * already-open error, and never while a person has dismissed it: both
 * would turn a routine health check into a notification spam source. */
export async function raiseIssue(input: RaiseIssueInput): Promise<Issue> {
  const existing = findRow(input.source, input.key);
  const wasGenuinelyResolved = existing !== undefined && existing.resolvedAt !== null;
  const isNewOpenError = input.severity === "error" && (!existing || wasGenuinelyResolved);
  const hlc = nextHlc();
  const fixJson = input.fix ? JSON.stringify(input.fix) : null;
  const learnMore = input.learnMore ?? null;
  // A genuine resolution closed the book on the last occurrence, so this
  // raise starts a fresh one with no stale dismissal; anything else
  // (never raised before, or still open) keeps whatever dismissal state
  // it already had.
  const dismissedAt = !existing || wasGenuinelyResolved ? null : existing.dismissedAt;

  let row: IssueRow;
  if (!existing) {
    row = {
      id: newIssueId(),
      source: input.source,
      key: input.key,
      severity: input.severity,
      title: input.title,
      detail: input.detail,
      fix: fixJson,
      learnMore,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      dismissedAt: null,
      hlc,
    };
    db.insert(issues).values(row).run();
  } else {
    db.update(issues)
      .set({
        severity: input.severity,
        title: input.title,
        detail: input.detail,
        fix: fixJson,
        learnMore,
        resolvedAt: null,
        dismissedAt,
        hlc,
      })
      .where(eq(issues.id, existing.id))
      .run();
    row = { ...existing, severity: input.severity, title: input.title, detail: input.detail, fix: fixJson, learnMore, resolvedAt: null, dismissedAt, hlc };
  }

  if (isNewOpenError) {
    await trigger("repairs.new", { title: input.title });
  }

  return toIssue(row);
}

/** No-op if nothing is open under this (source, key) - resolving something
 * already resolved, or something never raised, is never an error: a
 * source's own recheck loop calls this unconditionally once it sees the
 * problem is gone. Clears `dismissed_at` too (schema comment: a genuine
 * resolution ends the incident, so a future raise is a fresh one, not a
 * reopening of an old dismissal). */
export function resolveIssue(source: string, key: string): void {
  const existing = findRow(source, key);
  if (!existing || existing.resolvedAt) return;
  db.update(issues)
    .set({ resolvedAt: new Date().toISOString(), dismissedAt: null, hlc: nextHlc() })
    .where(eq(issues.id, existing.id))
    .run();
}

/** Unresolved-and-undismissed by default (the Repairs list); `includeResolved`
 * for the full history, dismissed rows included. Newest first. */
export function listIssues(opts: { includeResolved?: boolean } = {}): Issue[] {
  const rows = opts.includeResolved
    ? db.select().from(issues).orderBy(desc(issues.createdAt)).all()
    : db
        .select()
        .from(issues)
        .where(and(isNull(issues.resolvedAt), isNull(issues.dismissedAt)))
        .orderBy(desc(issues.createdAt))
        .all();
  return rows.map(toIssue);
}

export type IssueOpResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404; error: string };

function getRow(id: string): IssueRow | undefined {
  return db.select().from(issues).where(eq(issues.id, id)).get();
}

// A source registers the handler behind its own `fix.action` id (the
// schema's own comment: "an opaque id the owning source recognises...
// never a shell command or arbitrary code"). Module-level, like
// notificationTypes.ts's registry - a source registers once at import
// time, not per-request.
const fixHandlers = new Map<string, () => Promise<void> | void>();

export function registerFixHandler(action: string, handler: () => Promise<void> | void): void {
  fixHandlers.set(action, handler);
}

/** Test-only: fixHandlers is module-local state with no other reset hook,
 * the same shape __resetRateLimiterForTests() and friends already use. */
export function __resetFixHandlersForTests(): void {
  fixHandlers.clear();
}

/** Runs the issue's own one-click remedy, then resolves it - a handler
 * that throws leaves the issue open and reports the error rather than
 * resolving a problem that didn't actually get fixed. */
export async function fixIssue(id: string): Promise<IssueOpResult<Issue>> {
  const row = getRow(id);
  if (!row) return { ok: false, status: 404, error: `no issue ${id}` };
  if (!row.fix) return { ok: false, status: 400, error: "this issue has no one-click fix" };
  const fix = JSON.parse(row.fix) as IssueFix;
  const handler = fixHandlers.get(fix.action);
  if (!handler) return { ok: false, status: 400, error: `no fix handler registered for "${fix.action}"` };
  await handler();
  resolveIssue(row.source, row.key);
  return { ok: true, value: toIssue({ ...row, resolvedAt: new Date().toISOString(), dismissedAt: null }) };
}

/** A person saying "I've seen this, stop showing it to me" without
 * running any remedy - distinct from resolveIssue(), which means the
 * underlying problem actually went away (see spec/schemas/issue.schema.json's
 * dismissed_at comment for why the two must not share one field). */
export function dismissIssue(id: string): IssueOpResult<{ id: string }> {
  const row = getRow(id);
  if (!row) return { ok: false, status: 404, error: `no issue ${id}` };
  if (!row.dismissedAt) {
    db.update(issues)
      .set({ dismissedAt: new Date().toISOString(), hlc: nextHlc() })
      .where(eq(issues.id, id))
      .run();
  }
  return { ok: true, value: { id } };
}
