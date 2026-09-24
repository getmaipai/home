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
