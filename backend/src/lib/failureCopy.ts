// THIN-DL-02: the one table of failure wording, with no imports so any module
// may read it. Kinds and the classifier live in generationFailure.ts.
export type FailureKind = "busy" | "memory" | "slow" | "unreachable" | "context_too_large" | "other";

interface FailureCopy {
  adult: string;
  minor: string;
}

/** One table, one place. A minor's wording is short and kind. */
export const FAILURE_COPY: Record<FailureKind, FailureCopy> = {
  busy: {
    adult: "The AI is still starting up or busy with something else. Give it a moment, then send that again.",
    minor: "I'm still waking up. Try again in a moment.",
  },
  memory: {
    adult: "The AI couldn't start because the computer is low on memory. Close something big if you can, then try again in a moment.",
    minor: "I can't wake up all the way right now. Try again soon.",
  },
  slow: {
    adult: "That took too long, so the AI stopped answering. Send it again, or try a shorter question.",
    minor: "That took me too long. Try asking again.",
  },
  unreachable: {
    adult: "I can't reach the AI on this computer. Check that MaiPai's AI is running, then send that again.",
    minor: "I can't get to my thinking part right now. Please tell a grown-up.",
  },
  context_too_large: {
    adult: "That was too much text for me to read in one go. Try a shorter question.",
    minor: "That was too much for me to read at once. Try a shorter question.",
  },
  other: {
    adult: "Something went wrong while I was writing that. Send it again, and if it keeps happening, check Repairs.",
    minor: "Something went wrong. Try asking again.",
  },
};

export function failureLine(kind: FailureKind, minor: boolean): string {
  return minor ? FAILURE_COPY[kind].minor : FAILURE_COPY[kind].adult;
}

/** The closing note after a reply that was cut off with some text already
 * on screen. The person keeps what was written; this says it stopped. */
export function partialReplyNote(kind: FailureKind, minor: boolean): string {
  if (minor) return "I had to stop there. Ask me again if you want the rest.";
  return kind === "slow" ? "I had to stop there because the AI stopped answering. Ask me to continue if you want the rest." : "I had to stop there because the AI stopped working. Ask me to continue if you want the rest.";
}
