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

// CONTENT-POLICY-02: the two rollout flags (RULES.md C6: a flag never disables a floor). When one is false the door still runs the
// `minor-line` floor for that surface and skips only the `rules-check` rater. Household scope, so only an owner or admin writes them.
export const CONTENT_POLICY_CHAT_KEY = "content.policy.chat";
export const CONTENT_POLICY_NEWS_KEY = "content.policy.news";
export const CONTENT_POLICY_FLAG_KEYS: readonly string[] = [CONTENT_POLICY_CHAT_KEY, CONTENT_POLICY_NEWS_KEY];
export const CONTENT_POLICY_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: CONTENT_POLICY_CHAT_KEY, scope: "household", selector: "boolean", default: true,
    label: "Content rules on chat replies",
    help: "Holds a reply sentence that breaks the content rules for a child or teen. The safety floor stays on whatever this says.",
    copy: { does: "Applies the content rules to chat replies for children and teens." },
    level: "advanced", secret: false, lives_in: "household.content", honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: CONTENT_POLICY_NEWS_KEY, scope: "household", selector: "boolean", default: true,
    label: "Content rules on News",
    help: "Holds a News sentence or headline that breaks the content rules for a child or teen. The safety floor stays on whatever this says.",
    copy: { does: "Applies the content rules to News for children and teens." },
    level: "advanced", secret: false, lives_in: "household.content", honoured_by: ["home"],
  }),
];
