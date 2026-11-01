// TIER-HOME-03: whether chat is running its Reduced (simpler) model while a Max window needs the room. The queue wiring (TIER-HOME-01) sets it
// when the Stack reports the swap and clears it when the window ends; the chat health row reads it so the line under the input shows for
// everyone and never holds Send (RULES.md S6: the one existing composer line, no banner). Counts and minutes only, never an app or person.
import type { ComposerNotice } from "@/lib/failureCopy";
import { JOB_QUEUE_COPY } from "@/lib/jobQueueCopy";

let reduced: { minutesLeft: number | null } | null = null;

export function setReducedChat(state: { minutesLeft: number | null } | null): void { reduced = state; }
export function reducedChatState(): { minutesLeft: number | null } | null { return reduced; }

/** TIER-HOME-03 (resource-tiers section 8): the line under the chat input while a Max window runs chat on its simpler model. Chat still answers, so this is shown beside a ready composer and never holds Send. */
export function reducedChatNotice(minutesLeft: number | null): ComposerNotice {
  const adult = minutesLeft === null ? JOB_QUEUE_COPY.reduced_chat.adult.replace(" (about N minutes)", "") : JOB_QUEUE_COPY.reduced_chat.adult.replace("N", String(Math.max(1, Math.round(minutesLeft))));
  return { adult, teen: adult, child: JOB_QUEUE_COPY.reduced_chat.child, repairs_link: null };
}

/** TIER-WIRE-02: how a request to the Stack's Reduced chat model came out. `waiting`: a chat turn is in flight, ask again at the next turn boundary. `unsupported`: an older Stack without the route. `failed`: refused, unreachable or an unreadable answer. */
export type ReducedSwitchResult = "ok" | "waiting" | "unsupported" | "failed";

let truth: { at: number; reduced: boolean } | null = null;
const TRUTH_TTL_MS = 3000;
export function resetReducedTruthForTests(): void { truth = null; }

async function switchReduced(on: boolean): Promise<ReducedSwitchResult> {
  try {
    const { getStackClient } = await import("@/lib/stackEngine");
    const client = getStackClient();
    if (!client.setReducedChat) return "unsupported";
    const answer = await client.setReducedChat(on);
    if (answer.state === "unsupported") return "unsupported";
    if (answer.state === "waiting") { truth = null; return "waiting"; }
    if (answer.state === "refused") { truth = null; return "failed"; }
    truth = { at: Date.now(), reduced: answer.reduced };
    return answer.reduced === on ? "ok" : "failed";
  } catch {
    truth = null;
    return "failed";
  }
}
/** Enter Reduced, or renew it (the Stack leaves Reduced by itself after 30 minutes without a renewing `{on:true}`). */
export const enterStackReducedChat = (): Promise<ReducedSwitchResult> => switchReduced(true);
export const leaveStackReducedChat = (): Promise<ReducedSwitchResult> => switchReduced(false);

/** Whether the Stack itself says chat runs its Reduced model (`reduced_chat` of GET /stack/v1/memory), read at most every few seconds. A Stack that cannot say, or does not answer, reads as not reduced, so the line never shows without the truth behind it. */
export async function stackReducedChat(): Promise<boolean> {
  if (truth && Date.now() - truth.at < TRUTH_TTL_MS) return truth.reduced;
  let reduced = false;
  try {
    const { getStackClient } = await import("@/lib/stackEngine");
    const body = await getStackClient().memory?.();
    reduced = body?.reduced_chat === true;
  } catch { reduced = false; }
  truth = { at: Date.now(), reduced };
  return reduced;
}
