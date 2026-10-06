// THIN-3G (rule 4): when a written reply offers a new chat that carries
// this chat's summary forward (the turn's `carry_offer`), the next new
// chat the person starts with the kit's own New chat action is created
// with `carry_from` set to that chat. Data only: the offer is the reply's
// text and the action is the shipped thread list's, never a new component.
let pending: string | null = null;

/** A reply offered the carry: remember which chat it came from. */
export function offerCarry(conversationId: string): void {
  pending = conversationId;
}

/** Any later reply without the offer withdraws it, in whatever chat (a
 * review: an ignored offer must not seed an unrelated new chat). */
export function withdrawCarry(): void {
  pending = null;
}

/** Opening a different saved chat withdraws the offer too: only a New chat
 * started from the offering chat carries its summary. */
export function openedChat(conversationId: string): void {
  if (pending !== null && pending !== conversationId) pending = null;
}

/** The chat a new chat should carry from, taken once. */
export function takeCarry(): string | null {
  const id = pending;
  pending = null;
  return id;
}
