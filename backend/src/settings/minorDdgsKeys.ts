// SEARCH-DDGS-TEEN-01 (owner's request, 2026-10-17): the one household switch that lets an owner or admin allow
// DuckDuckGo (the ddgs sidecar) for teens, or for teens and children. Off by default. Kept out of the pinned commons
// spec until a spec tag carries it: settingsRegistry.ts merges it in, the same way hostedSearchKeys.ts does, and the move
// is one line (delete this file once the tag lands). Read only through sourceMode.ts `minorDdgsAllowed`.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const MINOR_DDGS_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "search.ddgs_for_minors",
    scope: "household",
    selector: "select",
    range: { options: ["off", "teens", "teens_and_children"] },
    default: "off",
    label: "DuckDuckGo for teens and children",
    help: "DuckDuckGo's own filter is not guaranteed. Adult results may reach this age group. Leave this off unless you accept that. When it is on, teens (or teens and children) get DuckDuckGo beside SearXNG, with strict SafeSearch requested, adult sites blocked and the same page checks as before. Voice and robot searches for them keep using SearXNG only. Only an admin can change this.",
    level: "basic",
    lives_in: "household.search",
    honoured_by: ["home"],
    copy: {
      does: "Lets teens, or teens and children, get DuckDuckGo results beside SearXNG.",
      options: {
        off: "Teens and children use SearXNG only.",
        teens: "Teens also get DuckDuckGo. Children use SearXNG only.",
        teens_and_children: "Teens and children also get DuckDuckGo.",
      },
      option_labels: { off: "Off", teens: "Teens", teens_and_children: "Teens and children" },
    },
  }),
];
