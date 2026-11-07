// I18N-F0: the per-person language. Declared in Home until a commons spec tag carries it (scripts/settings-ahead-of-spec.json,
// data-scratch/i18n-f0-spec-change.md). Drawn by describeSetting like any key (RULES S4, S5); the machine-translation note is
// the key's own help copy, not a page-written sentence.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const LOCALE_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "person.locale",
    scope: "person",
    selector: "select",
    range: { options: ["household", "en-US", "en-GB", "es"] },
    default: "household",
    label: "Language",
    help: "Choose the language used in Home. Some of this was translated by your home's own AI and may read oddly. If something is wrong, tell the person who runs your home.",
    copy: { does: "Choose the language used in Home.", option_labels: { household: "Same as the home" } },
    level: "basic",
    lives_in: "person.profile",
    honoured_by: ["home", "bot"],
  }),
];
