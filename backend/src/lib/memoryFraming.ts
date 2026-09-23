// CONTEXT-RECALL-01 (dev.md "The owner's three live turns on the new
// path", (2)): the volatile context message's own memory framing -
// moved out of turnEngine.ts (the old path's own home for these three
// lines) so nodes/messages.ts can wrap a recalled row in the identical
// wording, never a second, drifting copy. Why the framing exists at
// all: an unframed memory line reads as part of the question itself
// (the live miss this item fixes - a fresh conversation's small talk
// answered as if a remembered lookup were what was asked); wrapped
// under "what you already know", with a line telling the model to
// prefer these facts when relevant and a stated "nothing matched" when
// recall found nothing, a recalled row reads as background evidence
// the model may use, never as the turn's own subject.
export const MEMORY_SECTION_HEADER = "What you already know about this household:";
export const MEMORY_TRUST_REMINDER = "Prefer these facts over guessing when they're relevant.";
/** #93: the memory block's own line when recall found nothing relevant
 * (exported for the tests and the bench). */
export const NOTHING_STORED_LINE = "Nothing stored here bears on this message.";
