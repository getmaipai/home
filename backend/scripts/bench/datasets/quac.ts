// Converts QuAC's own train/val JSON (one Wikipedia section's context
// per paragraph, a sequence of information-seeking questions and
// extracted-span answers over it) into this directory's internal form.
// One DatasetConversation per paragraph (its own qa id prefix, stripped
// of the trailing "_q#n"), one session, turns alternating a student
// turn (the question) and a teacher turn (the answer span, or the
// dataset's own "CANNOTANSWER" text when nothing in the context
// supports it). `followup`/`yesno` are QuAC's own per-question dialog
// tags, kept alongside rather than folded into DatasetTurn (which has
// no field for them) - the same "evidence kept beside" choice CCPE-M's
// and LoCoMo's loaders make for their own per-question labels.
import type { DatasetConversation, DatasetTurn } from "./types";

interface RawAnswer {
  text: string;
}

interface RawQa {
  id: string;
  question: string;
  followup: "y" | "n" | "m";
  yesno: "y" | "n" | "x";
  answers: RawAnswer[];
}

interface RawParagraph {
  context: string;
  qas: RawQa[];
}

interface RawEntry {
  paragraphs: RawParagraph[];
}

interface RawFile {
  data: RawEntry[];
}

export const CANNOTANSWER = "CANNOTANSWER";

export interface QuacQuestion {
  conversationId: string;
  qaId: string;
  followup: "y" | "n" | "m";
  yesno: "y" | "n" | "x";
  isUnanswerable: boolean;
}

const DIALOG_ID = /^(.+)_q#\d+$/;

export function loadQuac(raw: unknown): { conversations: DatasetConversation[]; questions: QuacQuestion[] } {
  const conversations: DatasetConversation[] = [];
  const questions: QuacQuestion[] = [];

  for (const entry of (raw as RawFile).data) {
    for (const paragraph of entry.paragraphs) {
      if (paragraph.qas.length === 0) continue;
      const match = DIALOG_ID.exec(paragraph.qas[0]!.id);
      const conversationId = `quac-${match ? match[1] : paragraph.qas[0]!.id}`;
      const turns: DatasetTurn[] = [];
      for (const qa of paragraph.qas) {
        const answerText = qa.answers[0]?.text ?? CANNOTANSWER;
        turns.push({ turnId: `${qa.id}-q`, speaker: "student", text: qa.question, act: null, emotion: null, isEvidence: false });
        turns.push({ turnId: `${qa.id}-a`, speaker: "teacher", text: answerText, act: null, emotion: null, isEvidence: answerText !== CANNOTANSWER });
        questions.push({ conversationId, qaId: qa.id, followup: qa.followup, yesno: qa.yesno, isUnanswerable: answerText === CANNOTANSWER });
      }
      conversations.push({ id: conversationId, source: "quac", modality: "text", sessions: [{ sessionId: `${conversationId}-session`, timestamp: null, turns }] });
    }
  }

  return { conversations, questions };
}
