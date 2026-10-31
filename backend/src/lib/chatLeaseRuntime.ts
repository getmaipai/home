// TIER-HOME-05: the one running Max chat lease. The swap is the Stack's coding-mode transaction (unload residents, load the big model,
// post-load check, return on failure); the readiness record gates whether Max chat is offered at all.
import { createChatLease, registerActiveChatLease, type ChatLease } from "@/lib/chatLease";
import { codingModeReadiness } from "@/lib/codingMode";
import { getStackClient } from "@/lib/stackEngine";
import { openMaxWindow, setChatLeaseSource, setChatTurnObserver } from "@/lib/jobs/householdQueue";

let lease: ChatLease | null = null;
export function getChatLease(): ChatLease {
  lease ??= createChatLease({
    now: Date.now,
    windowOpen: () => openMaxWindow() !== null,
    ready: async () => (await codingModeReadiness()).ready,
    swapToBig: () => getStackClient().setCodingMode("coding"),
    swapToStandard: () => getStackClient().setCodingMode("normal"),
  });
  registerActiveChatLease(lease);
  return lease;
}

/** Startup: the queue reads the lease, and a minute timer releases an idle one between requests. */
export function startChatLease(): void {
  registerActiveChatLease(getChatLease());
  setChatLeaseSource(() => getChatLease().holdsGenerators());
  // While the lease is up every chat turn answers on the big model: a turn in flight keeps the lease, and its end restarts the idle timer.
  setChatTurnObserver({
    started: () => { if (getChatLease().snapshot().state === "held") getChatLease().requestStarted(); },
    ended: () => { if (getChatLease().snapshot().state === "held") getChatLease().requestEnded(); },
  });
  setInterval(() => { void getChatLease().tick().catch(() => { /* the next tick retries */ }); }, 60_000).unref();
}
