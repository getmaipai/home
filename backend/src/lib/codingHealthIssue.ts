// CODE-NOTIFY-01 (RULES.md S6: no new surface): the coding engine's health reaches Repairs as one item, raised while Coding is on and the engine is
// offline, resolved when it answers again. The same pattern as stackCodingPieces.ts's engine install item.
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { getHouseholdSettingValue } from "@/lib/settings";
import type { CodingConcern } from "@/lib/roleHealth";

export async function syncCodingHealthIssue(concern: CodingConcern): Promise<void> {
  try {
    if (getHouseholdSettingValue("coding.enabled") === true && concern.cause === "offline") {
      await raiseIssue({ source: "coding", key: "engine_offline", severity: "warning", title: "The coding engine is not answering",
        detail: "Coding sessions wait until it is back. It restarts on its own; if it stays down, restart the engine from Settings, Engine." });
    } else resolveIssue("coding", "engine_offline");
  } catch { /* Repairs is a courtesy here; Status still answers. */ }
}
