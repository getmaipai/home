// Declaration only until spec permissions and the Settings flow ship in slice 05.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
export const CONTENT_SETTINGS_KEYS: SettingsKey[] = [SettingsKey.parse({
  key: "content.filters",
  scope: "person",
  selector: "select",
  range: { multiple: true, options: ["swearing", "drugs", "gambling", "gore", "sexual", "minor_line"] },
  default: [],
  label: "Content filters",
  help: "Choose more content to block. The filters for your age stay on.",
  copy: { does: "Adds filters to the ones for your age." },
  level: "basic",
  lives_in: "person.preferences",
  honoured_by: ["home"],
})];
