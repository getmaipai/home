// Converts LoCoMo's own locomo10.json (ten released two-person
// conversations, up to 35 dated sessions each) into this directory's
// internal form. One DatasetConversation per sample_id, shared by every
// one of that conversation's own qa questions - unlike LongMemEval,
// where each question gets its own distinct haystack.
import type { DatasetConversation, DatasetSession, DatasetTurn, LocomoQuestion } from "./types";

interface RawTurn {
  speaker: string;
  dia_id: string;
  text: string;
}

interface RawQa {
  question: string;
  answer?: string;
  adversarial_answer?: string;
  evidence?: string[];
  category: 1 | 2 | 3 | 4 | 5;
}

interface RawConversation {
  sample_id: string;
  conversation: Record<string, unknown>;
  qa: RawQa[];
}

// The conversation object's own shape: `speaker_a`, `speaker_b`, then
// `session_<n>` (an array of turns) and `session_<n>_date_time` (a
// string) for as many sessions as that conversation has - found live
// against the actual release, 2026-09-14, not documented anywhere
// formal enough to import a type from.
function sessionNumbers(conversation: Record<string, unknown>): number[] {
  const numbers: number[] = [];
  for (const key of Object.keys(conversation)) {
    const match = /^session_(\d+)$/.exec(key);
    if (match) numbers.push(Number(match[1]));
  }
  return numbers.sort((a, b) => a - b);
}

export function loadLocomo(raw: unknown[]): { conversations: DatasetConversation[]; questions: LocomoQuestion[] } {
  const conversations: DatasetConversation[] = [];
  const questions: LocomoQuestion[] = [];

  for (const entry of raw as RawConversation[]) {
    const conversationId = entry.sample_id;
    const sessions: DatasetSession[] = sessionNumbers(entry.conversation).map((n) => {
      const rawTurns = entry.conversation[`session_${n}`] as RawTurn[];
      const timestamp = (entry.conversation[`session_${n}_date_time`] as string | undefined) ?? null;
      const turns: DatasetTurn[] = rawTurns.map((turn) => ({
        turnId: turn.dia_id,
        speaker: turn.speaker,
        text: turn.text,
        act: null,
        emotion: null,
        isEvidence: false, // set below, once we know which dia_ids are cited
      }));
      return { sessionId: `session_${n}`, timestamp, turns };
    });

    // Evidence is per-question in LoCoMo (each qa row cites its own
    // dia_ids), not a fixed property of a turn the way LongMemEval's
    // has_answer is - a turn can be evidence for one question and not
    // another. Marked true on the conversation's own turns here so a
    // reader of the conversation alone can still see every dia_id any
    // question in this file ever cited, same "the dataset's own labels
    // kept" rule as LongMemEval's loader, applied to LoCoMo's own shape.
    const citedIds = new Set(entry.qa.flatMap((qa) => qa.evidence ?? []));
    for (const session of sessions) {
      for (const turn of session.turns) {
        if (turn.turnId && citedIds.has(turn.turnId)) turn.isEvidence = true;
      }
    }

    conversations.push({ id: conversationId, source: "locomo", modality: "text", sessions });

    for (const qa of entry.qa) {
      questions.push({
        conversationId,
        question: qa.question,
        answer: qa.answer ?? null,
        adversarialAnswer: qa.adversarial_answer ?? null,
        category: qa.category,
        evidenceTurnIds: qa.evidence ?? [],
      });
    }
  }

  return { conversations, questions };
}
