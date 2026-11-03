// ADULT-LOCK-06, extended by VIDEO-LORA-03: the ONE answer to "does this job use an adult-only style", asked at job start (before the Stack is called) by Create,
// chat, another take and every edit. The answer is read from the `Lora` records (lib/loras/store.ts), the one store of a style's audience; no caller keeps a copy
// of the rule.
import { getLoraRecord } from "@/lib/loras/store";
import { syncLoras } from "@/lib/loras/sync";

/** Whether any of these style ids is adult-only. A style that cannot be resolved (never in the library, or deleted with its file) counts as adult-only: the lock fails closed. A removed one keeps the audience it had. */
export async function usesAdultOnlyStyle(styleIds: readonly string[]): Promise<boolean> {
  if (styleIds.length === 0) return false;
  await syncLoras();
  return styleIds.some((id) => { const lora = getLoraRecord(id); return !lora || lora.audience === "adult-only"; });
}
