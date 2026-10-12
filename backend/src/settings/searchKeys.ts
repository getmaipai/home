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

/** spec-v0.1.120 lists `copy` after `honoured_by` in these two entries (the generated registry compares
 * the serialized text, so field order counts). Follow the spec's order until a spec tag normalises it. */
function specFieldOrder(entry: SettingsKey): SettingsKey {
  const { copy, ...rest } = entry as SettingsKey & { copy?: unknown };
  return { ...rest, ...(copy !== undefined ? { copy } : {}) } as SettingsKey;
}

/** spec-v0.1.122 lists `copy` before `level` in the blocklist entries; the generated registry compares
 * the serialized text, so field order counts. */
function blocklistFieldOrder(entry: SettingsKey): SettingsKey {
  const { copy, level, secret, lives_in, honoured_by, ...rest } = entry as SettingsKey & { copy?: unknown };
  return { ...rest, copy, level, secret, lives_in, honoured_by } as SettingsKey;
}

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
  // MINOR-SEARCH-01c: declared once in commons (spec/settings/keys.json), mirrored here for the registry.
  specFieldOrder(SettingsKey.parse({
      "key": "search.web.child_mode",
      "scope": "household",
      "selector": "select",
      "range": {
          "options": [
              "on",
              "off"
          ]
      },
      "default": "on",
      "label": "Web search with child controls",
      "help": "When this is on, MaiPai can look things up on the web for people using child controls. Results go through SafeSearch at its strictest, adult sites are blocked, and links are hidden. When it is off, answers come only from the offline library. Only an admin can change this, and a child's searches show in that child's own chats.",
      "level": "basic",
      "lives_in": "household.search",
      "honoured_by": [
          "home"
      ],
      "copy": {
          "does": "Lets answers look things up online, or keeps them to the offline library.",
          "options": {
              "on": "Looks things up online, with the safeguards described above.",
              "off": "Answers only from the offline library."
          }
      }
  })),
  // MINOR-SEARCH-01c: declared once in commons (spec/settings/keys.json), mirrored here for the registry.
  specFieldOrder(SettingsKey.parse({
      "key": "search.web.teen_mode",
      "scope": "household",
      "selector": "select",
      "range": {
          "options": [
              "on",
              "off"
          ]
      },
      "default": "on",
      "label": "Web search with teen controls",
      "help": "When this is on, MaiPai can look things up on the web for people using teen controls. Results go through SafeSearch at moderate or stricter, and adult sites are blocked. When it is off, answers come only from the offline library. Only an admin can change this. It does not show anyone what a teen searched for.",
      "level": "basic",
      "lives_in": "household.search",
      "honoured_by": [
          "home"
      ],
      "copy": {
          "does": "Lets answers look things up online, or keeps them to the offline library.",
          "options": {
              "on": "Looks things up online, with the safeguards described above.",
              "off": "Answers only from the offline library."
          }
      }
  })),
  // MINOR-SEARCH-01e-6: the synced blocklists, declared once in commons (spec/settings/keys.json).
  blocklistFieldOrder(SettingsKey.parse({
      "key": "search.blocklists.child",
      "scope": "household",
      "selector": "select",
      "range": {
          "options": [
              "blp-gambling",
              "blp-scam",
              "blp-phishing",
              "blp-malware",
              "blp-drugs"
          ],
          "multiple": true
      },
      "default": [
          "blp-gambling",
          "blp-scam",
          "blp-phishing",
          "blp-malware",
          "blp-drugs"
      ],
      "label": "Blocked sites with child controls",
      "help": "Which lists of blocked sites are checked when MaiPai searches the web for people using child controls. Adult sites are always blocked for child and teen controls and are not listed here. Home downloads each list once and keeps it up to date. Web search for child controls starts once every list checked here has been downloaded. Only an admin can change this.",
      "copy": {
          "does": "Chooses which lists of blocked sites are checked when the web is searched.",
          "options": {
              "blp-gambling": "Blocks betting, casino and lottery sites.",
              "blp-scam": "Blocks sites known for fake offers, fake shops and fraud.",
              "blp-phishing": "Blocks sites that pretend to be a bank or an account page to steal a login.",
              "blp-malware": "Blocks sites known for spreading viruses and harmful downloads.",
              "blp-drugs": "Blocks sites that sell or promote illegal drugs."
          },
          "option_labels": {
              "blp-gambling": "Gambling sites",
              "blp-scam": "Scam sites",
              "blp-phishing": "Phishing sites",
              "blp-malware": "Malware sites",
              "blp-drugs": "Drug sites"
          }
      },
      "level": "advanced",
      "secret": false,
      "lives_in": "household.blocked_sites",
      "honoured_by": [
          "home"
      ]
  })),
  blocklistFieldOrder(SettingsKey.parse({
      "key": "search.blocklists.teen",
      "scope": "household",
      "selector": "select",
      "range": {
          "options": [
              "blp-gambling",
              "blp-scam",
              "blp-phishing",
              "blp-malware",
              "blp-drugs"
          ],
          "multiple": true
      },
      "default": [
          "blp-gambling",
          "blp-scam",
          "blp-phishing",
          "blp-malware"
      ],
      "label": "Blocked sites with teen controls",
      "help": "Which lists of blocked sites are checked when MaiPai searches the web for people using teen controls. Adult sites are always blocked for child and teen controls and are not listed here. Web search for teen controls starts once every list checked here has been downloaded. Only an admin can change this. It does not show anyone what a teen searched for or which sites were blocked.",
      "copy": {
          "does": "Chooses which lists of blocked sites are checked when the web is searched.",
          "options": {
              "blp-gambling": "Blocks betting, casino and lottery sites.",
              "blp-scam": "Blocks sites known for fake offers, fake shops and fraud.",
              "blp-phishing": "Blocks sites that pretend to be a bank or an account page to steal a login.",
              "blp-malware": "Blocks sites known for spreading viruses and harmful downloads.",
              "blp-drugs": "Blocks sites that sell or promote illegal drugs."
          },
          "option_labels": {
              "blp-gambling": "Gambling sites",
              "blp-scam": "Scam sites",
              "blp-phishing": "Phishing sites",
              "blp-malware": "Malware sites",
              "blp-drugs": "Drug sites"
          }
      },
      "level": "advanced",
      "secret": false,
      "lives_in": "household.blocked_sites",
      "honoured_by": [
          "home"
      ]
  })),
  blocklistFieldOrder(SettingsKey.parse({
      "key": "search.blocklists.adult",
      "scope": "household",
      "selector": "select",
      "range": {
          "options": [
              "blp-porn",
              "blp-gambling",
              "blp-scam",
              "blp-phishing",
              "blp-malware",
              "blp-drugs"
          ],
          "multiple": true
      },
      "default": [],
      "label": "Blocked sites with adult controls",
      "help": "Lists of blocked sites to check when MaiPai searches the web for adults. None are checked unless you pick them. Scam, phishing and malware lists are a good start for a household that wants that protection. Only an admin can change this.",
      "copy": {
          "does": "Chooses which lists of blocked sites are checked when the web is searched.",
          "options": {
              "blp-porn": "Blocks sites made only for grown-ups.",
              "blp-gambling": "Blocks betting, casino and lottery sites.",
              "blp-scam": "Blocks sites known for fake offers, fake shops and fraud.",
              "blp-phishing": "Blocks sites that pretend to be a bank or an account page to steal a login.",
              "blp-malware": "Blocks sites known for spreading viruses and harmful downloads.",
              "blp-drugs": "Blocks sites that sell or promote illegal drugs."
          },
          "option_labels": {
              "blp-porn": "Adult sites",
              "blp-gambling": "Gambling sites",
              "blp-scam": "Scam sites",
              "blp-phishing": "Phishing sites",
              "blp-malware": "Malware sites",
              "blp-drugs": "Drug sites"
          }
      },
      "level": "advanced",
      "secret": false,
      "lives_in": "household.blocked_sites",
      "honoured_by": [
          "home"
      ]
  })),
];
