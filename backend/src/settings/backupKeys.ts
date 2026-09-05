// Backups' own settings declarations (2.5: "retention seven daily, four
// weekly, three monthly, oldest pruned first, WITH A SIZE CAP PER
// TARGET" - lib/backup.ts's pruneBackups() already does the tiered part;
// this is the size cap that comment's own "no settings key exists to
// declare it" gap named). Only one target exists today (`local`), so
// "per target" is just "this one" for now - a real second target
// (`hub`/`smb`) would need its own key when it exists, not a retrofit of
// this one into a map.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const BACKUP_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "backup.max_total_gb",
    scope: "household",
    selector: "number",
    range: { min: 0, max: 1000 },
    default: 0,
    label: "Backup storage limit (GB)",
    help: "Once total backup storage passes this, the oldest backups are deleted first - checked after the normal seven-daily/four-weekly/three-monthly schedule. 0 means no extra limit.",
    level: "advanced",
    lives_in: "household.system",
    honoured_by: ["home"],
  }),
];
