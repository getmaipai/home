// The declared-notification registry (2026-09-05, lib/notifications.ts's
// own header). getmaipai/.github/docs/NOTIFICATIONS.md: "A package or
// core declares each notification: id, level..., audience..., a plain-
// language template, optional actions[], a default channel set, and a
// privacy flag." Core's own declarations live here, one array, the same
// "one definition, one place" shape settings/coreKeys.ts already uses for
// settings keys. A package's own declaration is a real, deliberately
// deferred extension point (see lib/notifications.ts's header) - nothing
// here stops one from registering its own entries the same way once a
// real bundled package needs to.

/** getmaipai/.github/docs/NOTIFICATIONS.md's three levels, verbatim. */
export type NotificationLevel = "immediate" | "time_sensitive" | "passive";

/** The org doc's audience list is "a person, the household, admins,
 * parents of a child." `person` and `household` are exact; `adults`
 * stands in for both "admins" and "parents of a child" until Person
 * gains a real parent/guardian link (no such relationship exists in
 * spec/schemas/person.schema.json today) - a documented gap, not a
 * silent approximation: every adult in the house is a safe over-
 * inclusion for a safety alert, never an under-inclusion. */
export type NotificationAudience = "person" | "household" | "adults";

export interface NotificationType {
  id: string;
  level: NotificationLevel;
  audience: NotificationAudience;
  /** `{var}` placeholders, filled in by lib/notifications.ts's trigger(). */
  template: string;
  /** Delivered no matter what a person's own settings say - the org doc's
   * own example ("out of disk space"), and the one already-real case
   * this repo has: a safety-flagged turn for a parent (CLAUDE.md's Safety
   * invariants: "Child-safety protections... are non-removable"). A
   * `false` type gets real settings-key toggles in
   * settings/notificationKeys.ts; a `true` one gets none - there is
   * nothing for a person to turn off. */
  configurable: boolean;
  /** Channels used when a recipient has no reachable override - always
   * for a non-configurable type, the starting point for a configurable
   * one before per-person preferences narrow or widen it. */
  defaultChannels: readonly NotificationChannel[];
}

export type NotificationChannel = "in_app" | "telegram";

// `in_app` (the pending list / thirty-day center) is deliberately never
// gated by a per-type toggle: it is also the audit record ("visible
// after the fact" in the org doc), so turning it off would mean turning
// off the household's own history of what happened, not just muting a
// ping. Every type - configurable or not - always gets it.
export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  // The org doc's own worked example ("a safety-flagged turn for a
  // parent" under `immediate`) and a real, previously-unrealized gap:
  // safety.ts's evaluateSafety() has computed `notify_parent` since it
  // was written, and until this, the only place it went was a console
  // log line (turnEngine.ts never read it). CLAUDE.md's Safety
  // invariants make this non-configurable by design, not by omission:
  // "no admin setting... may disable or weaken" a child-safety
  // protection, and a parent losing visibility into a flagged
  // conversation is exactly that.
  {
    id: "safety.flagged_turn",
    level: "immediate",
    audience: "adults",
    template: "{childName}'s conversation was flagged ({categories}) and may need your attention.",
    configurable: false,
    defaultChannels: ["in_app", "telegram"],
  },
  {
    id: "model.download_ready",
    level: "time_sensitive",
    audience: "adults",
    template: "{modelName} finished downloading and is ready to use.",
    configurable: true,
    defaultChannels: ["in_app"],
  },
  {
    id: "model.download_failed",
    level: "time_sensitive",
    audience: "adults",
    template: "{modelName} failed to download: {error}",
    configurable: true,
    defaultChannels: ["in_app"],
  },
  // Session F (platform and trust), step 1: the Health/Repairs surface.
  // Only `error`-severity issues fire this (lib/issues.ts's raiseIssue());
  // `info` and `warning` sit on GET /api/repairs for a person to notice on
  // their own, the same "immediate is rare, most things are time_sensitive
  // or passive" posture the org doc asks for.
  {
    id: "repairs.new",
    level: "time_sensitive",
    audience: "adults",
    template: "{title}",
    configurable: true,
    defaultChannels: ["in_app"],
  },
  // The memory judge (step 6, session-a-intelligence.md: "one
  // memory.updated notification per run that wrote something"). `person`
  // audience, not `household` or `adults`: what the judge extracted came
  // from THIS person's own turn, the same actor lib/memoryJudge.ts's
  // remember()/supersede() calls already write as. `passive` (not
  // `time_sensitive`): nothing needs attention right now, it's a record
  // of what got remembered - the in_app pending list is where this is
  // meant to be noticed, whenever a household member next looks.
  // `configurable`: a household that finds "I remembered: ..." noisy can
  // turn it off without losing anything - unlike safety.flagged_turn,
  // there is no invariant here that requires it stay on.
  {
    id: "memory.updated",
    level: "passive",
    audience: "person",
    template: "I remembered: {summary}",
    configurable: true,
    defaultChannels: ["in_app"],
  },
  // Step 7 (session-f-platform-and-trust.md): "the band change on a
  // birthday with its passive notification" - lib/personLifecycle.ts's
  // scheduled sweep fires this once a child/teen's age crosses 13 or 18.
  // `passive`, not `time_sensitive`: nothing needs a parent's action,
  // it's a record of something that happened on its own.
  {
    id: "person.band_changed",
    level: "passive",
    audience: "adults",
    template: "{displayName} is now old enough to be a {newRole} - their profile band updated automatically.",
    configurable: true,
    defaultChannels: ["in_app"],
  },
  // Step 7: the approval queue (plan's "Ask to Install, Ask to Browse").
  // `time_sensitive`, not `passive`: a child or teen is waiting on this
  // decision, unlike person.band_changed above which reports something
  // already done.
  {
    id: "approvals.requested",
    level: "time_sensitive",
    audience: "adults",
    template: "{displayName} is asking: {summary}",
    configurable: true,
    defaultChannels: ["in_app"],
  },
] as const;

// session-d-packages-and-store.md step 2: a package's own manifest
// `notifications[]` (spec/schemas/manifest.schema.json) carries the same
// fields as NotificationType above, so a package can declare a real,
// dispatchable type without this file knowing about the package at all -
// the one addition wave-2.md's contract asks D to make here, nothing else
// in this file touched. Keyed by id in a separate map rather than pushed
// into NOTIFICATION_TYPES itself, since that array is a `const` literal of
// core's own hand-written types; getNotificationType() below checks both.
const packageNotificationTypes = new Map<string, NotificationType>();

/** A manifest's own `notifications[]` entry (spec/gen/ts/manifest.ts):
 * same fields as NotificationType, snake_cased per the spec's own
 * convention (every other manifest field is: `min_role`, `data_sources`,
 * ...), NOT the same type as NotificationType itself - a code review
 * (2026-09-06) caught the first version of this file importing
 * NotificationType for the manifest side too, which type-checked as
 * `any` at the real call site (`lib/plugins.ts`'s manifest is generated
 * from JSON Schema, `default_channels`) and would have thrown inside
 * `trigger()` the moment any package populated this for real -
 * `type.defaultChannels` reading `undefined` off an object that only
 * ever had `default_channels`. */
interface ManifestNotificationType {
  id: string;
  level: NotificationLevel;
  audience: NotificationAudience;
  template: string;
  configurable: boolean;
  default_channels: readonly NotificationChannel[];
}

/** Registers every entry in a package's manifest `notifications[]` id-first
 * so re-loading the same package (a smoke re-run, a hot install) never
 * duplicates or drops one. Silently skips an id already claimed by a core
 * type or a different package - two packages (or a package and core)
 * colliding on the same id is a manifest bug the id's own namespacing
 * (`spec/schemas/manifest.schema.json`'s "e.g. weather.severe_alert")
 * exists to prevent, not something a package's own load path should ever
 * paper over by silently overwriting the other's registration. */
export function registerPackageNotificationTypes(manifest: {
  id: string;
  notifications?: readonly ManifestNotificationType[];
}): void {
  for (const declared of manifest.notifications ?? []) {
    if (NOTIFICATION_TYPES.some((t) => t.id === declared.id)) continue;
    if (packageNotificationTypes.has(declared.id)) continue;
    const { default_channels, ...rest } = declared;
    packageNotificationTypes.set(declared.id, { ...rest, defaultChannels: default_channels });
  }
}

export function getNotificationType(id: string): NotificationType | undefined {
  return NOTIFICATION_TYPES.find((t) => t.id === id) ?? packageNotificationTypes.get(id);
}
