// THIN-4H (rule 7): the optional hosted search key. Kept out of
// SEARCH_SETTINGS_KEYS (which scripts/gen-settings-registry.ts writes into
// the pinned commons spec) because the spec has no tag carrying it yet:
// settingsRegistry.ts merges it in until a commons spec tag does, and the
// move is one line (add it to SEARCH_SETTINGS_KEYS once the tag lands).
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const HOSTED_SEARCH_SETTINGS_KEYS: SettingsKey[] = [
  // THIN-4H (rule 7): an optional hosted search provider's key. Off by
  // default (empty); a write-only secret; used for an adult's searches
  // only, never a child's or teen's. Declared here, once; the settings
  // renderer draws it from this declaration.
  SettingsKey.parse({
    key: "search.brave_api_key",
    scope: "household",
    selector: "text",
    default: "",
    label: "Brave Search key (optional)",
    help: "Optional. Search works without any key. If you add a Brave Search API key, an adult's web searches go to Brave Search instead of your SearXNG, so the words searched leave your house. A child's or teen's searches never do. The key is stored encrypted and can't be read back. Clear it to go back to keyless search.",
    level: "advanced",
    secret: true,
    lives_in: "household.search",
    honoured_by: ["home"],
  }),
];
