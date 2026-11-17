import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

/** Rule E5: the household's order of parts for one category, written by Settings, AI and models, Features. Empty (the default) means the Stack's priority; Home stores no part name here, only ids the Stack served. */
const orderKey = (category: string, title: string) => SettingsKey.parse({
  key: `engines.${category}.order`, scope: "household", selector: "text", range: { value_schema: "part-order" }, default: [],
  label: `${title} order`, help: `The order Home asks the Stack to try ${title.toLowerCase()} models in. Empty follows the Stack's own order. Normally set from the AI and models page.`,
  level: "expert", lives_in: "household.ai_advanced", honoured_by: ["home"],
});
export const ENGINE_ORDER_SETTINGS_KEYS = [orderKey("pictures", "Pictures"), orderKey("video", "Video"), orderKey("music", "Music")];
