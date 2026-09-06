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
];
