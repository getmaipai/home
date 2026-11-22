// TIER-LEASE-04: the words of the shared tier-lease notice line (docs/design/tier-lease-2026-11-22.md section 5). One short sentence (CHAT-NOTICE-SHORT-01), an adult
// and a child form, and the actions the line offers as codes (the page words the buttons). Rule 6a: kinds and counts only, never a person, a title or an id.
// Pure functions: the route passes facts in, this file picks a code and its words, as jobQueueCopy.ts does for the queue.

export type TierLeaseNoticeCode =
  | "holder_idle" // Holder, nothing waits: the lease ends when they stop.
  | "holder_waiting" // Holder, something waits: it runs after this step.
  | "paused" // A paused coding session: it holds nothing.
  | "released" // The lease was handed over while idle.
  | "waiter" // Someone else holds the tier and this person waits.
  | "waiter_pinned"; // The same, behind a pinned lease for 10 minutes or more.

export type TierLeaseActionCode = "keep" | "lower" | "pause" | "resume" | "standard_now";

export interface TierLeaseNotice {
  code: TierLeaseNoticeCode;
  adult: string;
  child: string;
  /** The long explanation, the line's tooltip only. */
  more: string;
  actions: TierLeaseActionCode[];
}

export interface TierLeaseCopyInput {
  /** The lease key the line is for: pause exists for coding only. */
  key: "chat" | "coding";
  /** What waits for the lease (counts and kinds only). */
  waiters: { count: number; kinds: string[] };
  /** Seconds until the holder's step ends, when the queue knows. */
  etaSeconds?: number | null;
  /** Seconds the model takes to come back when the holder types again. */
  comeBackSeconds?: number | null;
  /** Minutes a waiter has waited behind a pinned lease. */
  pinnedWaitMinutes?: number | null;
}

/** Wait words: "about 2 min" short, "about 2 minutes" long. Null when unknown. */
function etaWords(seconds: number | null | undefined, long: boolean): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 50) { const s = Math.max(5, Math.round(seconds / 5) * 5); return `about ${s} seconds`; }
  const m = Math.max(1, Math.round(seconds / 60));
  return long ? `about ${m} ${m === 1 ? "minute" : "minutes"}` : `about ${m} min`;
}

const KIND_NOUN: Record<string, [string, string]> = { picture: ["picture", "pictures"], video: ["video", "videos"], song: ["song", "songs"], coding: ["coding job", "coding jobs"], chat: ["message", "messages"] };

/** "1 picture is" / "2 pictures are" / "3 jobs are" (mixed kinds). Never names anyone. */
function waitingSubject(waiters: { count: number; kinds: string[] }): { subject: string; verb: string; pronoun: string; one: string } {
  const unique = [...new Set(waiters.kinds)];
  const count = Math.max(1, waiters.count);
  const [singular, plural] = unique.length === 1 ? (KIND_NOUN[unique[0] ?? ""] ?? ["job", "jobs"]) : ["job", "jobs"];
  return { subject: `${count} ${count === 1 ? singular : plural}`, verb: count === 1 ? "is" : "are", pronoun: count === 1 ? "It" : "They", one: count === 1 ? `a ${singular}` : `${plural}` };
}

/** The line for the person who holds the lease. Null when there is nothing to say. */
export function holderNotice(input: TierLeaseCopyInput): TierLeaseNotice {
  const w = input.waiters;
  const pausable = input.key === "coding";
  if (w.count > 0) {
    const s = waitingSubject(w);
    const eta = etaWords(input.etaSeconds, false);
    return {
      code: "holder_waiting",
      adult: `${s.subject} ${s.verb} waiting. ${s.pronoun} ${w.count === 1 ? "runs" : "run"} after this step${eta ? `, ${eta}` : ""}.`,
      child: "Someone is waiting for a turn.",
      more: `${s.subject} ${s.verb} waiting for the model you are using. Your step is never cut off. Keep going to hold it, use a lower level from the next step${pausable ? ", or pause and pick this up later with everything kept" : ""}.`,
      actions: pausable ? ["keep", "lower", "pause"] : ["keep", "lower"],
    };
  }
  const back = etaWords(input.comeBackSeconds ?? 40, false) ?? "about 40 seconds";
  return {
    code: "holder_idle",
    adult: `Max switches off when you stop. It comes back when you type, ${back}.`,
    child: "Resting when you stop.",
    more: "Max uses the whole computer, so it is handed back when you stop. The first key you press or file you add brings it back.",
    actions: [],
  };
}

/** A paused coding session: it holds nothing. `kinds` says what it made room for. */
export function pausedNotice(waiters: { count: number; kinds: string[] }): TierLeaseNotice {
  const s = waiters.count > 0 ? waitingSubject(waiters).one : "another job";
  return {
    code: "paused",
    adult: `Paused so ${s} can run.`,
    child: "Paused so someone else can have a turn.",
    more: "Nothing is lost. Resume puts this session back in line, and it starts when its turn comes.",
    actions: ["resume"],
  };
}

/** The lease was released while the holder was idle, for waiting jobs of these kinds. */
export function releasedNotice(waiters: { count: number; kinds: string[] }): TierLeaseNotice {
  const s = waiters.count > 0 ? waitingSubject(waiters).one : "another job";
  return {
    code: "released",
    adult: `Max was released for ${s}. It switches back when you type.`,
    child: "Stepped aside so someone else can have a turn.",
    more: "You were idle and something was waiting, so Max went back at once. Type to bring it back; it takes its turn like any job.",
    actions: [],
  };
}

/** The line for a person waiting behind someone else's lease. `blocker` is what runs: "coding job" in words, never a person. */
export function waiterNotice(input: { etaSeconds?: number | null; pinnedWaitMinutes?: number | null; blocker?: "coding" | "chat" }): TierLeaseNotice {
  const what = input.blocker === "chat" ? "a chat to finish" : "a coding job to finish";
  const eta = etaWords(input.etaSeconds, true);
  const pinnedLong = (input.pinnedWaitMinutes ?? 0) >= 10;
  return {
    code: pinnedLong ? "waiter_pinned" : "waiter",
    adult: `Waiting for ${what}${eta ? `, ${eta}` : ""}.`,
    child: "Waiting for a turn. Back soon.",
    more: pinnedLong
      ? "This has been running a long while. You can use Standard now, or keep waiting."
      : "Your request starts by itself when the other work finishes.",
    actions: pinnedLong ? ["standard_now"] : [],
  };
}
