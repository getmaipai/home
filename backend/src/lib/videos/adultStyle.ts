// ADULT-LOCK-06: the ONE answer to "does this job use an adult-only style", asked at job start (before the Stack is called) by Create, chat, another take and
// every edit. A style is an adult-only video adapter today (`generation.video.adult_adapters`, lib/videos/adapters.ts, classification `adult-only`). The LoRA
// slices (VIDEO-LORA-03 and later) extend this one function with the `Lora` records' own classification; no caller keeps a copy of the rule.
import { allVideoAdapters } from "@/lib/videos/adapters";

/** Whether any of these style ids is adult-only. A style that cannot be resolved (removed or renamed since it was chosen) counts as adult-only: the lock fails closed. */
export async function usesAdultOnlyStyle(styleIds: readonly string[]): Promise<boolean> {
  if (styleIds.length === 0) return false;
  const known = new Map((await allVideoAdapters()).map((adapter) => [adapter.id, adapter.classification]));
  return styleIds.some((id) => !known.has(id) || known.get(id) === "adult-only");
}
