// Step 9: storage, quotas, and the disk-full policy (plan 4.15).
// STORE-CAP-01 (docs/plans/household-storage-2026-09-23.md, "the two caps,
// declared once") adds the three keys below - a different subsystem from
// storage.person_quota_gb (cloned voices, its own help text says so) and
// storage.critical_free_gb (disk headroom monitoring): those two are about
// how much of the DISK is free; these three are the household's own
// household-file byte caps, enforced at the record API in lib/storage/
// usage.ts. Values are bytes (the keys' own _bytes suffix), never GB - a
// GB-friendly wizard/Storage-page presentation is STORE-PAGE-01's job, not
// this registry's.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

// The registry default for storage.person.default_cap_bytes below (decision
// 1: 20 GB per person). Exported so nothing else that needs "20 GB in
// bytes" (there is nothing today) grows a second copy of the literal.
export const TWENTY_GB_BYTES = 20 * 1024 * 1024 * 1024;

// One declaration per key name, imported by lib/settings.ts (the write
// gate) and lib/storage/usage.ts (enforcement) instead of each hand-typing
// the same string - a code review caught the first version declaring
// "storage.person.cap_bytes" as a separate literal constant in both of
// those files, which a future rename could silently desync.
export const HOUSEHOLD_STORAGE_CAP_KEY = "storage.household.cap_bytes";
export const PERSON_DEFAULT_STORAGE_CAP_KEY = "storage.person.default_cap_bytes";
export const PERSON_STORAGE_CAP_KEY = "storage.person.cap_bytes";

export const STORAGE_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "storage.person_quota_gb",
    scope: "person",
    selector: "number",
    default: 0,
    label: "This person's storage quota (GB)",
    help: "How much disk space this person's own uploads (cloned voices today) may use. 0 means no limit.",
    level: "advanced",
    lives_in: "person.storage",
    honoured_by: ["home"],
  }),
  // "A disk-full policy (caches first, then a Repairs item, never a
  // crash)" - the household-wide threshold storage.ts's runDiskFullCheck()
  // core job compares free disk space against. Advanced: a household
  // should rarely need to touch this, and a value that's too low defeats
  // the whole point of an early warning.
  SettingsKey.parse({
    key: "storage.critical_free_gb",
    scope: "household",
    selector: "number",
    default: 2,
    label: "Warn when free disk space drops below (GB)",
    help: "A Repairs item is raised once free space on the hub's own disk drops below this.",
    level: "advanced",
    lives_in: "household.storage",
    honoured_by: ["home"],
  }),
  // Decision 1 (household-storage-2026-09-23.md): "the household total is
  // set by the wizard from the disk" - 0 means the wizard hasn't run yet,
  // read as "no household-wide cap enforced" until it does (same "0 means
  // no limit" convention backup.max_total_gb and storage.person_quota_gb
  // already use).
  SettingsKey.parse({
    key: HOUSEHOLD_STORAGE_CAP_KEY,
    scope: "household",
    selector: "number",
    default: 0,
    label: "Household storage cap (bytes)",
    help: "The total bytes the whole household's files may use. 0 means no cap is set yet - the setup wizard sets this from the disk.",
    level: "basic",
    lives_in: "household.storage",
    honoured_by: ["home"],
  }),
  // Decision 1: 20 GB per person by default. Every person's cap unless
  // storage.person.cap_bytes overrides it for that one person.
  SettingsKey.parse({
    key: PERSON_DEFAULT_STORAGE_CAP_KEY,
    scope: "household",
    selector: "number",
    default: TWENTY_GB_BYTES,
    label: "Default per-person storage cap (bytes)",
    help: "How many bytes each person may use for their own files, unless that person has their own override below.",
    level: "basic",
    lives_in: "household.storage",
    honoured_by: ["home"],
  }),
  // Person-scope override, admin-set (lib/settings.ts's
  // assertCanSetPersonStorageCap - the generic person-scope gate would
  // otherwise let a person raise their own cap by writing their own
  // setting, which this key must not allow). 0 means no override: falls
  // back to storage.person.default_cap_bytes above.
  SettingsKey.parse({
    key: PERSON_STORAGE_CAP_KEY,
    scope: "person",
    selector: "number",
    default: 0,
    label: "This person's storage cap override (bytes)",
    help: "Overrides the household's default per-person cap for this one person. 0 means no override: this person follows the household default. Set by an owner or admin.",
    level: "advanced",
    lives_in: "person.storage",
    honoured_by: ["home"],
  }),
];
