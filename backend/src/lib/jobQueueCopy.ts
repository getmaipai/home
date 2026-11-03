export type JobQueueAudience = "adult" | "child";
export type JobQueueState = "queued" | "waiting_memory" | "started" | "paused_chat" | "never_fit" | "held_coding" | "failed_memory";
export type JobQueueKind = "picture" | "video" | "song";
export type JobQueueReason =
  | "queue" | "higher_class" | "other_person_first" | "class" | "aging" | "fair_share" | "boost" | "class_first" | "aging_first" | "fair_share_first" | "boost_first" | "moved_up" | "waiting_long"
  | "behind_chat" | "making_room" | "memory_elsewhere" | "requeued_memory" | "low_memory_failure" | "memory_stopped_failure" | "started"
  | "paused_chat" | "coding_mode" | "tier_ask" | "tier_no_room"
  | "quiet_wait" | "profile_lowered" | "cooldown_wait" | "reduced_chat" | "bigger_job_ahead" | "max_window" | "max_drain" | "max_hold" | "max_chat" | "heavy_slot" | "fairness_wait" | "picture_line" | "picture_engine" | "picture_memory" | "picture_paused_memory" | "picture_starting" | "still_running"
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
  class_first: { adult: "A faster kind of job goes first (pictures, then videos, then music).", child: "A quicker job goes first." },
  aging_first: { adult: "A job that has waited longer goes first.", child: "A job that waited longer goes first." },
  fair_share_first: { adult: "Ahead of you: a job from someone who has used less of the computer this hour.", child: "Someone who has not had a turn goes first." },
  boost_first: { adult: "An admin moved a job to the front.", child: "A job goes first." },
  class: { adult: "A faster kind of job goes first (pictures, then videos, then music).", child: "A quicker job goes first." },
  aging: { adult: "A job that has waited longer goes first.", child: "A job that waited longer goes first." },
  fair_share: { adult: "Ahead of you: a job from someone who has used less of the computer this hour.", child: "Someone who has not had a turn goes first." },
  boost: { adult: "An admin moved a job to the front.", child: "A job goes first." },
  moved_up: { adult: "You moved up in line.", child: "You are next." },
  waiting_long: {
    adult: "Still waiting. It starts by itself, or tap Cancel.",
    child: "Still waiting. It will start soon.",
  },
  behind_chat: {
    adult: "Waiting for chat to finish. Your job starts by itself after that.",
    child: "Waiting for the chat to finish, then it's your turn.",
  },
  making_room: {
    adult: "Waiting for its turn. It starts by itself, or tap Cancel.",
    child: "Waiting for its turn.",
  },
  memory_elsewhere: {
    adult: "Waiting for its turn. It starts by itself, or tap Cancel.",
    child: "Waiting for its turn. It starts by itself.",
  },
  // MEM-RETRY-01: the computer's watchdog stopped the job to keep chat working; Home starts it again by itself. No resource words for people.
  requeued_memory: {
    adult: "The computer got too busy, so your video stopped. It will start again by itself.",
    child: "The computer got busy. Your video will start again by itself.",
  },
  low_memory_failure: {
    adult: "The job stopped before it finished. Try again in a few minutes.",
    child: "The job stopped. Try again later.",
  },
  memory_stopped_failure: {
    adult: "The computer stayed too busy, so your video could not finish. Try again in a few minutes.",
    child: "The video could not finish. Try again later.",
  },
  started: { adult: "Starting.", child: "Starting now." },
  paused_chat: { adult: "Waiting for its turn.", child: "Waiting for its turn." },
  coding_mode: {
    adult: "Waiting for its turn. It starts by itself, or tap Cancel.",
    child: "Waiting for its turn.",
  },
  tier_ask: { adult: "It is not ready right now. Pick below.", child: "Waiting for a grown-up to say yes." },
  tier_no_room: { adult: "Waiting for its turn.", child: "Waiting for its turn." },
  quiet_wait: { adult: "Waiting for a quiet moment in chat.", child: "Waiting for a quiet moment." },
  profile_lowered: { adult: "Waiting for another job to finish. It starts by itself, or tap Cancel.", child: "Waiting for another job to finish." },
  cooldown_wait: { adult: "Chat just returned to normal. Your job starts in a few minutes, or tap Cancel.", child: "Your job starts in a few minutes." },
  reduced_chat: { adult: "Answers are shorter for now (about N minutes). Everything comes back after.", child: "Chat is a little simpler for a few minutes." },
  bigger_job_ahead: {
    adult: "Another job is running. Yours is number N (about M minutes).",
    child: "Another job is running. You are number N.",
  },
  max_window: {
    adult: "Home is running a Max job and will be back to normal in about N minutes. Yours starts after it.",
    child: "Waiting for its turn. Yours starts after.",
  },
  max_chat: {
    adult: "Someone is using Max chat, so other jobs wait. Yours starts by itself when they are done, or tap Cancel.",
    child: "Waiting for its turn. Yours starts after.",
  },
  max_drain: {
    adult: "Max starts when the jobs ahead finish (about N minutes). New jobs wait behind it.",
    child: "Waiting for its turn. Yours starts after.",
  },
  // MAX-WAIT-REASON-01: the Max job's own wait when nothing is running ahead of it and the computer is still busy. No resource words for people.
  max_hold: {
    adult: "Waiting for the computer to finish other work. Your video starts by itself, or tap Cancel.",
    child: "Waiting for its turn.",
  },
  heavy_slot: { adult: "Another job is running; this one starts when it finishes.", child: "Another job is running. Yours starts when it finishes." },
  fairness_wait: { adult: "Other people's jobs go first this round; this one is next.", child: "Other people's jobs go first this round. Yours is next." },
  picture_line: { adult: "Waiting in line, number N", child: "Waiting in line, number N" },
  picture_engine: { adult: "Waiting for its turn", child: "Waiting for its turn" },
  picture_memory: { adult: "Waiting for its turn", child: "Waiting for its turn" },
  picture_paused_memory: { adult: "Waiting for its turn", child: "Waiting for its turn" },
  picture_starting: { adult: "Getting the picture ready", child: "Getting the picture ready" },
  still_running: { adult: "Still running, about N minutes more.", child: "Still running. It will be done soon." },
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
    const adult = `This ${words.adult} can't be made here right now. Try ${words.alternative}, or ask an admin.`;
    const child = `This computer can't make ${words.child}. Try ${reason.job === "video" ? "a picture" : reason.job === "song" ? "a shorter song" : "again later"} instead.`;
    return audience === "adult" ? adult : child;
  }

  const line = JOB_QUEUE_COPY[reason][audience];
  if (reason === "bigger_job_ahead") {
    const number = position === null ? "" : String(position);
    const minutes = typeof estimateSeconds === "number" && Number.isFinite(estimateSeconds) ? String(Math.max(1, Math.round(estimateSeconds / 60))) : null;
    if (audience === "child") return line.replace("N", number);
    return line.replace("N", number).replace(minutes === null ? / \(about M minutes\)/ : "M", minutes === null ? "" : minutes);
  }
  if (reason === "reduced_chat" && audience === "adult") {
    if (typeof estimateSeconds !== "number" || !Number.isFinite(estimateSeconds)) return line.replace(" (about N minutes)", "");
    return line.replace("N", String(Math.max(1, Math.round(estimateSeconds / 60))));
  }
  if (reason === "max_window" && audience === "adult") {
    if (typeof estimateSeconds !== "number" || !Number.isFinite(estimateSeconds)) return line.replace(" in about N minutes", "");
    return line.replace("N", String(Math.max(1, Math.round(estimateSeconds / 60))));
  }
  if (reason === "max_drain" && audience === "adult") {
    if (typeof estimateSeconds !== "number" || !Number.isFinite(estimateSeconds)) return line.replace(" (about N minutes)", "");
    return line.replace("N", String(Math.max(1, Math.round(estimateSeconds / 60))));
  }
  if (reason === "still_running" && audience === "adult") {
    if (typeof estimateSeconds !== "number" || !Number.isFinite(estimateSeconds)) return "Still running.";
    return line.replace("N", String(Math.max(1, Math.round(estimateSeconds / 60))));
  }
  if (state === "queued" && reason === "queue") {
    if (position === 1) return audience === "adult" && Number.isFinite(estimateSeconds) ? `${line} It starts when the job ahead finishes (${estimateText(estimateSeconds!)}).` : line;
    if (position !== null && position > 1) {
      if (audience === "child") return `You are number ${position}. ${position - 1} more, then yours.`;
      const estimate = typeof estimateSeconds === "number" && Number.isFinite(estimateSeconds) ? ` (${estimateText(estimateSeconds)})` : "";
      return `You are number ${position} in line${estimate}.`;
    }
  }
  if (state === "queued" && (reason === "higher_class" || reason === "other_person_first" || reason === "class" || reason === "aging" || reason === "fair_share" || reason === "boost" || reason === "class_first" || reason === "aging_first" || reason === "fair_share_first" || reason === "boost_first")) {
    const number = position === 1 ? "You are next." : position !== null ? `You are number ${position} now.` : "";
    if (audience === "adult") return `${number} ${line}`.trim();
    return `${line}${number ? ` ${number}` : ""}`;
  }
  if (state === "queued" && reason === "moved_up") return position === 1 ? JOB_QUEUE_COPY.queue[audience] : `${line}${position === null ? "" : ` You are number ${position} now.`}`;
  if (state === "waiting_memory" && reason === "making_room" && audience === "adult" && typeof estimateSeconds === "number" && Number.isFinite(estimateSeconds)) {
    return `${line} (${estimateText(estimateSeconds)}).`;
  }
  if (state === "started" && reason === "started" && typeof estimateSeconds === "number" && Number.isFinite(estimateSeconds)) {
    return audience === "adult" ? `${line} Getting ready (${estimateText(estimateSeconds)}).` : line;
  }
  return line;
}


/** MAX-LIVE-02: the Stack names a worker stopped while chat answers "Paused while chat is working"; a person is shown the card's ordinary waiting words, never "paused" (owner rule on resource wording). Any other stage text passes through. */
export function plainStageLabel(label: string | null | undefined, audience: "adult" | "child" = "adult"): string | null {
  if (typeof label !== "string") return null;
  return /^paused\b/i.test(label.trim()) ? jobQueueCopy("paused_chat", "paused_chat", null, null, audience) : label;
}
