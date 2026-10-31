// TIER-HOME-05: the one running Max chat lease. The swap is the Stack's coding-mode transaction (unload residents, load the big model,
// post-load check, return on failure); the readiness record gates whether Max chat is offered at all.
import { createChatLease, type ChatLease } from "@/lib/chatLease";
import { codingModeReadiness } from "@/lib/codingMode";
import { getStackClient } from "@/lib/stackEngine";
import { setChatLeaseSource } from "@/lib/jobs/householdQueue";

let lease: ChatLease | null = null;
export function getChatLease(): ChatLease {
  lease ??= createChatLease({
    now: Date.now,
    ready: async () => (await codingModeReadiness()).ready,
    swapToBig: () => getStackClient().setCodingMode("coding"),
    swapToStandard: () => getStackClient().setCodingMode("normal"),
  });
  return lease;
}

/** Startup: the queue reads the lease, and a minute timer releases an idle one between requests. */
export function startChatLease(): void {
  setChatLeaseSource(() => getChatLease().holdsGenerators());
  setInterval(() => { void getChatLease().tick().catch(() => { /* the next tick retries */ }); }, 60_000).unref();
}
