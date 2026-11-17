// Declaration only until spec permissions and the Settings flow ship in slice 05.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
export const CONTENT_SETTINGS_KEYS: SettingsKey[] = [SettingsKey.parse({
  key: "content.filters",
  scope: "person",
  selector: "select",
  range: { multiple: true, options: ["swearing", "drugs", "gambling", "gore", "sexual"] },
  layers: ["band", "household", "person"], merge: "union",
  default: [],
  label: "Content filters",
  help: "Choose more kinds of content to hold back. The kinds this level already holds back stay on, and an admin's choices stay until the admin changes them.",
  copy: {
    does: "Holds back more kinds of content on top of the level's own.",
    options: { swearing: "Holds back swearing.", drugs: "Holds back drug and alcohol content.", gambling: "Holds back gambling content.", gore: "Holds back gory violence.", sexual: "Holds back sexual content.", },
    option_labels: { swearing: "Swearing", drugs: "Drugs and alcohol", gambling: "Gambling", gore: "Gore", sexual: "Sexual content" },
  },
  level: "basic",
  lives_in: "person.allowance",
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
    help: "Holds a reply sentence that breaks the content rules below the X level. The safety floor stays on whatever this says.",
    copy: { does: "Checks each reply sentence against the house wording limits below X." },
    level: "advanced", secret: false, lives_in: "household.ai_advanced", honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: CONTENT_POLICY_NEWS_KEY, scope: "household", selector: "boolean", default: true,
    label: "Content rules on News",
    help: "Holds a News sentence or headline that breaks the content rules below the X level. The safety floor stays on whatever this says.",
    copy: { does: "Checks each headline and story sentence against the wording limits below X." },
    level: "advanced", secret: false, lives_in: "household.ai_advanced", honoured_by: ["home"],
  }),
];
