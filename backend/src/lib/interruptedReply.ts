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

/** The unheard part of the last interrupted reply, once: taking it removes it. Null when none, another person's, or too old. */
export function takeInterruptedReply(conversationId: string, personId: string, now = Date.now()): string | null {
  const entry = pending.get(conversationId);
  if (!entry) return null;
  pending.delete(conversationId);
  if (entry.personId !== personId || now - entry.at > EXPIRES_MS) return null;
  return entry.remainder;
}

export function __clearInterruptedRepliesForTests(): void {
  pending.clear();
}
