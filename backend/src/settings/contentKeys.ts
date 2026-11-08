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
}), ...(["content.policy.chat_output", "content.policy.search", "content.policy.pictures", "content.policy.videos"] as const).map((key) => SettingsKey.parse({
  key,
  scope: "household",
  selector: "boolean",
  default: false,
  label: { "content.policy.chat_output": "Chat and News content policy", "content.policy.search": "Search content policy", "content.policy.pictures": "Child picture rewrite", "content.policy.videos": "Child video rewrite" }[key],
  help: "Apply each person's resolved content policy to this content.",
  copy: { does: key.startsWith("content.policy.p") || key.endsWith("videos") ? "Lets the child creation lane gently rewrite soft requests before making media." : "Applies the household content policy to checked text." },
  level: "expert",
  lives_in: "household.preferences",
  honoured_by: ["home"],
}))];
