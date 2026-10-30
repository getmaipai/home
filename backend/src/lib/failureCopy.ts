// THIN-DL-02: the one table of failure wording, with no imports so any module
// may read it. Kinds and the classifier live in generationFailure.ts.
export type FailureKind = "busy" | "memory" | "stopped" | "slow" | "unreachable" | "engine_computer" | "context_too_large" | "other";

export type VoiceFailureKind = "listening_lost" | "listening_engine" | "speaking_failed" | "microphone_blocked" | "microphone_insecure" | "microphone_setup" | "microphone_missing" | "microphone_busy";
export const VOICE_FAILURE_COPY: Record<VoiceFailureKind, { adult: string; adultNoRepairs: string; minor: string }> = {
  listening_lost: {
    adult: "Home is restarting or updating, so voice listening stopped. It will be back in a minute; then tap the waveform to start again.",
    adultNoRepairs: "Home is restarting or updating, so voice listening stopped. It will be back in a minute; then tap the waveform to start again.",
    minor: "I can't hear you right now. Please tell a grown-up.",
  },
  listening_engine: {
    adult: "Home can't hear you right now because its listening engine is not running. Type your message instead, or open Repairs to check it.",
    adultNoRepairs: "Home can't hear you right now because its listening engine is not running. Type your message instead, or ask an owner or admin to check it.",
    minor: "I can't hear you right now. Please tell a grown-up.",
  },
  speaking_failed: {
    adult: "Home couldn't speak that reply, so read it on screen. Voice will try again on your next question.",
    adultNoRepairs: "Home couldn't speak that reply, so read it on screen. Voice will try again on your next question.",
    minor: "I can't talk right now, but you can read my answer.",
  },
  microphone_blocked: {
    adult: "Home can't use your microphone. Allow microphone access in your browser, then tap the waveform again. If you never saw a permission prompt, open System Settings > Privacy & Security > Microphone and switch on this browser.",
    adultNoRepairs: "Home can't use your microphone. Allow microphone access in your browser, then tap the waveform again. If you never saw a permission prompt, open System Settings > Privacy & Security > Microphone and switch on this browser.",
    minor: "I can't use the microphone. Please tell a grown-up.",
  },
  microphone_insecure: {
    adult: "Open Home at http://localhost:3000 or an https address to use the microphone.",
    adultNoRepairs: "Open Home at http://localhost:3000 or an https address to use the microphone.",
    minor: "I can't use the microphone here. Please tell a grown-up.",
  },
  microphone_setup: {
    adult: "Your browser could not start the microphone. Tap the waveform to try again, or copy the details below.",
    adultNoRepairs: "Your browser could not start the microphone. Tap the waveform to try again, or copy the details below.",
    minor: "I can't use the microphone right now. Please tell a grown-up.",
  },
  microphone_missing: {
    adult: "This computer has no microphone. Plug in a microphone, or a display or headset with one, then tap the waveform again.",
    adultNoRepairs: "This computer has no microphone. Plug in a microphone, or a display or headset with one, then tap the waveform again.",
    minor: "I can't hear you because there is no microphone. Please tell a grown-up.",
  },
  microphone_busy: {
    adult: "Another app is using the microphone. Close it, then tap the waveform again.",
    adultNoRepairs: "Another app is using the microphone. Close it, then tap the waveform again.",
    minor: "I can't use the microphone right now. Please tell a grown-up.",
  },
};

export function voiceFailureLine(kind: VoiceFailureKind, options: { minor: boolean; canOpenRepairs: boolean }): string {
  const copy = VOICE_FAILURE_COPY[kind];
  return options.minor ? copy.minor : options.canOpenRepairs ? copy.adult : copy.adultNoRepairs;
}

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

/** CHAT-PAUSE-01: the same composer line, worded for the cause when Home
 * knows it. Every cause reuses the one notice shape (and so the one
 * composer line, Welcome state and Send hold); only the words differ. */
const CAUSE_NOTICE: Record<"restarting" | "memory" | "not_installed" | "mode_change" | "paused_by_admin" | "offline" | "gpu", ComposerNotice> = {
  restarting: {
    adult: "The AI is restarting. Chat will start again by itself in a minute.",
    teen: "The AI is restarting. Chat will start again by itself in a minute.",
    child: "I'm waking up. Try again in a minute.",
    repairs_link: null,
  },
  memory: {
    adult: "The computer is low on memory. Chat is paused until it recovers.",
    teen: "The computer is low on memory. Chat is paused until it recovers.",
    child: "I need a rest. Try again soon.",
    repairs_link: "Open Repairs",
  },
  not_installed: {
    adult: "The AI isn't installed yet. An owner can finish setup.",
    teen: "The AI isn't installed yet. An owner can finish setup.",
    child: "I'm not ready yet. Ask a grown-up.",
    repairs_link: "Open Repairs",
  },
  mode_change: { adult: "Home is getting ready for a big job. Chat will be back in about a minute.", teen: "Home is getting ready for a big job. Chat will be back in about a minute.", child: "I am getting ready for a big job. Try again in a minute.", repairs_link: null },
  gpu: { adult: "Chat is paused because this Mac's graphics compiler is not responding. An owner can restart the Mac when nobody is using it.", teen: "Chat is paused because this Mac's graphics compiler is not responding. Ask a grown-up to restart the Mac.", child: "I need a rest. Ask a grown-up.", repairs_link: "Open Repairs" },
  paused_by_admin: {
    adult: "Chat is paused by an admin until it is turned back on.",
    teen: "Chat is paused by an admin until it is turned back on.",
    child: "Chat is resting. Ask a grown-up.",
    repairs_link: null,
  },
  offline: {
    adult: "The AI isn't answering.",
    teen: "The AI isn't answering. Ask a grown-up to check Repairs.",
    child: "I'm taking a break. Ask a grown-up.",
    repairs_link: "Check Repairs",
  },
};

export type ChatPauseCause = keyof typeof CAUSE_NOTICE;

export function composerNotice(availability: "ready" | "starting" | "unavailable", cause?: ChatPauseCause | null, adminMessage?: string | null): ComposerNotice | null {
  if (cause && availability !== "ready") {
    const base = CAUSE_NOTICE[cause];
    const extra = cause === "paused_by_admin" && adminMessage?.trim() ? ` ${adminMessage.trim()}` : "";
    return extra ? { ...base, adult: base.adult + extra, teen: base.teen + extra } : base;
  }
  if (availability === "unavailable") return COMPOSER_NOTICE.paused;
  if (availability === "starting") return COMPOSER_NOTICE.starting;
  return null;
}

/** ENGINE-STATUS-MEDIA-01 (RULES.md S6, "Pictures and video are not ready"):
 * the one line a picture or clip control shows while it is disabled, per band,
 * in the same ComposerNotice shape the chat line uses, so every client reads
 * the words from the health row (`engines.image.notice`, `engines.video.notice`).
 * No figure (no sizes, no percentages) ever appears in these lines. */
export type MakingKind = "image" | "video";
export type MakingCause = "restarting" | "memory" | "not_installed" | "mode_change" | "offline" | "gpu";

const MAKING_NOUN: Record<MakingKind, { thing: string; Thing: string; things: string; engine: string }> = {
  image: { thing: "picture", Thing: "Picture", things: "Pictures", engine: "picture engine" },
  video: { thing: "video", Thing: "Video", things: "Videos", engine: "video engine" },
};

function makingNoticeFor(kind: MakingKind, cause: MakingCause | "starting" | "unknown"): ComposerNotice {
  const { thing, Thing, things, engine } = MAKING_NOUN[kind];
  switch (cause) {
    case "memory": return {
      adult: `This computer is low on memory, so ${thing} making is paused. It starts again by itself when memory frees up.`,
      teen: `This computer is low on memory, so ${thing} making is paused. It starts again by itself when memory frees up.`,
      child: `${things} are resting for a bit. Try again soon.`,
      repairs_link: null,
    };
    case "not_installed": return {
      adult: `${Thing} making isn't set up on this computer yet. An owner can add it in Settings, Pictures and videos.`,
      teen: `${Thing} making isn't set up on this computer yet. Ask an owner to add it.`,
      child: `${things} aren't ready yet. Ask a grown-up.`,
      repairs_link: null,
    };
    case "mode_change": return {
      adult: `Home is busy with a big job, so ${thing} making is paused. It comes back when the job finishes.`,
      teen: `Home is busy with a big job, so ${thing} making is paused. It comes back when the job finishes.`,
      child: "I'm busy with a big job. Try again later.",
      repairs_link: null,
    };
    case "gpu": return {
      adult: `${things} are paused because this Mac's graphics compiler is not responding. An owner can restart the Mac when nobody is using it.`,
      teen: `${things} are paused because this Mac's graphics compiler is not responding. Ask a grown-up to restart the Mac.`,
      child: `${things} are resting. Ask a grown-up.`,
      repairs_link: "Open Repairs",
    };
    case "restarting": return {
      adult: `The ${engine} is restarting. ${things} will be back by themselves in a minute.`,
      teen: `The ${engine} is restarting. ${things} will be back by themselves in a minute.`,
      child: `${things} are waking up. Try again in a minute.`,
      repairs_link: null,
    };
    case "starting": return {
      adult: `The ${engine} is getting ready. Try again in a moment.`,
      teen: `The ${engine} is getting ready. Try again in a moment.`,
      child: `${things} are waking up. Try again in a moment.`,
      repairs_link: null,
    };
    case "offline": return {
      adult: `The ${engine} isn't answering. An owner can check Repairs.`,
      teen: `The ${engine} isn't answering. Ask a grown-up to check Repairs.`,
      child: `${things} aren't working right now. Ask a grown-up.`,
      repairs_link: "Check Repairs",
    };
    default: return {
      adult: `${Thing} making isn't working right now. Try again later, or an owner can check Repairs.`,
      teen: `${Thing} making isn't working right now. Try again later.`,
      child: `${things} aren't working right now. Ask a grown-up.`,
      repairs_link: "Open Repairs",
    };
  }
}

/** The line for a disabled picture or clip control, or null while it is ready. */
export function makingNotice(kind: MakingKind, availability: "ready" | "starting" | "unavailable", cause?: MakingCause | null): ComposerNotice | null {
  if (availability === "ready") return null;
  return makingNoticeFor(kind, cause ?? (availability === "starting" ? "starting" : "unknown"));
}

/** The adult line for a Stack refusal of a picture or clip call that Home
 * knows as a state (memory, a restart, coding mode). Used at the Stack call
 * boundary so the engine's own sentence, with its figures, never travels on. */
export function makingRefusalLine(kind: MakingKind, cause: MakingCause): string {
  return makingNoticeFor(kind, cause).adult;
}

/** The pause line the turn routes answer with while an admin has chat paused. */
export function adminPauseLine(adminMessage?: string | null): string {
  return composerNotice("unavailable", "paused_by_admin", adminMessage)!.adult;
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

/** FORM-CHAT-WEB-01: the line a typed form shows in its own destructive error when a Submit is refused.
 * Says what went wrong and what to do. `invalid_input` names the field the hub named in its message
 * (the field's label only, never the value). */
export function askFormFailureLine(code: string, hubMessage?: string): string {
  if (code === "ask_stale") return "This form has expired or was already sent. Ask me again to get a new form.";
  if (code === "invalid_input") {
    const label = hubMessage?.match(/ for "([^"]{1,80})"\./)?.[1];
    if (label) return `The answer for "${label}" did not fit. Correct that field, then submit the form again.`;
    return "One answer did not fit. Check each field, then submit the form again.";
  }
  if (code === "hub_unreachable" || code === "client_unreachable" || code === "timeout") return "I could not send the form. Check your connection, then submit it again.";
  return "I could not send the form. Submit it again in a moment.";
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

/** An adult whose reply was stopped by the child-safety floor (a young person's age next to sexual wording anywhere in the reply,
 * which a film's plot summary can trip) is told which part tripped it and how to ask, instead of the general line. */
export const SAFETY_REFUSAL_CSAM_ADULT = "I stopped that reply because it put a young person's age next to sexual wording, which I never write, even when it is a film's plot. Ask for the story without those details and I'll answer.";

export function safetyRefusalLine(band: "adult" | "teen" | "child", categories: readonly string[] = []): string {
  if (band === "adult" && categories.includes("csam")) return SAFETY_REFUSAL_CSAM_ADULT;
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

/** MINOR-TOPICS-01d: the one line a child's support block adds. The 988 line
 * and the links are unchanged for every band; this only goes first. */
export const CHILD_CRISIS_LINE = "Tell a grown-up you trust right now.";

/** MINOR-TOPICS-01d: a child-abuse help line per region, added for a child's
 * block only. The region is the household's; an unknown region gets none
 * (988 and the trusted-grown-up line still show). 988 is the shipped US line
 * and the household has no region setting yet, so the region defaults to US. */
export const CHILD_HELP_LINES: Readonly<Record<string, { label: string; href: string }>> = {
  US: { label: "If someone is hurting you: Childhelp, 1-800-422-4453", href: "tel:18004224453" },
};

/** The support block for a turn whose `crisis_resources` is set. For a child
 * the text opens with the trusted-grown-up line; `crisis_resources` itself
 * (the wire field) is the same for every band. */
export function crisisSupportFor(crisisResources: string | undefined, band: "adult" | "teen" | "child", region = "US"): { title: string; text: string; actions: Array<{ label: string; href: string }> } | undefined {
  if (!crisisResources) return undefined;
  const actions = CRISIS_SUPPORT_ACTIONS.map((action) => ({ ...action }));
  if (band !== "child") return { title: CRISIS_SUPPORT_TITLE, text: crisisResources, actions };
  const help = CHILD_HELP_LINES[region];
  return { title: CRISIS_SUPPORT_TITLE, text: `${CHILD_CRISIS_LINE} ${crisisResources}`, actions: help ? [...actions, { ...help }] : actions };
}

/** WEB-TAB-01: the search palette's Web tab, when the search itself fails (the other reasons reuse the chat's own refusal lines). */
export const WEB_TAB_NOT_ANSWERING = "Web search is not answering right now. Try again in a moment.";
export const WEB_TAB_NOT_ALLOWED = "Web search is not available for this profile.";
// The chat's own refusal lines (refuseWeb) are written for the model and say "only the offline library was searched", which the
// palette did not do, so the Web tab words its own.
export const WEB_TAB_OFF_ADULT = "Web search is turned off in this household. An admin can turn it on in Settings, Search.";
export const WEB_TAB_OFF_MINOR = "Web search isn't turned on for you. Please ask a grown-up.";
export const WEB_TAB_GETTING_READY = "Web search is getting ready. Try again in a minute.";
