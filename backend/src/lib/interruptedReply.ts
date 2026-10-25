// DUPLEX-06 (docs/design/full-duplex-voice-2026-10-24.md): when a spoken reply is cut in on, the part Home had released but the person
// did not hear is kept for the NEXT turn of that conversation only, so Home can answer what was said and then pick the story back up.
// Memory only, never stored and never logged (rule 6a: the stored reply stays the heard prefix, owner's rule 2026-10-14). The text
// already passed the output gate when it was released, and it reaches the model as labelled background, like robot vision's look.

const MAX_REMAINDER_CHARS = 1200;
const MIN_REMAINDER_CHARS = 20;
const EXPIRES_MS = 10 * 60_000;

interface Interrupted {
  personId: string;
  remainder: string;
  at: number;
  /** The turn that read it: the turn machine builds its context more than once per turn, so the same turn reads it again; any other turn does not. */
  readBy?: string;
}

const pending = new Map<string, Interrupted>();

/** Remember the unheard part of a released reply for the next turn of this conversation. A tiny remainder is not worth carrying. */
export function noteInterruptedReply(conversationId: string, personId: string, released: string, heardPrefix: string, now = Date.now()): void {
  const remainder = released.slice(heardPrefix.length).trim();
  if (remainder.length < MIN_REMAINDER_CHARS) {
    pending.delete(conversationId);
    return;
  }
  pending.set(conversationId, { personId, remainder: remainder.slice(0, MAX_REMAINDER_CHARS), at: now });
}

/** The unheard part of the last interrupted reply, for ONE turn: the first turn to ask owns it and may ask again (its context is built
 * more than once); a later turn gets nothing. Null when none, another person's, or too old. */
export function takeInterruptedReply(conversationId: string, personId: string, turnId: string, now = Date.now()): string | null {
  const entry = pending.get(conversationId);
  if (!entry) return null;
  if (entry.personId !== personId || now - entry.at > EXPIRES_MS) {
    pending.delete(conversationId);
    return null;
  }
  if (entry.readBy === undefined) entry.readBy = turnId;
  if (entry.readBy !== turnId) {
    pending.delete(conversationId);
    return null;
  }
  return entry.remainder;
}

export function __clearInterruptedRepliesForTests(): void {
  pending.clear();
}
