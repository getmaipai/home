// Core's own settings declarations (4.6, 3.2). `spec/settings/keys.json`
// is explicitly "not a placeholder to fill in by hand" (spec/settings/
// README.md): it's generated from declarations like this one, plus
// (later) package manifests' config[]. See scripts/gen-settings-
// registry.ts, which writes this array out to that file.
//
// Each entry is parsed through the generated SettingsKey schema at
// module load, so a bad declaration fails immediately (at `bun test` or
// at generation time), not silently at some later read.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

// Household locale: referenced by name in docs/ENGINEERING.md's Language
// and locale rule ("Dates, units, and currency come from household
// locale, never hard-coded") and 6.7's multi-language design, but nothing
// reads it yet (no dates render anywhere; that's shell/kit work, chapter
// 6, not started). Declared now anyway because it's the first genuinely
// justified entry to prove the registry mechanism end-to-end, not an
// invented setting: the rule it backs already shipped.
//
// `lives_in: "household.system"` is a best-guess central page id: 6.6
// Rule 2 lists "System" under Household's central pages but the shell
// that would actually render it doesn't exist yet, so this is provisional
// until a real page id convention lands with chapter 6.
//
// Locale list kept to what's actually usable today: docs/ENGINEERING.md's
// language rule requires English, and STACK.md's robot speech stack notes
// Moonshine (the default English STT) is English-only, so a genuinely
// multi-locale household waits on that work landing, not on this key.
// Backs lib/conversationHistory.ts's runRetention() (4.14: "retention
// defaults: conversations ninety days then summarised... each is a
// household setting with a floor for kid safety logs"). No summarization
// mechanism exists yet (4.11's other roles), so this pass's retention is
// a hard delete at the boundary rather than summarize-then-purge, stricter
// than 4.14 describes but consistent with not keeping raw transcripts
// past their stated window; see conversationHistory.ts for the floor.
export const CORE_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "household.locale",
    scope: "household",
    selector: "select",
    range: { options: ["en-US", "en-GB"] },
    default: "en-US",
    label: "Language and region",
    help: "Sets the household's date, time, and unit formatting.",
    level: "basic",
    lives_in: "household.system",
    honoured_by: ["home", "bot"],
  }),
  SettingsKey.parse({
    key: "household.conversation_retention_days",
    scope: "household",
    selector: "number",
    range: { min: 7, max: 365 },
    default: 90,
    label: "Conversation history retention",
    help: "How long chat history is kept before it's deleted. A safety-flagged conversation involving a teen or child is always kept for at least 90 days regardless of this setting.",
    level: "advanced",
    lives_in: "household.system",
    honoured_by: ["home"],
  }),
];
