#!/usr/bin/env bun
// HOME-STACK-01: install.sh's last step before starting Home's own
// service - writes engines.stack.url against the not-yet-started
// database directly (setHouseholdSettingValue()/getHouseholdSettingValue(),
// the same functions every household-scope route already goes through),
// never the HTTP API, since nothing is listening yet. A one-shot
// maintenance script in the shape scripts/restore-drill.ts already
// established: lives in backend/ for this package's own modules,
// called from the top-level install.sh the way scripts/check.sh calls
// into backend/.
//
//   bun run backend/scripts/set-setting.ts engines.stack.url "http://127.0.0.1:8770"
//   bun run backend/scripts/set-setting.ts engines.stack.url "http://127.0.0.1:8770" --only-if-empty-or-prefix "http://127.0.0.1:"
import { getHouseholdSettingValue, setHouseholdSettingValue } from "../src/lib/settings";

const [key, value, ...rest] = process.argv.slice(2);
if (!key || value === undefined) {
  console.error("usage: bun run backend/scripts/set-setting.ts <key> <value> [--only-if-empty-or-prefix <prefix>]");
  process.exit(1);
}

// A code review on this item found the original, unconditional version
// would silently overwrite engines.stack.url on every upgrade run -
// fine the first time (nothing was there), wrong if a household had
// since pointed it at a remote or hand-run Stack through the settings
// UI. install.sh passes this flag so an upgrade only ever touches a
// value it plausibly wrote itself (empty, or already a loopback URL
// this same installer's own port-picker would have produced), never a
// household's own explicit choice.
const flagIndex = rest.indexOf("--only-if-empty-or-prefix");
if (flagIndex !== -1) {
  const prefix = rest[flagIndex + 1];
  if (!prefix) {
    console.error("--only-if-empty-or-prefix needs a value");
    process.exit(1);
  }
  const current = getHouseholdSettingValue(key);
  if (typeof current === "string" && current.trim().length > 0 && !current.startsWith(prefix)) {
    console.log(`${key} left as ${JSON.stringify(current)} (not a local Stack this installer would have set) - not overwritten`);
    process.exit(0);
  }
}

const result = setHouseholdSettingValue(key, value);
if (!result.ok) {
  console.error(`could not set ${key}: ${result.error}`);
  process.exit(1);
}
console.log(`${key} = ${JSON.stringify(value)}`);
