// The reference library's own location (SOURCE-SPEC-01,
// docs/plans/knowledge-sources-2026-09-24.md): "Home holds the
// machinery... the library manager" - where a reference package's own
// installed archive files live is host machinery, not a per-package
// setting, the same reason home.base_url and search.searxng_url are
// declared here rather than in a catalog package.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const REFERENCE_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "reference.download.when",
    scope: "household",
    selector: "select",
    range: { options: ["anytime", "window"] },
    default: "window",
    label: "Reference download time",
    copy: {
      does: "Downloads reference books anytime or during the nightly window.",
      options: {
        anytime: "Downloads a book as soon as you ask for it, at any hour.",
        window: "Waits for the nightly window so downloads do not slow the home in the day.",
      },
    },
    help: "Choose when reference books may download. The nightly window is set in Home updates.",
    level: "advanced",
    lives_in: "household.reference",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "reference.library_dir",
    scope: "household",
    selector: "text",
    default: "",
    label: "Reference library location",
    help: "Where the household's offline knowledge archives live: a local folder, an external drive, or a NAS mount. Empty uses Home's own data folder. Moving this later moves the files and updates the library records.",
    level: "basic",
    lives_in: "household.reference",
    honoured_by: ["home"],
  }),
  // IMG-SPEC-KEYS (spec-v0.1.80): declared in the spec by the images lane;
  // registered here so the pinned registry matches. Its readers land with
  // ANSWER-IMG; until then nothing reads it.
  SettingsKey.parse({
    key: "reference.images",
    scope: "person",
    selector: "boolean",
    default: true,
    label: "Show pictures in answers",
    help: "Adults and teens are on by default; children are off until a parent enables this. Teens control their own setting.",
    level: "basic",
    lives_in: "person.chat",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "chat.auto_lead_image",
    scope: "person",
    selector: "boolean",
    default: true,
    label: "Show a picture for a named subject",
    help: "When you ask about one named movie, show, book, album, game, person, animal, place or product, Home can show one picture above the answer. Age and picture checks still apply.",
    level: "basic",
    lives_in: "person.chat",
    honoured_by: ["home"],
  }),
];
