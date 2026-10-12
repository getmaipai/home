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
  // KS-MODE-01: `search.wikipedia_fallback` (the KS-02-PRIV stopgap) is retired. Its job is done by
  // `search.source_mode` and its two per-source overrides, declared once in commons
  // (spec/settings/keys.json, spec/vocab/source-mode.json) and interpreted in
  // lib/retrieval/sourceMode.ts. A stored value migrates once (sourceModeMigration.ts).
  // SEARCH-SAFE-01 (Jesse's own ruling, 2026-09-24): a real per-person
  // level, never left unset - child strict, teen moderate, adult off by
  // default ("default" resolves against the speaker's own band,
  // safeSearch.ts's resolveSafeSearchLevel()). The write rule this key
  // needs lives in settings.ts's assertCanSetSafeSearch(): the help text
  // states the intended rule (MINOR-SEARCH-01a); MINOR-SEARCH-01c aligns the
  // write path with it. It is
  // not in this declaration - no field here carries a writer rule, the
  // same as every other settings key in this repo.
  SettingsKey.parse({
    key: "search.safe_search",
    scope: "person",
    selector: "select",
    range: { options: ["default", "off", "moderate", "strict"] },
    default: "default",
    label: "Safe search level",
    help: "How strictly web search filters results for you. \"Default\" follows your age: strict for a child, moderate for a teen, off for an adult. A child's is always strict. A teen can make theirs stricter but never lower than moderate. An adult can change their own.",
    level: "basic",
    lives_in: "person.search",
    honoured_by: ["home"],
  }),
];
