// CHAT-LATE-SYSTEM-01: the one place that guarantees a request to the chat
// engine carries at most one system message, and that it is first.
//
// Producers (conversationHistory.ts) now attach their notes at the source,
// so this is the safety net that keeps the class closed.
//
// Why: the engine's Qwen3.5 chat template raises "System message must be at
// the beginning" (HTTP 500, before any streaming) when a system-role message
// sits anywhere but index 0. Home's history window renders notes about an
// earlier turn (a search stub, a guarded reply, a package answer, a picture
// that could not be read) as system-role messages between turns, so any turn
// whose window held one failed. The producers keep emitting notes in their
// own role; this normalizer runs at the two boundaries that talk to the
// engine (llm.ts chatRequestBody, tokenCount.ts) so no producer can bring
// the failure back.
//
// Meaning is kept: every note's text is carried verbatim, labelled as a
// note for the model and not the person's words, so it is still read in
// nobody's voice (item 1b of the history renderer). No note is dropped.
import type { LlmMessage } from "@/lib/llm";

export const FOLDED_NOTE_LABEL = "Note for you, not written by the person:";

export function foldedBlock(text: string): string {
  return `${FOLDED_NOTE_LABEL}\n${text}`;
}

let warned = false;

/** Returns `messages` with at most one system message, at index 0.
 * Leading system messages merge into one (blank-line joined). A later
 * system message is folded into the user message just before it, else the
 * next user message after it, else the leading system message (and when
 * the list has no leading system message, one is created from it). Input
 * is never mutated; a list already in shape is returned as is. */
export function foldLateSystemMessages(messages: readonly LlmMessage[]): LlmMessage[] {
  let lead = 0;
  while (lead < messages.length && messages[lead]!.role === "system") lead++;
  const late = messages.slice(lead).some((m) => m.role === "system");
  if (!late && lead <= 1) return messages as LlmMessage[];
  // A producer still sends a late system message: it is folded, and said once
  // per process so the producer can be found and fixed at its source.
  if (late && !warned) {
    warned = true;
    console.warn("[systemFold] a system message arrived after the first message and was folded into the conversation as a note; the producer should attach it to its turn");
  }

  const rest: LlmMessage[] = messages.slice(lead).map((m) => ({ ...m }));
  const leadText: string[] = messages.slice(0, lead).map((m) => m.content);
  const keep: LlmMessage[] = [];
  const notes: Array<{ at: number; text: string }> = [];
  for (const m of rest) {
    if (m.role === "system") notes.push({ at: keep.length, text: m.content });
    else keep.push(m);
  }
  for (const note of notes) {
    // `note.at` is the count of kept messages ahead of the note.
    const prev = note.at - 1;
    if (prev >= 0 && keep[prev]!.role === "user") {
      keep[prev] = { ...keep[prev]!, content: `${keep[prev]!.content}\n\n${foldedBlock(note.text)}` };
      continue;
    }
    let next = note.at;
    while (next < keep.length && keep[next]!.role !== "user") next++;
    if (next < keep.length) {
      keep[next] = { ...keep[next]!, content: `${foldedBlock(note.text)}\n\n${keep[next]!.content}` };
      continue;
    }
    leadText.push(note.text);
  }
  return leadText.length > 0 ? [{ role: "system", content: leadText.join("\n\n") }, ...keep] : keep;
}
