// THIN-DL-02: the one table of failure wording, with no imports so any module
// may read it. Kinds and the classifier live in generationFailure.ts.
export type FailureKind = "busy" | "memory" | "stopped" | "slow" | "unreachable" | "engine_computer" | "context_too_large" | "other";

interface FailureCopy {
  adult: string;
  adultAway?: string;
  minor: string;
}

/** One table, one place. A minor's wording is short and kind. An adult's
 * line stays short too (CHAT-CALM-ERRORS-01d): it is the whole inline
 * failure line under a reply, three lines at most on a phone. */
export const FAILURE_COPY: Record<FailureKind, FailureCopy> = {
  busy: {
    adult: "The AI is still starting up or busy. Give it a moment, then send that again.",
    minor: "I'm still waking up. Try again in a moment.",
  },
  memory: {
    adult: "The computer is low on memory. Close an app, then try again in a moment.",
    minor: "I can't wake up all the way right now. Try again soon.",
  },
  // CHAT-CALM-ERRORS-01b: the Stack answered with the role's state
  // `installed` (its engine stopped), so nothing will start on a retry
  // until someone starts it again.
  stopped: {
    adult: "The AI was stopped, so that reply didn't finish. Send it again once chat is back.",
    minor: "I had to stop. Try again in a moment.",
  },
  slow: {
    adult: "That took too long, so the AI stopped answering. Send it again.",
    minor: "That took me too long. Try asking again.",
  },
  unreachable: {
    adult: "I can't reach the AI on this computer. Check it's running, then try again.",
    minor: "I can't get to my thinking part right now. Please tell a grown-up.",
  },
  engine_computer: {
    adult: "I can't reach the engine computer right now. Your message is safe; send it again once chat is back.",
    adultAway: "I can't reach the engine computer from here. Your message is safe; send it again when you are home or once the connection is back.",
    minor: "I can't get to my thinking part right now. Please tell a grown-up.",
  },
  context_too_large: {
    adult: "I couldn't hold all of that in my head at once. Send it again and I'll try again.",
    minor: "That was too much for me at once. Please ask me again.",
  },
  other: {
    adult: "Something went wrong while writing that. Send it again, or check Repairs.",
    minor: "Something went wrong. Try asking again.",
  },
};

/** CHAT-CALM-ERRORS-01d (design section 7): the one quiet line under the
 * composer while chat cannot answer, per band. The health row carries it
 * (healthSnapshot.ts), so the web client, the robot and Go read the same
 * words. `repairs_link` is the words of the one link an owner or admin gets,
 * only while the engine is down; nobody else gets a link. */
export interface ComposerNotice {
  adult: string;
  teen: string;
  child: string;
  repairs_link: string | null;
}

const COMPOSER_NOTICE: Record<"paused" | "starting", ComposerNotice> = {
  paused: {
    adult: "Chat is paused. Your message stays here; press Send once it is back.",
    teen: "Chat is paused right now. Your message stays here; press Send once it is back.",
    child: "I'm taking a break. Ask a grown-up, or try again soon.",
    repairs_link: "Open Repairs",
  },
  starting: {
    adult: "Starting up. You can send in a moment.",
    teen: "Starting up. You can send in a moment.",
    child: "I'm waking up. Send that in a moment.",
    repairs_link: null,
  },
};

export function composerNotice(availability: "ready" | "starting" | "unavailable"): ComposerNotice | null {
  if (availability === "unavailable") return COMPOSER_NOTICE.paused;
  if (availability === "starting") return COMPOSER_NOTICE.starting;
  return null;
}

/** CHAT-CALM-ERRORS-01b (design section 8): the kind of a Stack refusal,
 * chosen from the role state its 503 body states (the Stack's router:
 * notInstalled, installed, loaded, ready, offline), never from the
 * absence of a word. `offline` still reads its reason for "memory" until
 * the Stack exposes a structured memory state (backlog note on
 * CHAT-CALM-ERRORS-01b). A body with no state (an older Stack) keeps the
 * pre-state reading; a state outside the list is `other`. */
export function stackRefusalKind(state: string | undefined, offline_reason: string | undefined): FailureKind {
  const lowMemory = offline_reason !== undefined && offline_reason.toLowerCase().includes("memory");
  if (state === undefined) return lowMemory ? "memory" : "busy";
  if (state === "installed") return "stopped";
  if (state === "loaded") return "busy";
  if (state === "offline") return lowMemory ? "memory" : "other";
  return "other";
}

/** CHAT-CALM-ERRORS-01b (design section 10): what an admin's details
 * popover says above the raw facts, one closed mapping per kind: the cause
 * in plain words, one next step, and whether that step is in Repairs. */
export interface FailureAdvice {
  cause: string;
  next_step: string;
  repairs: boolean;
}

export const FAILURE_ADVICE: Record<FailureKind, FailureAdvice> = {
  busy: { cause: "The chat engine was still starting or busy, so the reply never started.", next_step: "Wait a moment, then retry.", repairs: false },
  memory: { cause: "The computer was too low on memory to run the chat engine.", next_step: "Free some memory, then retry.", repairs: false },
  stopped: { cause: "The chat engine was stopped, so the reply never started.", next_step: "Start the chat engine in Repairs.", repairs: true },
  slow: { cause: "The chat engine stopped answering before the reply finished.", next_step: "Retry. If it keeps happening, check Repairs.", repairs: true },
  unreachable: { cause: "Home could not reach the chat engine.", next_step: "Check that the MaiPai Stack is running in Repairs.", repairs: true },
  engine_computer: { cause: "Home could not reach the engine computer.", next_step: "Retry when the connection is back. If it stays down, check Repairs.", repairs: true },
  context_too_large: { cause: "The request was too large for the chat engine's context window.", next_step: "Retry with less text, or start a new chat.", repairs: false },
  other: { cause: "The reply failed, and the engine did not say why.", next_step: "Retry. If it keeps happening, check Repairs.", repairs: true },
};

/** The same mapping for a failed tool call, keyed by lookupFallback.ts's
 * failure kinds (kept as plain strings here so this file stays import-free). */
export const TOOL_FAILURE_ADVICE: Record<"unavailable" | "timed_out" | "found_nothing" | "errored" | "bad_arguments", { verb: string; next_step: string; repairs: boolean }> = {
  unavailable: { verb: "could not reach its service", next_step: "Retry once the service is back. If it stays down, check Repairs.", repairs: true },
  timed_out: { verb: "timed out", next_step: "Retry; the service was slow to answer.", repairs: false },
  found_nothing: { verb: "found nothing", next_step: "Try asking a different way.", repairs: false },
  errored: { verb: "failed", next_step: "Retry. If it keeps happening, check Repairs.", repairs: true },
  bad_arguments: { verb: "got a request it could not use", next_step: "Retry; the model may word the request differently.", repairs: false },
};

export function failureLine(kind: FailureKind, minor: boolean, awayFromHome = false): string {
  if (kind === "engine_computer" && awayFromHome && !minor) {
    return FAILURE_COPY.engine_computer.adultAway ?? FAILURE_COPY.engine_computer.adult;
  }
  return minor ? FAILURE_COPY[kind].minor : FAILURE_COPY[kind].adult;
}

/** The closing note after a reply that was cut off with some text already
 * on screen. The person keeps what was written; this says it stopped. */
export function partialReplyNote(kind: FailureKind, minor: boolean, awayFromHome = false): string {
  if (kind === "engine_computer") return failureLine(kind, minor, awayFromHome);
  if (minor) return "I had to stop there. Ask me again if you want the rest.";
  return kind === "slow" ? "I had to stop there because the AI stopped answering. Ask me to continue if you want the rest." : "I had to stop there because the AI stopped working. Ask me to continue if you want the rest.";
}

/** THIN-3G (rule 4's last sentence): written chat only, never a spoken
 * turn. `carry_offer` when the stable prefix, the summary and the message
 * cannot fit together: the new chat brings the summary along. `too_big`
 * when the message cannot fit even alone. Neither asks the person to
 * shorten anything. */
const PROMPT_LIMIT_COPY: Record<"carry_offer" | "too_big", FailureCopy> = {
  carry_offer: {
    adult: "This chat has grown too long for me to keep in mind alongside that message. Start a new chat with New chat: I'll bring a summary of this one along, and I'll use it from your next message there.",
    minor: "This chat is really long now. Tap New chat and I'll bring along what we talked about.",
  },
  too_big: {
    adult: "That message is more than I can read in one go on this computer, so I couldn't answer it.",
    minor: "That message is too big for me to read all at once.",
  },
};

export function promptLimitLine(kind: "carry_offer" | "too_big", minor: boolean): string {
  return minor ? PROMPT_LIMIT_COPY[kind].minor : PROMPT_LIMIT_COPY[kind].adult;
}

/** SAFETY-NOTICE-01: the one sentence a person sees when the output gate
 * stops a reply partway for safety (the `safety_refused` error). Plain,
 * no jargon, and it says what to do instead. Per band: a teen reads the
 * adult line, a child a shorter, kind one. The crisis resources, when the
 * reply carried them, are shown instead of this line (crisis_support). */
export const SAFETY_REFUSAL_COPY: Record<"adult" | "teen" | "child", string> = {
  adult: "I stopped that reply partway, so try asking it a different way.",
  teen: "I stopped that reply partway, so try asking it a different way.",
  child: "I can't talk about that one, so let's pick something else.",
};

export function safetyRefusalLine(band: "adult" | "teen" | "child"): string {
  return SAFETY_REFUSAL_COPY[band];
}

/** 4.3, "offer, never block": the crisis resources line, the same for every
 * band. Moved here from turnShared.ts (which re-exports it) by
 * SAFETY-NOTICE-01. */
/** How many finished turns a conversation stays in the crisis state after a
 * self-harm signal (turnShared.ts's conversationInCrisis() re-exports it;
 * the turn history reads it to rebuild which replies carried the resources). */
export const CRISIS_STATE_TURNS = 10;

export const CRISIS_RESOURCES_TEXT =
  "If you're in crisis, the 988 Suicide & Crisis Lifeline is free and available 24/7: call or text 988.";

/** SAFETY-NOTICE-01: crisis resources as a client draws them beside a
 * reply: a supportive title, the text the hub sent (turnShared.ts's
 * CRISIS_RESOURCES_TEXT, unchanged for every band), and the ways to reach
 * the line as links the person can follow. Shape: wire.ts's CrisisSupport. */
export const CRISIS_SUPPORT_TITLE = "Support is available";
export const CRISIS_SUPPORT_ACTIONS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Call 988", href: "tel:988" },
  { label: "Text 988", href: "sms:988" },
  { label: "Chat with 988", href: "https://988lifeline.org/chat/" },
];

/** The support block for a turn whose `crisis_resources` is set. */
export function crisisSupportFor(crisisResources: string | undefined): { title: string; text: string; actions: Array<{ label: string; href: string }> } | undefined {
  return crisisResources ? { title: CRISIS_SUPPORT_TITLE, text: crisisResources, actions: CRISIS_SUPPORT_ACTIONS.map((action) => ({ ...action })) } : undefined;
}
