// Converts LongMemEval-cleaned's own JSON (either the S or the oracle
// release - identical per-record shape, the oracle file just carries far
// fewer distractor sessions per question) into this directory's internal
// form. One DatasetConversation per question: LongMemEval gives each
// question its own distinct haystack, never a haystack shared across
// questions, so the question's own id is the natural conversation id.
import type { DatasetConversation, DatasetSession, DatasetTurn, LongMemEvalQuestion } from "./types";

interface RawTurn {
  role: string;
  content: string;
  has_answer?: boolean;
}

interface RawQuestion {
  question_id: string;
  question_type: string;
  question: string;
  answer: string;
  question_date?: string | null;
  haystack_dates: string[];
  haystack_session_ids: string[];
  haystack_sessions: RawTurn[][];
  answer_session_ids?: string[];
}

// LongMemEval's own convention (found live against the actual release,
// 2026-09-14): an abstention question's id carries this suffix, and its
// answer states nothing was mentioned. Never inferred from the answer
// text - the id is the dataset's own explicit marker.
const ABSTENTION_SUFFIX = "_abs";

export function loadLongMemEval(raw: unknown[]): { conversations: DatasetConversation[]; questions: LongMemEvalQuestion[] } {
  const conversations: DatasetConversation[] = [];
  const questions: LongMemEvalQuestion[] = [];

  for (const entry of raw as RawQuestion[]) {
    const sessions: DatasetSession[] = entry.haystack_sessions.map((turns, sessionIndex) => {
      const sessionId = entry.haystack_session_ids[sessionIndex] ?? `session-${sessionIndex}`;
      const timestamp = entry.haystack_dates[sessionIndex] ?? null;
      const datasetTurns: DatasetTurn[] = turns.map((turn, turnIndex) => ({
        turnId: `${sessionId}:${turnIndex}`,
        speaker: turn.role,
        text: turn.content,
        act: null,
        emotion: null,
        isEvidence: turn.has_answer === true,
      }));
      return { sessionId, timestamp, turns: datasetTurns };
    });

    conversations.push({ id: entry.question_id, source: "longmemeval", modality: "text", sessions });

    questions.push({
      questionId: entry.question_id,
      questionType: entry.question_type,
      isAbstention: entry.question_id.includes(ABSTENTION_SUFFIX),
      question: entry.question,
      answer: entry.answer,
      questionDate: entry.question_date ?? null,
      conversationId: entry.question_id,
      answerSessionIds: entry.answer_session_ids ?? [],
    });
  }

  return { conversations, questions };
}
