// TIER-HOME-05: the one running Max chat lease. The swap is the Stack's coding-mode transaction (unload residents, load the big model,
// post-load check, return on failure); the readiness record gates whether Max chat is offered at all.
import { recordTransition } from "@/lib/chatTransitions";
import { createChatLease, registerActiveChatLease, type ChatLease } from "@/lib/chatLease";
import { codingModeReadiness } from "@/lib/codingMode";
import { swapToCodingMode } from "@/lib/codingModeSwap";
import { getStackClient } from "@/lib/stackEngine";
import { leaseQueueSignals, openMaxWindow, setChatLeaseSource, setChatTurnObserver } from "@/lib/jobs/householdQueue";

let lease: ChatLease | null = null;
let clock: () => number = Date.now;
/** Tests only: drop the running lease and use this clock for the next one. */
export function __resetChatLeaseForTests(now: () => number = Date.now): void { lease = null; clock = now; registerActiveChatLease(null); }
export function getChatLease(): ChatLease {
  lease ??= createChatLease({
    now: () => clock(),
    windowOpen: () => openMaxWindow() !== null,
    signals: (forPersonId) => leaseQueueSignals(forPersonId),
    ready: async () => (await codingModeReadiness()).ready,
    bigIsUp: async () => {
      const m = await getStackClient().getCodingMode();
      return m.state === "switching" || (m.mode === "coding" && m.target !== "normal");
    },
    swapToBig: async () => {
      const started = Date.now();
      // The Stack answers 202 and loads the big model in the background; wait for coding/stable before Home sends coding requests.
      await swapToCodingMode(getStackClient());
      recordTransition("max_load", Date.now() - started);
    },
    swapToStandard: () => getStackClient().setCodingMode("normal"),
  });
  registerActiveChatLease(lease);
  return lease;
}

/** Startup: the queue reads the lease, and a 5 second timer releases an idle one between requests. */
export function startChatLease(): void {
  registerActiveChatLease(getChatLease());
  setChatLeaseSource(() => getChatLease().holdsGenerators());
  // While the lease is up every chat turn answers on the big model: a turn in flight keeps the lease, and its end restarts the idle timer.
  setChatTurnObserver({
    // Only the holder's turns renew the grace; another person's turn on the big model still counts as in flight and is never cut off.
    started: (personId) => { if (getChatLease().snapshot().state === "held") getChatLease().requestStarted(personId); },
    ended: (personId) => { if (getChatLease().snapshot().state === "held") getChatLease().requestEnded(personId); },
  });
  let lastNote = 0;
  setInterval(() => {
    const l = getChatLease();
    void l.tick().catch((error) => { console.warn(`[chat-lease] tick failed: ${error instanceof Error ? error.message : "unknown"}`); });
    // One line a minute while the lease is up or a return is pending: counts and the policy reason only (no person ids), so a lease that does not end can be explained from the log.
    const now = Date.now();
    const snap = l.snapshot();
    if (snap.state !== "off" && now - lastNote >= 60_000) {
      lastNote = now;
      const d = l.decision();
      console.log(`[chat-lease] state=${snap.state} key=${snap.key} in_flight=${snap.inFlight} holder_jobs=${snap.holderJobs} waiters=${snap.waiters.count} pinned=${snap.pinned} decision=${d.action}:${d.reason} releases_in=${snap.releasesInSeconds ?? "never"}s`);
    }
  }, 5_000).unref();
}
