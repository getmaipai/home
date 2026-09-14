// Converts CCPE-M's own data.json (502 conversations eliciting movie
// preferences, one assistant asking, one user answering) into this
// directory's internal form. The dataset's own segment annotations
// (ENTITY_PREFERENCE, ENTITY_DESCRIPTION, ENTITY_NAME, ENTITY_OTHER) are
// the real signal mine.ts's preference rules read - kept alongside the
// conversation, the same "evidence kept beside, not folded in" choice
// LoCoMo's loader makes for its own qa evidence.
import type { DatasetConversation, DatasetTurn } from "./types";

interface RawAnnotation {
  annotationType: string;
}

interface RawSegment {
  text: string;
  annotations: RawAnnotation[];
}

interface RawUtterance {
  index: number;
  speaker: string;
  text: string;
  segments?: RawSegment[];
}

interface RawConversation {
  conversationId: string;
  utterances: RawUtterance[];
}

export interface CcpeAnnotationMention {
  turnId: string;
  annotationType: string;
}

export function loadCcpeM(raw: unknown[]): { conversations: DatasetConversation[]; annotations: CcpeAnnotationMention[] } {
  const conversations: DatasetConversation[] = [];
  const annotations: CcpeAnnotationMention[] = [];

  for (const entry of raw as RawConversation[]) {
    const turns: DatasetTurn[] = entry.utterances.map((u) => {
      const turnId = `${entry.conversationId}:${u.index}`;
      for (const segment of u.segments ?? []) {
        for (const a of segment.annotations) annotations.push({ turnId, annotationType: a.annotationType });
      }
      return { turnId, speaker: u.speaker, text: u.text, act: null, emotion: null, isEvidence: false };
    });
    conversations.push({
      id: `ccpe-m-${entry.conversationId}`,
      source: "ccpe-m",
      modality: "text",
      sessions: [{ sessionId: `ccpe-m-${entry.conversationId}-session`, timestamp: null, turns }],
    });
  }

  return { conversations, annotations };
}
