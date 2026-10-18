// Ahead-of-spec. Scalar fields use the shipped Settings renderer; together
// each pair is the type's { mode, threshold_percent } retention rule.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
export const LIBRARY_RETENTION_TYPES = ["pictures", "videos", "songs", "documents", "uploads", "generated", "trash"] as const;
export type LibraryRetentionType = typeof LIBRARY_RETENTION_TYPES[number];
export const retentionKeys = (type: LibraryRetentionType) => ({ mode: `storage.library.${type}.mode`, threshold: `storage.library.${type}.threshold_percent` });
export const LIBRARY_TRASH_DAYS_KEY = "storage.library.trash_days";
export const LIBRARY_RETENTION_KEYS: SettingsKey[] = [
  ...LIBRARY_RETENTION_TYPES.flatMap((type) => [
    SettingsKey.parse({ key: retentionKeys(type).mode, scope: "household", selector: "select", range: { options: ["keep", "until_storage_threshold"] }, copy: { does: "Keeps files, or frees space after a warning. Pinned files stay.", option_labels: { keep: "Keep until deleted", until_storage_threshold: "Free space after a warning" } }, default: ["documents", "uploads", "trash"].includes(type) ? "keep" : "until_storage_threshold", label: `${type[0]!.toUpperCase()}${type.slice(1)} retention`, help: `Keep ${type}, or warn when total storage is full. After a day, remove the oldest unpinned items Home made. Pinned items always stay.`, level: "basic", lives_in: "household.storage", honoured_by: ["home"] }),
    SettingsKey.parse({ key: retentionKeys(type).threshold, scope: "household", selector: "number", range: { min: 1, max: 100 }, default: 90, label: `${type[0]!.toUpperCase()}${type.slice(1)} storage warning (%)`, help: "Use the household storage cap. Warn above this percent. Saved uploads and pinned items stay. Trash rules will apply when Library Trash is ready.", level: "advanced", lives_in: "household.storage", honoured_by: ["home"] }),
  ]),
  SettingsKey.parse({ key: LIBRARY_TRASH_DAYS_KEY, scope: "household", selector: "number", range: { min: 1, max: 3650 }, default: 30, label: "Days to keep Library Trash", help: "Keep deleted file links for this many days. This takes effect when Library Trash is ready.", level: "basic", lives_in: "household.storage", honoured_by: ["home"] }),
];
