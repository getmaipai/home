// Converts Taskmaster-1's own conversation-per-file JSON (self-dialogs.json,
// written straight by a person playing both sides; woz-dialogs.json, a
// wizard-of-Oz collection between two people, closer to a real spoken
// request) into this directory's internal form. Both files share one
// shape (conversation_id, utterances[]); `variant` only changes the
// dataset id this loader stamps on each conversation so mine.ts can pick
// self-dialogs' slot corrections apart from woz-dialogs' more natural
// requests without a second loader.
import type { DatasetConversation, DatasetTurn } from "./types";

interface RawSegmentAnnotation {
  name: string;
}

interface RawSegment {
  text: string;
  annotations: RawSegmentAnnotation[];
}

interface RawUtterance {
  index: number;
  speaker: string;
  text: string;
  segments?: RawSegment[];
}

interface RawConversation {
  conversation_id: string;
  instruction_id: string;
  utterances: RawUtterance[];
}

/** Every slot annotation name a turn's own segments carry (Taskmaster's
 * dotted convention, e.g. "restaurant_reservation.location.restaurant.accept"),
 * kept as plain strings rather than parsed further - mine.ts's own rules
 * read them as opaque labels, never derive meaning from the dots. */
export function taskmaster1SlotNames(raw: RawConversation, utteranceIndex: number): string[] {
  const segments = raw.utterances[utteranceIndex]?.segments ?? [];
  return segments.flatMap((s) => s.annotations.map((a) => a.name));
}

export function loadTaskmaster1(raw: unknown[], variant: "self" | "woz"): { conversations: DatasetConversation[]; slotNamesByTurn: Map<string, string[]> } {
  const conversations: DatasetConversation[] = [];
  const slotNamesByTurn = new Map<string, string[]>();

  for (const entry of raw as RawConversation[]) {
    const turns: DatasetTurn[] = entry.utterances.map((u) => {
      const turnId = `${entry.conversation_id}:${u.index}`;
      const slots = taskmaster1SlotNames(entry, u.index);
      if (slots.length > 0) slotNamesByTurn.set(turnId, slots);
      return { turnId, speaker: u.speaker, text: u.text, act: null, emotion: null, isEvidence: false };
    });
    conversations.push({
      id: `taskmaster1-${variant}-${entry.conversation_id}`,
      source: "taskmaster1",
      modality: "text",
      sessions: [{ sessionId: `taskmaster1-${variant}-${entry.conversation_id}-session`, timestamp: null, turns }],
    });
  }

  return { conversations, slotNamesByTurn };
}
