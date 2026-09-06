// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/issue.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**One row on the Health/Repairs surface (platform plan 4.11-4.12, session-f-platform-and-trust.md step 1). Raised by `lib/issues.ts`'s `raiseIssue({ source, key, severity, title, detail, fix? })`, upserted by the `(source, key)` pair so a still-broken thing does not pile up duplicate rows every time its owner re-checks, and cleared by `resolveIssue(source, key)` the moment the owner sees it fixed. `source` names the subsystem that raised it (a sidecar id, a package id, `backup`, `engine`, ...); `key` is that source's own stable name for the specific problem (so one source can hold several open issues at once, each with its own key). Carries `hlc` from the first record this platform stamps with one (docs/plans/wave-2.md: 'F lays the pieces the link needs that are also useful now... HLC on every table') even though Issues are hub-local and never sync - the field costs nothing here and proves the shape out before a synced record needs it for real.*/
export const Issue = z
  .object({
    id: z.string().regex(new RegExp("^issue-[a-z0-9]{6,}$")),
    /**The subsystem that raised this: a sidecar id, a package id, or a core name like `backup` or `engine`. Paired with `key` as the upsert identity.*/
    source: z
      .string()
      .min(1)
      .describe(
        "The subsystem that raised this: a sidecar id, a package id, or a core name like `backup` or `engine`. Paired with `key` as the upsert identity.",
      ),
    /**The source's own stable name for this specific problem, so `raiseIssue` called again with the same `(source, key)` updates the existing row instead of creating a second one.*/
    key: z
      .string()
      .min(1)
      .describe(
        "The source's own stable name for this specific problem, so `raiseIssue` called again with the same `(source, key)` updates the existing row instead of creating a second one.",
      ),
    /**`error` is the only severity that fires the `repairs.new` notification (time_sensitive, to adults) - `info` and `warning` sit on the Repairs list for a person to notice on their own.*/
    severity: z
      .enum(["info", "warning", "error"])
      .describe(
        "`error` is the only severity that fires the `repairs.new` notification (time_sensitive, to adults) - `info` and `warning` sit on the Repairs list for a person to notice on their own.",
      ),
    /**One line, dad-test plain language - shown on the Repairs list.*/
    title: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "One line, dad-test plain language - shown on the Repairs list.",
      ),
    /**Longer explanation shown when the row is expanded.*/
    detail: z
      .string()
      .min(1)
      .describe("Longer explanation shown when the row is expanded."),
    /**A one-click remedy, when one exists. Null means the row is informational only - a person reads it and decides what to do.*/
    fix: z
      .union([
        z
          .object({
            /**Button text, e.g. "Restart the search sidecar".*/
            label: z
              .string()
              .min(1)
              .describe('Button text, e.g. "Restart the search sidecar".'),
            /**An opaque id the owning source recognises when `POST /api/repairs/:id/fix` calls back into it - never a shell command or arbitrary code, just a name the source's own fix table looks up.*/
            action: z
              .string()
              .min(1)
              .describe(
                "An opaque id the owning source recognises when `POST /api/repairs/:id/fix` calls back into it - never a shell command or arbitrary code, just a name the source's own fix table looks up.",
              ),
          })
          .strict()
          .describe(
            "A one-click remedy, when one exists. Null means the row is informational only - a person reads it and decides what to do.",
          ),
        z
          .null()
          .describe(
            "A one-click remedy, when one exists. Null means the row is informational only - a person reads it and decides what to do.",
          ),
      ])
      .describe(
        "A one-click remedy, when one exists. Null means the row is informational only - a person reads it and decides what to do.",
      )
      .default(null),
    /**A path into docs/user/ or docs/dev/, not an external URL - the same 'nothing leaves the house' posture as every other outbound-looking link in the product.*/
    learn_more: z
      .union([
        z
          .string()
          .describe(
            "A path into docs/user/ or docs/dev/, not an external URL - the same 'nothing leaves the house' posture as every other outbound-looking link in the product.",
          ),
        z
          .null()
          .describe(
            "A path into docs/user/ or docs/dev/, not an external URL - the same 'nothing leaves the house' posture as every other outbound-looking link in the product.",
          ),
      ])
      .describe(
        "A path into docs/user/ or docs/dev/, not an external URL - the same 'nothing leaves the house' posture as every other outbound-looking link in the product.",
      )
      .default(null),
    /**When this (source, key) was first raised. Preserved across an upsert that only refreshes detail/severity - a still-open issue keeps its original age.*/
    created_at: z
      .string()
      .datetime({ offset: true })
      .describe(
        "When this (source, key) was first raised. Preserved across an upsert that only refreshes detail/severity - a still-open issue keeps its original age.",
      ),
    /**Set only by resolveIssue() - the owning source itself detected the underlying problem is gone. Clears dismissed_at too: a genuinely-resolved incident is over, so if the same (source, key) is raised again later it is treated as a fresh occurrence, not a reopening of something the household already dismissed. A resolved row stays in the table (the history a household might want later) rather than being deleted; GET /api/repairs only lists rows with neither resolved_at nor dismissed_at set, by default.*/
    resolved_at: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "Set only by resolveIssue() - the owning source itself detected the underlying problem is gone. Clears dismissed_at too: a genuinely-resolved incident is over, so if the same (source, key) is raised again later it is treated as a fresh occurrence, not a reopening of something the household already dismissed. A resolved row stays in the table (the history a household might want later) rather than being deleted; GET /api/repairs only lists rows with neither resolved_at nor dismissed_at set, by default.",
          ),
        z
          .null()
          .describe(
            "Set only by resolveIssue() - the owning source itself detected the underlying problem is gone. Clears dismissed_at too: a genuinely-resolved incident is over, so if the same (source, key) is raised again later it is treated as a fresh occurrence, not a reopening of something the household already dismissed. A resolved row stays in the table (the history a household might want later) rather than being deleted; GET /api/repairs only lists rows with neither resolved_at nor dismissed_at set, by default.",
          ),
      ])
      .describe(
        "Set only by resolveIssue() - the owning source itself detected the underlying problem is gone. Clears dismissed_at too: a genuinely-resolved incident is over, so if the same (source, key) is raised again later it is treated as a fresh occurrence, not a reopening of something the household already dismissed. A resolved row stays in the table (the history a household might want later) rather than being deleted; GET /api/repairs only lists rows with neither resolved_at nor dismissed_at set, by default.",
      )
      .default(null),
    /**Set by a person saying 'stop showing me this' (POST /api/repairs/:id/fix or /dismiss), distinct from resolved_at: a code review (2026-09-06) found an earlier version reused resolved_at for dismissal, which meant the very next raiseIssue() from the same still-broken source's routine recheck reopened it and re-sent the repairs.new notification, defeating the dismiss a person just performed. raiseIssue() preserves this field across an upsert of an otherwise-still-open issue (sticky until the source calls resolveIssue() for real), so a dismissed-but-not-yet-fixed issue stays quiet through repeat checks and only resurfaces once it is either genuinely resolved and recurs, or a person reopens it by hand.*/
    dismissed_at: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "Set by a person saying 'stop showing me this' (POST /api/repairs/:id/fix or /dismiss), distinct from resolved_at: a code review (2026-09-06) found an earlier version reused resolved_at for dismissal, which meant the very next raiseIssue() from the same still-broken source's routine recheck reopened it and re-sent the repairs.new notification, defeating the dismiss a person just performed. raiseIssue() preserves this field across an upsert of an otherwise-still-open issue (sticky until the source calls resolveIssue() for real), so a dismissed-but-not-yet-fixed issue stays quiet through repeat checks and only resurfaces once it is either genuinely resolved and recurs, or a person reopens it by hand.",
          ),
        z
          .null()
          .describe(
            "Set by a person saying 'stop showing me this' (POST /api/repairs/:id/fix or /dismiss), distinct from resolved_at: a code review (2026-09-06) found an earlier version reused resolved_at for dismissal, which meant the very next raiseIssue() from the same still-broken source's routine recheck reopened it and re-sent the repairs.new notification, defeating the dismiss a person just performed. raiseIssue() preserves this field across an upsert of an otherwise-still-open issue (sticky until the source calls resolveIssue() for real), so a dismissed-but-not-yet-fixed issue stays quiet through repeat checks and only resurfaces once it is either genuinely resolved and recurs, or a person reopens it by hand.",
          ),
      ])
      .describe(
        "Set by a person saying 'stop showing me this' (POST /api/repairs/:id/fix or /dismiss), distinct from resolved_at: a code review (2026-09-06) found an earlier version reused resolved_at for dismissal, which meant the very next raiseIssue() from the same still-broken source's routine recheck reopened it and re-sent the repairs.new notification, defeating the dismiss a person just performed. raiseIssue() preserves this field across an upsert of an otherwise-still-open issue (sticky until the source calls resolveIssue() for real), so a dismissed-but-not-yet-fixed issue stays quiet through repeat checks and only resurfaces once it is either genuinely resolved and recurs, or a person reopens it by hand.",
      )
      .default(null),
    /**Hybrid logical clock: wall_ms:counter:node (7.3), the same shape setting-value.schema.json's hlc uses.*/
    hlc: z
      .string()
      .regex(new RegExp("^[0-9]+:[0-9]+:[a-z0-9]{6,}$"))
      .describe(
        "Hybrid logical clock: wall_ms:counter:node (7.3), the same shape setting-value.schema.json's hlc uses.",
      ),
  })
  .strict()
  .describe(
    "One row on the Health/Repairs surface (platform plan 4.11-4.12, session-f-platform-and-trust.md step 1). Raised by `lib/issues.ts`'s `raiseIssue({ source, key, severity, title, detail, fix? })`, upserted by the `(source, key)` pair so a still-broken thing does not pile up duplicate rows every time its owner re-checks, and cleared by `resolveIssue(source, key)` the moment the owner sees it fixed. `source` names the subsystem that raised it (a sidecar id, a package id, `backup`, `engine`, ...); `key` is that source's own stable name for the specific problem (so one source can hold several open issues at once, each with its own key). Carries `hlc` from the first record this platform stamps with one (docs/plans/wave-2.md: 'F lays the pieces the link needs that are also useful now... HLC on every table') even though Issues are hub-local and never sync - the field costs nothing here and proves the shape out before a synced record needs it for real.",
  );
export type Issue = z.infer<typeof Issue>;
