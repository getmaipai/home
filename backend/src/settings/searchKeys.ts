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
    label: "SearXNG URL",
    help: "The address of a SearXNG instance you run, e.g. http://localhost:8080. Web search is off until this is set - MaiPai never scrapes a search engine directly.",
    level: "advanced",
    lives_in: "household.integrations",
    honoured_by: ["home"],
  }),
  // SEARCH-FALLBACK-01 (docs/plans/search-resilience-2026-09-24.md):
  // "a setting under web search, on whenever web search is on" - a
  // second, real outbound connection (Wikipedia's own official API,
  // never SearXNG), so it gets its own toggle rather than being folded
  // silently into search.searxng_url's own behavior. Default true: it
  // only ever fires when the main search already failed or found
  // nothing, the exact case a household configured web search to help
  // with in the first place.
  SettingsKey.parse({
    key: "search.wikipedia_fallback",
    scope: "household",
    selector: "boolean",
    default: true,
    label: "Ask Wikipedia when web search fails or finds nothing",
    help: "When your SearXNG instance is down or a search comes back empty, MaiPai asks Wikipedia's own official API instead - covers people, shows, places, products and history. On by default whenever web search is set up; turn it off here if you don't want it.",
    level: "advanced",
    lives_in: "household.integrations",
    honoured_by: ["home"],
  }),
];
