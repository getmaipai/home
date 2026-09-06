// Step 7: the read side of settings/allowanceKeys.ts - "you write it"
// (session-f-platform-and-trust.md, step 7's own text about ctx.allowance).
// This returns the household's CONFIGURED limit only, never "how many
// minutes are left today": that needs live session bookkeeping the
// package host itself tracks while packages actually run
// (packageHost.ts, D's file - out of scope here, see this repo's
// CLAUDE.md "Files you own"). D's ctx-builder is expected to call this
// once per turn and combine it with that day's already-elapsed usage to
// produce ctx.allowance; this file has nothing to say about usage.
import { getSettingValueForPerson } from "@/lib/settings";
import { allowanceKeyFor, type AllowanceCategory } from "@/settings/allowanceKeys";

/** 0 (the key's own default) means no limit is configured for this
 * person/category - distinguished from "already used up" by the
 * ctx-builder, not by this function. */
export function dailyMinutesAllowed(personId: string, category: AllowanceCategory): number {
  const value = getSettingValueForPerson(personId, allowanceKeyFor(category));
  return typeof value === "number" ? value : 0;
}
