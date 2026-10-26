export type JobQueueAudience = "adult" | "child";
export type JobQueueState = "queued" | "waiting_memory" | "started" | "paused_chat" | "never_fit" | "held_coding" | "failed_memory";
export type JobQueueKind = "picture" | "video" | "song";
export type JobQueueReason =
  | "queue" | "higher_class" | "other_person_first" | "moved_up" | "waiting_long"
  | "behind_chat" | "making_room" | "memory_elsewhere" | "requeued_memory" | "low_memory_failure" | "started"
  | "paused_chat" | "coding_mode" | "awaiting_approval"
  | { kind: "never_fit"; job: JobQueueKind; neededGb: number; availableGb: number; smallerOption?: string };

type Pair = { adult: string; child: string };

/** The one source for the words shown on queued and waiting job cards. */
export const JOB_QUEUE_COPY: Record<Exclude<JobQueueReason, { kind: "never_fit" }>, Pair> = {
  queue: { adult: "You are next.", child: "You are next." },
  higher_class: {
    adult: "A picture from someone else goes first because pictures are quick.",
    child: "Someone's quick picture goes first.",
  },
  other_person_first: {
    adult: "Someone else's job goes first because they have waited longer.",
    child: "Someone else's job goes first because they have waited longer.",
  },
  moved_up: { adult: "You moved up in line.", child: "You are next." },
  waiting_long: {
    adult: "Still waiting. It starts when the computer is free, or tap Cancel.",
    child: "Still waiting. It will start soon.",
  },
  behind_chat: {
    adult: "Waiting for chat to finish. Your job starts by itself after that.",
    child: "Waiting for the chat to finish, then it's your turn.",
  },
  making_room: {
    adult: "Waiting for memory. Home is putting away another model.",
    child: "Making room.",
  },
  memory_elsewhere: {
    adult: "Waiting for memory. Something else on this computer is using it. Your job starts as soon as there is room, or tap Cancel.",
    child: "The computer is full right now. Your job starts when there is room.",
  },
  requeued_memory: {
    adult: "The computer ran low on memory, so your job will start again from the beginning when there is room. Nothing to do.",
    child: "The computer got too full. Your job will start again soon.",
  },
  low_memory_failure: {
    adult: "The computer ran low on memory, so the job stopped. Try again when there is room.",
    child: "The computer ran low on memory, so the job stopped. Try again later.",
  },
  started: { adult: "Starting.", child: "Starting now." },
  // PERUSE-2026-10-25: a picture or video held for the pictured adult's yes. Only adults ever see it (a child cannot make one).
  awaiting_approval: { adult: "Waiting for the person pictured to say yes. It starts as soon as they do.", child: "Waiting for a yes. It starts as soon as there is one." },
  paused_chat: { adult: "Paused while chat is working.", child: "Paused while chat is working." },
  coding_mode: {
    adult: "Home is in coding mode. Your job starts by itself when it is back to normal, or tap Cancel.",
    child: "Home is busy with a big job. Your job starts when it is done.",
  },
};

function estimateText(seconds: number): string {
  const rounded = Math.max(1, Math.round(seconds));
  if (rounded < 60) return `about ${rounded} ${rounded === 1 ? "second" : "seconds"}`;
  const minutes = Math.max(1, Math.round(rounded / 60));
  return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function kindWords(kind: JobQueueKind): { adult: string; child: string; alternative: string } {
  if (kind === "picture") return { adult: "picture", child: "pictures", alternative: "a smaller picture" };
  if (kind === "song") return { adult: "song", child: "songs", alternative: "a shorter song" };
  return { adult: "video", child: "videos", alternative: "a shorter clip" };
}

/** Pure copy lookup. Estimates are approximate and only appear when supplied as a finite number. */
export function jobQueueCopy(
  state: JobQueueState,
  reason: JobQueueReason,
  position: number | null,
  estimateSeconds: number | null,
  audience: JobQueueAudience,
): string {
  if (typeof reason === "object") {
    const words = kindWords(reason.job);
    const adult = `This ${words.adult} needs about ${reason.neededGb} GB of memory and this computer has ${reason.availableGb} GB for pictures and videos after chat. ${reason.smallerOption ?? words.alternative}, or ask an admin to change the memory settings.`;
    const child = `This computer can't make ${words.child}. Try ${reason.job === "video" ? "a picture" : reason.job === "song" ? "a shorter song" : "again later"} instead.`;
    return audience === "adult" ? adult : child;
  }

  const line = JOB_QUEUE_COPY[reason][audience];
  if (state === "queued" && reason === "queue") {
    if (position === 1) return audience === "adult" && Number.isFinite(estimateSeconds) ? `${line} It starts when the job ahead finishes (${estimateText(estimateSeconds!)}).` : line;
    if (position !== null && position > 1) {
      if (audience === "child") return `You are number ${position}. ${position - 1} more, then yours.`;
      const estimate = typeof estimateSeconds === "number" && Number.isFinite(estimateSeconds) ? ` (${estimateText(estimateSeconds)})` : "";
      return `You are number ${position} in line${estimate}.`;
    }
  }
  if (state === "queued" && (reason === "higher_class" || reason === "other_person_first")) {
    const number = position === 1 ? "You are next." : position !== null ? `You are number ${position} now.` : "";
    if (audience === "adult") return `${number} ${line}`.trim();
    return `${line}${number ? ` ${number}` : ""}`;
  }
  if (state === "queued" && reason === "moved_up") return position === 1 ? JOB_QUEUE_COPY.queue[audience] : `${line}${position === null ? "" : ` You are number ${position} now.`}`;
  if (state === "waiting_memory" && reason === "making_room" && audience === "adult" && typeof estimateSeconds === "number" && Number.isFinite(estimateSeconds)) {
    return `${line} (${estimateText(estimateSeconds)}).`;
  }
  if (state === "started" && reason === "started" && typeof estimateSeconds === "number" && Number.isFinite(estimateSeconds)) {
    return audience === "adult" ? `${line} Loading the model (${estimateText(estimateSeconds)}).` : line;
  }
  return line;
}

