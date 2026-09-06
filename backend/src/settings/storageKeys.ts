// Step 9: storage, quotas, and the disk-full policy (plan 4.15).
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

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
];
