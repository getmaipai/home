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
}), ...(["content.policy.chat_output", "content.policy.search"] as const).map((key) => SettingsKey.parse({
  key,
  scope: "household",
  selector: "boolean",
  default: false,
  label: key.endsWith("chat_output") ? "Chat and News content policy" : "Search content policy",
  help: "Apply each person's resolved content policy to this content.",
  copy: { does: "Applies the household content policy to checked text." },
  level: "expert",
  lives_in: "household.preferences",
  honoured_by: ["home"],
}))];
