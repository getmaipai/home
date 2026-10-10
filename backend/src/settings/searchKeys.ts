// The household's web search connection (session-d-packages-and-store.md
// step 7): "bring your own SearXNG instance," the only design that
// survived research into a bundled, cross-platform, zero-dependency
// alternative. SearXNG (unlike llama-server, already downloaded and
// pinned per-platform by the engine catalog) has no official prebuilt
// binary for any OS - only Docker or a from-source install with real
// per-OS build dependencies, much worse on Windows. Rather than hand-roll
// a fragile bundled install path for something the project itself doesn't
// ship that way, this is one setting: point MaiPai at any SearXNG
// instance the household already runs (their own Docker container, one
// on the LAN, whatever) - the exact shape `home.base_url` already takes
// for Home Assistant, another self-hosted service MaiPai integrates with
// rather than bundles.
//
// Not a secret: a SearXNG instance's own address is like Home Assistant's
// `home.base_url` (useful in logs and diagnostics), not a credential -
// SearXNG's default JSON API needs no key or token.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const SEARCH_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "search.searxng_url",
    scope: "household",
    selector: "text",
    default: "",
    label: "Your own SearXNG (optional)",
    help: "Your own SearXNG (optional). Leave empty to use the search service MaiPai runs for you.",
    level: "advanced",
    lives_in: "household.search",
    honoured_by: ["home"],
  }),
  // KS-02: `search.wikipedia_fallback` was retired here. The live Wikimedia call is the
  // disclosed `wikimedia-live` data source of the websearch package (wikimediaLive.ts),
  // reached only when the offline library had no title match.
  // SEARCH-SAFE-01 (Jesse's own ruling, 2026-09-24): a real per-person
  // level, never left unset - child strict, teen moderate, adult off by
  // default ("default" resolves against the speaker's own band,
  // safeSearch.ts's resolveSafeSearchLevel()). The write rule this key
  // needs (an adult may change their own; only an adult may change a
  // child's or teen's; a child or teen can never loosen their own below
  // their band default) lives in settings.ts's assertCanSetSafeSearch(),
  // not in this declaration - no field here carries a writer rule, the
  // same as every other settings key in this repo.
  SettingsKey.parse({
    key: "search.safe_search",
    scope: "person",
    selector: "select",
    range: { options: ["default", "off", "moderate", "strict"] },
    default: "default",
    label: "Safe search level",
    help: "How strictly web search filters results for you. \"Default\" follows your age: strict for a child, moderate for a teen, off for an adult. An adult can change their own; only an adult can change a child's or teen's, and a child or teen can never loosen their own below their default.",
    level: "basic",
    lives_in: "person.search",
    honoured_by: ["home"],
  }),
];
