// Regenerates spec/settings/keys.json from declarations (spec/settings/
// README.md: "not a placeholder to fill in by hand"). Today's only
// source is core's own CORE_SETTINGS_KEYS; a package's manifest config[]
// becomes a second source once the package host (4.9) and catalog exist,
// at which point this script grows a step that scans installed package
// manifests too, still writing the same one file.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_SETTINGS_KEYS } from "../src/settings/coreKeys.js";
import { AI_SETTINGS_KEYS } from "../src/settings/aiKeys.js";

const outPath = join(import.meta.dir, "..", "..", "spec", "settings", "keys.json");

const sorted = [...CORE_SETTINGS_KEYS, ...AI_SETTINGS_KEYS].sort((a, b) => a.key.localeCompare(b.key));
writeFileSync(outPath, JSON.stringify(sorted, null, 2) + "\n");
console.log(`Wrote ${sorted.length} settings key(s) to ${outPath}`);
