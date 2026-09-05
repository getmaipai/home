// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/grant.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**
 * What one person is allowed to reach. Chapter 3's 'Capability grant', which spec/README.md has listed as landing 'with the release that needs it'.
 *
 * WHY THIS REPLACES ROLE-AS-GATE (Jesse, 2026-09-05, and he is right): age cannot decide access. A household may want a twelve-year-old to reach something normally kept for adults, and may want an adult restricted - a grandparent with dementia, someone managing an addiction, a houseguest, or an adult who wants guardrails on themselves. And there is no defensible age at which a feature unlocks by itself: every threshold is arbitrary, varies by jurisdiction, and is wrong for somebody. A feature that unlocks on a birthday is a feature nobody decided to grant.
 *
 * So: age never grants or denies. It may seed a suggested starting set when an adult creates a profile, and that is a prefilled default they can change before saving, not a rule. Age keeps its place in safety and retention (the minor-speaker flag on a turn, the rule that a safety-flagged conversation involving a teen or child is kept at least 90 days), because those are protections, not permissions.
 *
 * WHAT THIS CANNOT DO: nothing here reaches the safety floor. The org's Safety invariants make child-safety protections on generation and chat non-removable by any setting, flag, or admin - including the household's own owner. A grant can open an app; no grant opens a path around the safety classifier. That is architecture, not policy.
 *
 * SHAPE: a subject, an action and a target - the same triple relationship-based access control uses (Google's Zanzibar and the ReBAC family model permissions as exactly this). Deliberately a SEPARATE store from relationship.schema.json despite the identical shape: those edges can be machine-inferred and wrong, and an inference bug that reached a permission resolver would be a privilege escalation. Same shape, separate stores, opposite trust. A Grant is never inferred.
 *
 * ONE THING THIS RECORD CANNOT ENFORCE, stated rather than papered over: the org's Safety invariants say unrestricted mode is unlocked 'per-user by an adult' and that child profiles are restricted by default - both age-shaped. This model deliberately removes age from authorization, so nothing here can check that a grantee is an adult; it can only check that they acknowledged for themselves and that a named person granted it. That is a genuine collision between two correct rules, and it is Jesse's call to resolve, not one to settle silently in a validator. See home/docs/BACKLOG.md.
 */
export const Grant = z
  .object({
    id: z.string().regex(new RegExp("^grant-[a-z0-9]{6,}$")),
    /**Who this is about. Grants attach to accounts, not to entities: an entity with no account has nothing to authorize.*/
    person: z
      .string()
      .regex(new RegExp("^person-[a-z0-9]{6,}$"))
      .describe(
        "Who this is about. Grants attach to accounts, not to entities: an entity with no account has nothing to authorize.",
      ),
    /**What may be done. The concrete string, matched against spec/vocab/grant-actions.json exactly the way a manifest's `permissions` are matched against permissions.json: a parameterized entry (`use:<package>`) is written out with its target (`use:videos`), a literal one (`backups.run`) stands alone. There is deliberately no separate `object` field - permissions already prove one string is enough, and two fields holding the same target is a way for them to disagree.*/
    action: z
      .string()
      .min(1)
      .describe(
        "What may be done. The concrete string, matched against spec/vocab/grant-actions.json exactly the way a manifest's `permissions` are matched against permissions.json: a parameterized entry (`use:<package>`) is written out with its target (`use:videos`), a literal one (`backups.run`) stands alone. There is deliberately no separate `object` field - permissions already prove one string is enough, and two fields holding the same target is a way for them to disagree.",
      ),
    /**An explicit deny always beats an allow, at any specificity. Two reasons: 'Billy may use everything except X' has to be sayable in two rows rather than by enumerating everything, and a restriction placed on an adult must not be silently widened by a later broad allow.*/
    effect: z
      .enum(["allow", "deny"])
      .describe(
        "An explicit deny always beats an allow, at any specificity. Two reasons: 'Billy may use everything except X' has to be sayable in two rows rather than by enumerating everything, and a restriction placed on an adult must not be silently widened by a later broad allow.",
      ),
    /**When this starts applying. Null means immediately.*/
    valid_from: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe("When this starts applying. Null means immediately."),
        z.null().describe("When this starts applying. Null means immediately."),
      ])
      .describe("When this starts applying. Null means immediately.")
      .default(null),
    /**When it stops. Null means it does not expire. A temporary grant ('screens until Sunday') is the common case a household actually wants, and it costs nothing here.*/
    valid_to: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "When it stops. Null means it does not expire. A temporary grant ('screens until Sunday') is the common case a household actually wants, and it costs nothing here.",
          ),
        z
          .null()
          .describe(
            "When it stops. Null means it does not expire. A temporary grant ('screens until Sunday') is the common case a household actually wants, and it costs nothing here.",
          ),
      ])
      .describe(
        "When it stops. Null means it does not expire. A temporary grant ('screens until Sunday') is the common case a household actually wants, and it costs nothing here.",
      )
      .default(null),
    /**Who decided this. A grant with no author is not reviewable, and every grant is somebody's decision - that is the entire difference between this and an age threshold.*/
    granted_by_person_id: z
      .string()
      .regex(new RegExp("^person-[a-z0-9]{6,}$"))
      .describe(
        "Who decided this. A grant with no author is not reviewable, and every grant is somebody's decision - that is the entire difference between this and an age threshold.",
      ),
    /**Optional, in the granting adult's own words. Six months later, 'why can Billy use this?' is a real question.*/
    reason: z
      .union([
        z
          .string()
          .max(500)
          .describe(
            "Optional, in the granting adult's own words. Six months later, 'why can Billy use this?' is a real question.",
          ),
        z
          .null()
          .describe(
            "Optional, in the granting adult's own words. Six months later, 'why can Billy use this?' is a real question.",
          ),
      ])
      .describe(
        "Optional, in the granting adult's own words. Six months later, 'why can Billy use this?' is a real question.",
      )
      .default(null),
    /**When the one-time adult acknowledgment happened, for the actions that require it (unrestricted generation and chat). The standard is explicit that this is one clear dialog, per adult, never repeated - so it is a timestamp on the grant, not a prompt that reappears.*/
    acknowledged_at: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "When the one-time adult acknowledgment happened, for the actions that require it (unrestricted generation and chat). The standard is explicit that this is one clear dialog, per adult, never repeated - so it is a timestamp on the grant, not a prompt that reappears.",
          ),
        z
          .null()
          .describe(
            "When the one-time adult acknowledgment happened, for the actions that require it (unrestricted generation and chat). The standard is explicit that this is one clear dialog, per adult, never repeated - so it is a timestamp on the grant, not a prompt that reappears.",
          ),
      ])
      .describe(
        "When the one-time adult acknowledgment happened, for the actions that require it (unrestricted generation and chat). The standard is explicit that this is one clear dialog, per adult, never repeated - so it is a timestamp on the grant, not a prompt that reappears.",
      )
      .default(null),
    /**WHO acknowledged, which must be the person the grant is about: unrestricted mode is something an adult accepts for themselves, not something another adult accepts on their behalf. A code review (2026-09-05) found `acknowledged_at` alone proved only that SOME timestamp existed, with nothing recording who agreed to what. Enforced in validate.ts.*/
    acknowledged_by_person_id: z
      .union([
        z
          .string()
          .regex(new RegExp("^person-[a-z0-9]{6,}$"))
          .describe(
            "WHO acknowledged, which must be the person the grant is about: unrestricted mode is something an adult accepts for themselves, not something another adult accepts on their behalf. A code review (2026-09-05) found `acknowledged_at` alone proved only that SOME timestamp existed, with nothing recording who agreed to what. Enforced in validate.ts.",
          ),
        z
          .null()
          .describe(
            "WHO acknowledged, which must be the person the grant is about: unrestricted mode is something an adult accepts for themselves, not something another adult accepts on their behalf. A code review (2026-09-05) found `acknowledged_at` alone proved only that SOME timestamp existed, with nothing recording who agreed to what. Enforced in validate.ts.",
          ),
      ])
      .describe(
        "WHO acknowledged, which must be the person the grant is about: unrestricted mode is something an adult accepts for themselves, not something another adult accepts on their behalf. A code review (2026-09-05) found `acknowledged_at` alone proved only that SOME timestamp existed, with nothing recording who agreed to what. Enforced in validate.ts.",
      )
      .default(null),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    /**A revoked grant is tombstoned, not deleted: 'who removed this, and when' is exactly the question a household asks after something stops working.*/
    deleted_at: z
      .union([
        z
          .string()
          .datetime({ offset: true })
          .describe(
            "A revoked grant is tombstoned, not deleted: 'who removed this, and when' is exactly the question a household asks after something stops working.",
          ),
        z
          .null()
          .describe(
            "A revoked grant is tombstoned, not deleted: 'who removed this, and when' is exactly the question a household asks after something stops working.",
          ),
      ])
      .describe(
        "A revoked grant is tombstoned, not deleted: 'who removed this, and when' is exactly the question a household asks after something stops working.",
      )
      .default(null),
  })
  .strict()
  .describe(
    "What one person is allowed to reach. Chapter 3's 'Capability grant', which spec/README.md has listed as landing 'with the release that needs it'.\n\nWHY THIS REPLACES ROLE-AS-GATE (Jesse, 2026-09-05, and he is right): age cannot decide access. A household may want a twelve-year-old to reach something normally kept for adults, and may want an adult restricted - a grandparent with dementia, someone managing an addiction, a houseguest, or an adult who wants guardrails on themselves. And there is no defensible age at which a feature unlocks by itself: every threshold is arbitrary, varies by jurisdiction, and is wrong for somebody. A feature that unlocks on a birthday is a feature nobody decided to grant.\n\nSo: age never grants or denies. It may seed a suggested starting set when an adult creates a profile, and that is a prefilled default they can change before saving, not a rule. Age keeps its place in safety and retention (the minor-speaker flag on a turn, the rule that a safety-flagged conversation involving a teen or child is kept at least 90 days), because those are protections, not permissions.\n\nWHAT THIS CANNOT DO: nothing here reaches the safety floor. The org's Safety invariants make child-safety protections on generation and chat non-removable by any setting, flag, or admin - including the household's own owner. A grant can open an app; no grant opens a path around the safety classifier. That is architecture, not policy.\n\nSHAPE: a subject, an action and a target - the same triple relationship-based access control uses (Google's Zanzibar and the ReBAC family model permissions as exactly this). Deliberately a SEPARATE store from relationship.schema.json despite the identical shape: those edges can be machine-inferred and wrong, and an inference bug that reached a permission resolver would be a privilege escalation. Same shape, separate stores, opposite trust. A Grant is never inferred.\n\nONE THING THIS RECORD CANNOT ENFORCE, stated rather than papered over: the org's Safety invariants say unrestricted mode is unlocked 'per-user by an adult' and that child profiles are restricted by default - both age-shaped. This model deliberately removes age from authorization, so nothing here can check that a grantee is an adult; it can only check that they acknowledged for themselves and that a named person granted it. That is a genuine collision between two correct rules, and it is Jesse's call to resolve, not one to settle silently in a validator. See home/docs/BACKLOG.md.",
  );
export type Grant = z.infer<typeof Grant>;
