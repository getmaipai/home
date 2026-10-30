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
