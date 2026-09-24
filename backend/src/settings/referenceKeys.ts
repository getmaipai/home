// The reference library's own location (SOURCE-SPEC-01,
// docs/plans/knowledge-sources-2026-09-24.md): "Home holds the
// machinery... the library manager" - where a reference package's own
// installed archive files live is host machinery, not a per-package
// setting, the same reason home.base_url and search.searxng_url are
// declared here rather than in a catalog package.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const REFERENCE_SETTINGS_KEYS: SettingsKey[] = [
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
];

// NOT added in this pass, deliberately (docs/dev.md's REFERENCE-LIBRARY-01
// entry has the full account): "Person/child rules" (owner's call 5)
// wants a person-scope `reference.images` setting, same shape as
// search.safe_search. Declaring it here would need a commons spec-pin
// cut and regeneration to actually be writable (SOURCE-SPEC-01's own
// hard-won lesson: a settings key that isn't in the real generated
// keys.json 400s on every write) - real work, but nothing in this repo
// reads the setting yet either (REFERENCE-APP-01/LOOKUP-FED-01 are its
// first callers), so it is left as a named follow-up rather than landed
// half-wired under this item's own credit-pressure deadline.
