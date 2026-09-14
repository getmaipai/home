// Lane 12 item 4 (docs/plans/session-b-lane-12-2026-09-13.md): EVAL-07's
// dataset half. One internal form every loader in this directory targets,
// so Session A's own replay (the engine half, later) consumes one shape
// regardless of which public dataset it came from - the same "one
// definition, one place" reasoning the spec migration (SPEC-01) already
// applies to the household's own records. Not a spec/ schema: these
// datasets and their derived form never leave this machine (research
// licenses, never shipped), so there is nothing here the robot needs to
// agree with the hub about.

/** One turn in a session, in the dataset's own words - never rewritten,
 * never translated, never summarized. `turnId` is the dataset's own
 * reference when it has one (LoCoMo's "D1:3"), so a question's evidence
 * list resolves back to an exact turn without re-deriving an index. */
export interface DatasetTurn {
  turnId: string | null;
  speaker: string;
  text: string;
  /** DailyDialog's own numeric act label (1 inform, 2 question, 3
   * directive, 4 commissive - dev.md section 12's own DailyDialog
   * mapping). Null where the dataset carries no act label. */
  act: number | null;
  /** DailyDialog's own numeric emotion label (0 neutral, 1 anger, 2
   * disgust, 3 fear, 4 happiness, 5 sadness, 6 surprise). Null where the
   * dataset carries no emotion label. */
  emotion: number | null;
  /** LongMemEval's own has_answer flag: this turn is cited evidence for
   * at least one question over this session. Never inferred, only
   * copied. */
  isEvidence: boolean;
}

/** One session (a dated slice of the conversation). `timestamp` is the
 * dataset's own date string, kept exactly as given - LongMemEval and
 * LoCoMo use different formats, and normalizing them is a job for
 * whichever loader eventually seeds a household clock from this, not
 * this shape. */
export interface DatasetSession {
  sessionId: string;
  timestamp: string | null;
  turns: DatasetTurn[];
}

// Lane 13 item 1 (docs/plans/session-b-lane-13-2026-09-14.md): widened
// for the phenomenon-mining sources (mine.ts), which read Taskmaster-1,
// CCPE-M and QuAC through the same internal form rather than a fourth
// shape.
export type DatasetSource = "longmemeval" | "locomo" | "dailydialog" | "taskmaster1" | "ccpe-m" | "quac";

/** One conversation: LongMemEval's is one question's own haystack (id =
 * that question's id, since each question gets its own distinct set of
 * sessions); LoCoMo's is one of the ten released two-person histories
 * (id = its own sample_id, shared by ~200 questions); DailyDialog's is
 * one short dialogue (id assigned by the loader, since the raw files
 * carry none - `dailydialog-<split>-<line index>`). */
export interface DatasetConversation {
  id: string;
  source: DatasetSource;
  modality: "text";
  sessions: DatasetSession[];
}

/** LongMemEval's own question record, kept alongside its conversation
 * rather than folded into it - the question is graded, the conversation
 * is what it's graded against, and a fixed sample (sample.ts) selects
 * questions, not conversations. */
export interface LongMemEvalQuestion {
  questionId: string;
  /** The six types the cleaned release ships: single-session-user,
   * single-session-assistant, single-session-preference, multi-session,
   * temporal-reasoning, knowledge-update. */
  questionType: string;
  /** LongMemEval's own convention: an abstention case's question_id
   * carries an "_abs" suffix and its answer states nothing was
   * mentioned. Read once here so nothing downstream re-parses the id. */
  isAbstention: boolean;
  question: string;
  answer: string;
  questionDate: string | null;
  conversationId: string;
  answerSessionIds: string[];
}

/** LoCoMo's own qa record. `category` is the paper's own numbering (1
 * single-hop, 2 multi-hop, 3 temporal, 4 open-domain, 5 adversarial);
 * category 5 carries `adversarialAnswer` instead of a real `answer` -
 * the correct reply is that nothing supports the premise, not the
 * adversarial answer text itself (LoCoMo's own eval treats a model
 * repeating it back as the failure case). */
export interface LocomoQuestion {
  conversationId: string;
  question: string;
  answer: string | null;
  adversarialAnswer: string | null;
  category: 1 | 2 | 3 | 4 | 5;
  evidenceTurnIds: string[];
}
