// SEARCH-HEALTH-01 (docs/plans/search-resilience-2026-09-24.md,
// docs/dev.md): the household's own SearXNG went rate-limited for hours
// on 2026-09-24 and nothing noticed - an empty result was a plain
// "succeeded" outcome, so the household was never told search was down.
// This is the one shared place that turns a search outcome into the
// Repairs issue a household sees, called from BOTH `packageHost.ts`'s
// `searxngSearch()` (real, live traffic - "the one choke point ...
// records that on each call") and `searxngHealth.ts`'s own periodic
// canary, so the two detection paths land on the identical two issue
// rows rather than two separate, driftable copies of the same raise/
// resolve logic. A leaf module on purpose (imports nothing from either
// caller): `searxngHealth.ts` already imports FROM `packageHost.ts`, so
// putting this here, rather than in either of them, is what keeps that
// a one-directional dependency instead of a cycle.
import { raiseIssue, resolveIssue } from "@/lib/issues";

const ISSUE_SOURCE = "websearch";

/** The design note's own trichotomy: "ok, degraded (some engines
 * suspended), or down (no engine answering, or the instance
 * unreachable)". Never a fourth "empty but healthy" state - a real,
 * ordinary "nothing found" for an arbitrary household query is not a
 * health problem and must never raise anything; only a caller that has
 * already decided a result is suspicious (the canary's own "Earth"
 * query should always return something) or actually failed reports one
 * of the two problem kinds. */
export type SearchHealthOutcome = { kind: "ok" } | { kind: "degraded"; detail: string } | { kind: "down"; detail: string };

/** Upserts the Repairs row(s) for this outcome and clears whichever one
 * no longer applies - `raiseIssue()`'s own (source, key) upsert already
 * makes this idempotent and repeat-safe (issues.ts's own doc comment:
 * "a still-broken thing raised again just refreshes this row"), and
 * its own `error`-only notification gate (plus `resolveIssue()`'s
 * matching one, below) is what actually delivers "admin notifications
 * on down and on recovery" - nothing bespoke added here. */
export async function recordSearchHealth(outcome: SearchHealthOutcome): Promise<void> {
  if (outcome.kind === "ok") {
    resolveIssue(ISSUE_SOURCE, "searxng_unreachable");
    resolveIssue(ISSUE_SOURCE, "searxng_empty");
    return;
  }
  if (outcome.kind === "degraded") {
    resolveIssue(ISSUE_SOURCE, "searxng_unreachable");
    await raiseIssue({
      source: ISSUE_SOURCE,
      key: "searxng_empty",
      severity: "warning",
      title: "Web search isn't finding anything",
      detail: outcome.detail,
    });
    return;
  }
  resolveIssue(ISSUE_SOURCE, "searxng_empty");
  await raiseIssue({
    source: ISSUE_SOURCE,
    key: "searxng_unreachable",
    severity: "error",
    title: "Web search can't reach your SearXNG instance",
    detail: outcome.detail,
  });
}
