// PRIVACY-LEVEL-PROOF-01: the one answer to "may this class of data be saved for this chat". A persistence point calls mayRetain() with
// the chat's temporary flag and the speaker's band; it never decides from the flag alone. A minor never gets zero retention: the safety
// trail (tool audit rows and the refusal record) stays in a minor's temporary chat. Who may start a temporary chat is access.ts's
// canHaveTemporaryChat(); this file only decides what is kept once one exists.
export type RetentionClass = "memory" | "transcript" | "attachment" | "tool_audit" | "safety_trail";
export interface RetentionContext { temporary: boolean; band: "child" | "teen" | "adult" }

export function mayRetain(cls: RetentionClass, ctx: RetentionContext): boolean {
  if (!ctx.temporary) return true;
  // The safety trail is the one class a temporary chat keeps, and only for a minor. A tool audit row carries only a tool name and an
  // action word (rule 6a), so for a minor it is that trail; for an adult it is dropped like everything else.
  if (cls === "safety_trail" || cls === "tool_audit") return ctx.band !== "adult";
  return false;
}

export interface RetentionPoint {
  id: string;
  class: RetentionClass;
  /** The file that decides, by calling mayRetain, whether this class is saved for the chat. */
  guard: string;
  /** Every file under backend/src that inserts into a table of this class. A file not listed here fails the test. */
  writers: readonly string[];
}

export const RETENTION_POINTS: readonly RetentionPoint[] = [
  { id: "transcript", class: "transcript", guard: "lib/turnMachine/turnNext.ts", writers: ["lib/conversationHistory.ts", "lib/legacyImport.ts", "routes/devUi.ts"] },
  { id: "memory", class: "memory", guard: "lib/gate/decide.ts", writers: ["lib/memoryIngestion.ts"] },
  { id: "attachment", class: "attachment", guard: "lib/turnMachine/turnNext.ts", writers: ["lib/attachments.ts", "lib/media/fetchedFiles.ts"] },
  { id: "tool_audit", class: "tool_audit", guard: "lib/toolAudit.ts", writers: ["lib/toolAudit.ts"] },
];

/** The tables that hold chat-derived data. A new writer of any of these must be added to RETENTION_POINTS. */
export const RETENTION_TABLES = ["conversationTurns", "memoryRecords", "attachments", "toolAudit"] as const;
// Episodes, their embeddings and the rolling summary are derived only from stored turns, so a chat whose transcript is not kept has none
// to derive from; the transcript guard covers them.
