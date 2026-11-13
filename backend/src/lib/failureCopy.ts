// THIN-DL-02: the one table of failure wording, with no imports so any module
// may read it. Kinds and the classifier live in generationFailure.ts.
/** A line of wording as data (design note i18n-2026-11-07, section 9 step 1): the stable id the catalogs key on and the English default.
 * An i18n magic comment marks each literal so `lingui extract` (frontend/lingui.config.ts includes this file) puts it in the catalogs.
 * Minor (child and teen) lines have their own ids (`.minor`, `.teen`, `.child`) and are defined only here, never in a child or teen catalog. */
export interface MessageDescriptor { id: string; message: string; values?: Record<string, string | number> }
/** The English text of every line in a table, in the old string shape the server, the robot and the tests read. */
function englishOf<T>(table: object): T {
  return Object.fromEntries(Object.entries(table).map(([key, row]: [string, Record<string, MessageDescriptor | undefined>]) => [key, Object.fromEntries(Object.entries(row).filter(([, line]) => line).map(([field, line]) => [field, line!.message]))])) as T;
}
/** Fill `{name}` placeholders for the server's own channels; the web client formats through Lingui instead. */
export function formatMessage(line: MessageDescriptor, values: Record<string, string | number> = line.values ?? {}): string {
  return line.message.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
export type FailureKind = "busy" | "memory" | "stopped" | "slow" | "unreachable" | "engine_computer" | "context_too_large" | "other";

export type VoiceFailureKind = "listening_lost" | "listening_engine" | "speaking_failed" | "microphone_blocked" | "microphone_insecure" | "microphone_setup" | "microphone_missing" | "microphone_busy";
const VOICE_FAILURE_MESSAGES: Record<VoiceFailureKind, { adult: MessageDescriptor; adultNoRepairs: MessageDescriptor; minor: MessageDescriptor }> = {
  listening_lost: {
    adult: /*i18n*/ { id: "failure.voice.listening_lost.adult", message: "One moment. Voice listening will be back in about a minute; then tap the waveform to start again." },
    adultNoRepairs: /*i18n*/ { id: "failure.voice.listening_lost.adultNoRepairs", message: "One moment. Voice listening will be back in about a minute; then tap the waveform to start again." },
    minor: /*i18n*/ { id: "failure.voice.listening_lost.minor", message: "I can't hear you right now. Please tell a grown-up." },
  },
  listening_engine: {
    adult: /*i18n*/ { id: "failure.voice.listening_engine.adult", message: "Home can't hear you right now. Type your message instead, or open Repairs to check it." },
    adultNoRepairs: /*i18n*/ { id: "failure.voice.listening_engine.adultNoRepairs", message: "Home can't hear you right now. Type your message instead, or ask an owner or admin to check it." },
    minor: /*i18n*/ { id: "failure.voice.listening_engine.minor", message: "I can't hear you right now. Please tell a grown-up." },
  },
  speaking_failed: {
    adult: /*i18n*/ { id: "failure.voice.speaking_failed.adult", message: "Home couldn't speak that reply, so read it on screen. Voice will try again on your next question." },
    adultNoRepairs: /*i18n*/ { id: "failure.voice.speaking_failed.adultNoRepairs", message: "Home couldn't speak that reply, so read it on screen. Voice will try again on your next question." },
    minor: /*i18n*/ { id: "failure.voice.speaking_failed.minor", message: "I can't talk right now, but you can read my answer." },
  },
  microphone_blocked: {
    adult: /*i18n*/ { id: "failure.voice.microphone_blocked.adult", message: "Home can't use your microphone. Allow microphone access in your browser, then tap the waveform again. If you never saw a permission prompt, open System Settings > Privacy & Security > Microphone and switch on this browser." },
    adultNoRepairs: /*i18n*/ { id: "failure.voice.microphone_blocked.adultNoRepairs", message: "Home can't use your microphone. Allow microphone access in your browser, then tap the waveform again. If you never saw a permission prompt, open System Settings > Privacy & Security > Microphone and switch on this browser." },
    minor: /*i18n*/ { id: "failure.voice.microphone_blocked.minor", message: "I can't use the microphone. Please tell a grown-up." },
  },
  microphone_insecure: {
    adult: /*i18n*/ { id: "failure.voice.microphone_insecure.adult", message: "Open Home at http://localhost:3000 or an https address to use the microphone." },
    adultNoRepairs: /*i18n*/ { id: "failure.voice.microphone_insecure.adultNoRepairs", message: "Open Home at http://localhost:3000 or an https address to use the microphone." },
    minor: /*i18n*/ { id: "failure.voice.microphone_insecure.minor", message: "I can't use the microphone here. Please tell a grown-up." },
  },
  microphone_setup: {
    adult: /*i18n*/ { id: "failure.voice.microphone_setup.adult", message: "Your browser could not start the microphone. Tap the waveform to try again, or copy the details below." },
    adultNoRepairs: /*i18n*/ { id: "failure.voice.microphone_setup.adultNoRepairs", message: "Your browser could not start the microphone. Tap the waveform to try again, or copy the details below." },
    minor: /*i18n*/ { id: "failure.voice.microphone_setup.minor", message: "I can't use the microphone right now. Please tell a grown-up." },
  },
  microphone_missing: {
    adult: /*i18n*/ { id: "failure.voice.microphone_missing.adult", message: "This computer has no microphone. Plug in a microphone, or a display or headset with one, then tap the waveform again." },
    adultNoRepairs: /*i18n*/ { id: "failure.voice.microphone_missing.adultNoRepairs", message: "This computer has no microphone. Plug in a microphone, or a display or headset with one, then tap the waveform again." },
    minor: /*i18n*/ { id: "failure.voice.microphone_missing.minor", message: "I can't hear you because there is no microphone. Please tell a grown-up." },
  },
  microphone_busy: {
    adult: /*i18n*/ { id: "failure.voice.microphone_busy.adult", message: "Another app is using the microphone. Close it, then tap the waveform again." },
    adultNoRepairs: /*i18n*/ { id: "failure.voice.microphone_busy.adultNoRepairs", message: "Another app is using the microphone. Close it, then tap the waveform again." },
    minor: /*i18n*/ { id: "failure.voice.microphone_busy.minor", message: "I can't use the microphone right now. Please tell a grown-up." },
  },
};

export const VOICE_FAILURE_COPY = englishOf<Record<VoiceFailureKind, { adult: string; adultNoRepairs: string; minor: string }>>(VOICE_FAILURE_MESSAGES);

/** The descriptor the client translates. Spoken output never uses it: speech stays English until the locale-aware normalizer exists (design note section 9, advisory for B1). */
export function voiceFailureMessage(kind: VoiceFailureKind, options: { minor: boolean; canOpenRepairs: boolean }): MessageDescriptor {
  const copy = VOICE_FAILURE_MESSAGES[kind];
  return options.minor ? copy.minor : options.canOpenRepairs ? copy.adult : copy.adultNoRepairs;
}

export function voiceFailureLine(kind: VoiceFailureKind, options: { minor: boolean; canOpenRepairs: boolean }): string {
  return voiceFailureMessage(kind, options).message;
}

/** SPATIAL-04: the plain line for each code the Stack's `spatial_sound` step fails with (docs/integrations.md, `media.edit`). Each says what went wrong and
 * what to do; the Stack's own text is never shown (it can carry a path). */
export const SPATIAL_FAILURE_COPY = {
  no_audio: "This clip has no sound, so there is nothing to place. Make or add sound first.",
  bad_input: "Spatial sound follows people on screen, and this clip has no picture it can read. Pick a clip with a picture.",
  model_missing: "Spatial sound needs the Look part. An admin can install it in Settings, Models and storage, then try again.",
  no_memory: "There is not enough free memory for spatial sound right now. Wait for other work to finish, then try again.",
  speech_unavailable: "Spatial sound needs the speech part, and it is not running. An admin can check Settings, Models and storage, then try again.",
  spatial_failed: "Spatial sound did not finish. Try again, or try a shorter clip.",
} as const;
export type SpatialFailureCode = keyof typeof SPATIAL_FAILURE_COPY;
export function isSpatialFailureCode(code: unknown): code is SpatialFailureCode {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(SPATIAL_FAILURE_COPY, code);
}

export const RESTYLE_FAILURE_COPY = {
  ic_lora_refused: "The colorize style could not be used with this clip. Try another clip or ask an admin to check Settings, Styles.",
  no_memory: "There is not enough free memory for colorize right now. Wait for other work to finish, then try again.",
  not_installed: "The Max video model is not installed. An admin can install it in Settings, Models and storage.",
  lora_missing: "The colorize style is not installed. An admin can add it in Settings, Styles, then try again.",
} as const;

/** REFVIDEO-01: the plain line for each code the Stack's `POST /v1/videos/ingredients` answers with. */
export const INGREDIENTS_FAILURE_COPY = {
  ic_lora_missing: "The adapter that makes videos from reference sheets is not installed. An admin can add the Video-from-pictures adapter in Settings, AI and models, then try again.",
  ic_lora_refused: "The reference sheet could not be used for a video. Try different pictures, or ask an admin to check Settings, AI and models.",
  no_memory: "There is not enough free memory to make a video from pictures right now. Wait for other work to finish, then try again.",
  not_installed: "The Max video model is not installed. An admin can install it in Settings, Models and storage.",
} as const;

interface FailureCopy {
  adult: string;
  adultAway?: string;
  minor: string;
}
interface FailureMessages {
  adult: MessageDescriptor;
  adultAway?: MessageDescriptor;
  minor: MessageDescriptor;
}

/** One table, one place. A minor's wording is short and kind. An adult's
 * line stays short too (CHAT-CALM-ERRORS-01d): it is the whole inline
 * failure line under a reply, three lines at most on a phone. */
const FAILURE_MESSAGES: Record<FailureKind, FailureMessages> = {
  busy: {
    adult: /*i18n*/ { id: "failure.busy.adult", message: "One moment. Send that again in a bit." },
    minor: /*i18n*/ { id: "failure.busy.minor", message: "One moment. Try again soon." },
  },
  memory: {
    adult: /*i18n*/ { id: "failure.memory.adult", message: "One moment. Try again in a bit." },
    minor: /*i18n*/ { id: "failure.memory.minor", message: "One moment. Ask again soon." },
  },
  // CHAT-CALM-ERRORS-01b: the Stack answered with the role's state
  // `installed` (its engine stopped), so nothing will start on a retry
  // until someone starts it again.
  stopped: {
    adult: /*i18n*/ { id: "failure.stopped.adult", message: "That reply didn't finish. Send it again in a moment." },
    minor: /*i18n*/ { id: "failure.stopped.minor", message: "I had to stop. Try again in a moment." },
  },
  slow: {
    adult: /*i18n*/ { id: "failure.slow.adult", message: "That took too long. Send it again." },
    minor: /*i18n*/ { id: "failure.slow.minor", message: "That took too long. Ask again." },
  },
  unreachable: {
    adult: /*i18n*/ { id: "failure.unreachable.adult", message: "I can't reach the AI on this computer. Check it's running, then try again." },
    minor: /*i18n*/ { id: "failure.unreachable.minor", message: "I can't get to my thinking part right now. Please tell a grown-up." },
  },
  engine_computer: {
    adult: /*i18n*/ { id: "failure.engine_computer.adult", message: "I can't reach the AI computer right now. Your message is safe; send it again once chat is back." },
    adultAway: /*i18n*/ { id: "failure.engine_computer.adultAway", message: "I can't reach the AI computer from here. Your message is safe; send it again when you are home or once the connection is back." },
    minor: /*i18n*/ { id: "failure.engine_computer.minor", message: "I can't get to my thinking part right now. Please tell a grown-up." },
  },
  context_too_large: {
    adult: /*i18n*/ { id: "failure.context_too_large.adult", message: "I couldn't hold all of that in my head at once. Send it again and I'll try again." },
    minor: /*i18n*/ { id: "failure.context_too_large.minor", message: "That was too much for me at once. Please ask me again." },
  },
  other: {
    adult: /*i18n*/ { id: "failure.other.adult", message: "Something went wrong while writing that. Send it again, or check Repairs." },
    minor: /*i18n*/ { id: "failure.other.minor", message: "Something went wrong. Try asking again." },
  },
};

export const FAILURE_COPY = englishOf<Record<FailureKind, FailureCopy>>(FAILURE_MESSAGES);

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
  /** The longer explanation, for the line's tooltip. Never drawn under the input. */
  more?: string;
}

interface ComposerNoticeMessages {
  adult: MessageDescriptor;
  teen: MessageDescriptor;
  child: MessageDescriptor;
  repairs_link: MessageDescriptor | null;
  more?: MessageDescriptor;
}
const REPAIRS_OPEN = /*i18n*/ { id: "failure.composer.repairs.open", message: "Open Repairs" };
const REPAIRS_CHECK = /*i18n*/ { id: "failure.composer.repairs.check", message: "Check Repairs" };

const COMPOSER_NOTICE_MESSAGES: Record<"paused" | "starting", ComposerNoticeMessages> = {
  paused: {
    adult: /*i18n*/ { id: "failure.composer.paused.adult", message: "Your message is saved. Back soon." },
    teen: /*i18n*/ { id: "failure.composer.paused.teen", message: "Your message is saved. Back soon." },
    child: /*i18n*/ { id: "failure.composer.paused.child", message: "I'm taking a break. Ask a grown-up." },
    repairs_link: REPAIRS_OPEN,
  },
  starting: {
    adult: /*i18n*/ { id: "failure.composer.starting.adult", message: "Starting up. Send in a moment." },
    teen: /*i18n*/ { id: "failure.composer.starting.teen", message: "Starting up. Send in a moment." },
    child: /*i18n*/ { id: "failure.composer.starting.child", message: "I'm waking up. Send in a moment." },
    repairs_link: null,
  },
};

/** CHAT-PAUSE-01: the same composer line, worded for the cause when Home
 * knows it. Every cause reuses the one notice shape (and so the one
 * composer line, Welcome state and Send hold); only the words differ. */
const CAUSE_NOTICE_MESSAGES: Record<"restarting" | "memory" | "not_installed" | "mode_change" | "reduced_swap" | "paused_by_admin" | "offline" | "gpu" | "upgrading", ComposerNoticeMessages> = {
  restarting: {
    adult: /*i18n*/ { id: "failure.composer.restarting.adult", message: "One moment. Back soon." },
    teen: /*i18n*/ { id: "failure.composer.restarting.teen", message: "One moment. Back soon." },
    child: /*i18n*/ { id: "failure.composer.restarting.child", message: "One moment. Back soon." },
    repairs_link: null,
  },
  memory: {
    adult: /*i18n*/ { id: "failure.composer.memory.adult", message: "One moment. Back soon." },
    teen: /*i18n*/ { id: "failure.composer.memory.teen", message: "One moment. Back soon." },
    child: /*i18n*/ { id: "failure.composer.memory.child", message: "I need a rest. Try again soon." },
    repairs_link: null,
  },
  not_installed: {
    adult: /*i18n*/ { id: "failure.composer.not_installed.adult", message: "The AI isn't installed. Ask an owner." },
    teen: /*i18n*/ { id: "failure.composer.not_installed.teen", message: "The AI isn't installed. Ask an owner." },
    child: /*i18n*/ { id: "failure.composer.not_installed.child", message: "I'm not ready yet. Ask a grown-up." },
    repairs_link: REPAIRS_OPEN,
  },
  mode_change: { adult: /*i18n*/ { id: "failure.composer.mode_change.adult", message: "Getting ready. Back in about a minute." }, teen: /*i18n*/ { id: "failure.composer.mode_change.teen", message: "Getting ready. Back in about a minute." }, child: /*i18n*/ { id: "failure.composer.mode_change.child", message: "Getting ready. Back in about a minute." }, repairs_link: null, more: /*i18n*/ { id: "failure.composer.mode_change.more", message: "Home is getting ready for another job. Chat comes back by itself." } },
  reduced_swap: { adult: /*i18n*/ { id: "failure.composer.reduced_swap.adult", message: "One moment. Back in about 15 seconds." }, teen: /*i18n*/ { id: "failure.composer.reduced_swap.teen", message: "One moment. Back in about 15 seconds." }, child: /*i18n*/ { id: "failure.composer.reduced_swap.child", message: "One moment. Back in about 15 seconds." }, repairs_link: null, more: /*i18n*/ { id: "failure.composer.reduced_swap.more", message: "Chat comes back by itself in a few seconds." } },
  gpu: { adult: /*i18n*/ { id: "failure.composer.gpu.adult", message: "Chat needs a reboot of the Mac." }, teen: /*i18n*/ { id: "failure.composer.gpu.teen", message: "Chat needs a reboot. Ask a grown-up." }, more: /*i18n*/ { id: "failure.composer.gpu.more", message: "An owner can reboot the Mac when it is quiet." }, child: /*i18n*/ { id: "failure.composer.gpu.child", message: "I need a rest. Ask a grown-up." }, repairs_link: REPAIRS_OPEN },
  // HOST-LAUNCH-03 (owner, 2026-11-12): while a development lease holds the whole machine, or an upgrade runs, chat says this one line. No resource words.
  upgrading: {
    adult: /*i18n*/ { id: "failure.composer.upgrading.adult", message: "Chat is unavailable while the system upgrades." },
    teen: /*i18n*/ { id: "failure.composer.upgrading.teen", message: "Chat is unavailable while the system upgrades." },
    child: /*i18n*/ { id: "failure.composer.upgrading.child", message: "Chat is unavailable while the system upgrades." },
    repairs_link: null,
  },
  paused_by_admin: {
    adult: /*i18n*/ { id: "failure.composer.paused_by_admin.adult", message: "An admin turned chat off for now." },
    teen: /*i18n*/ { id: "failure.composer.paused_by_admin.teen", message: "An admin turned chat off for now." },
    child: /*i18n*/ { id: "failure.composer.paused_by_admin.child", message: "Chat is resting. Ask a grown-up." },
    repairs_link: null,
  },
  offline: {
    adult: /*i18n*/ { id: "failure.composer.offline.adult", message: "The AI isn't answering." },
    teen: /*i18n*/ { id: "failure.composer.offline.teen", message: "The AI isn't answering. Ask a grown-up." },
    child: /*i18n*/ { id: "failure.composer.offline.child", message: "I'm taking a break. Ask a grown-up." },
    repairs_link: REPAIRS_CHECK,
  },
};

function noticeOf(messages: ComposerNoticeMessages): ComposerNotice {
  return { adult: messages.adult.message, teen: messages.teen.message, child: messages.child.message, repairs_link: messages.repairs_link?.message ?? null, ...(messages.more ? { more: messages.more.message } : {}) };
}
const COMPOSER_NOTICE = Object.fromEntries(Object.entries(COMPOSER_NOTICE_MESSAGES).map(([key, messages]) => [key, noticeOf(messages)])) as Record<keyof typeof COMPOSER_NOTICE_MESSAGES, ComposerNotice>;
const CAUSE_NOTICE = Object.fromEntries(Object.entries(CAUSE_NOTICE_MESSAGES).map(([key, messages]) => [key, noticeOf(messages)])) as Record<keyof typeof CAUSE_NOTICE_MESSAGES, ComposerNotice>;

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
export type MakingKind = "image" | "video" | "music" | "voices";
export type MakingCause = "restarting" | "memory" | "not_installed" | "mode_change" | "offline" | "gpu";

const MAKING_NOUN: Record<MakingKind, { thing: string; Thing: string; things: string }> = {
  image: { thing: "picture", Thing: "Picture", things: "Pictures" },
  video: { thing: "video", Thing: "Video", things: "Videos" },
  music: { thing: "song", Thing: "Song", things: "Songs" },
  voices: { thing: "voice", Thing: "Voice", things: "Voices" },
};

function makingNoticeFor(kind: MakingKind, cause: MakingCause | "starting" | "unknown"): ComposerNotice {
  const { Thing, things } = MAKING_NOUN[kind];
  switch (cause) {
    case "memory": return {
      adult: `Waiting for its turn. ${Thing} making starts by itself in a moment.`,
      teen: `Waiting for its turn. ${Thing} making starts by itself in a moment.`,
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
      adult: `${Thing} making starts again by itself when another job finishes.`,
      teen: `${Thing} making starts again by itself when another job finishes.`,
      child: `${things} are getting ready. Try again later.`,
      repairs_link: null,
    };
    case "gpu": return {
      adult: `${Thing} making needs a reboot of the Mac. An owner can do it when it is quiet.`,
      teen: `${Thing} making needs a reboot of the Mac. Ask a grown-up.`,
      child: `${things} are resting. Ask a grown-up.`,
      repairs_link: "Open Repairs",
    };
    case "restarting": return {
      adult: `One moment. ${things} will be back by themselves in about a minute.`,
      teen: `One moment. ${things} will be back by themselves in about a minute.`,
      child: `${things} are waking up. Try again in a minute.`,
      repairs_link: null,
    };
    case "starting": return {
      adult: `${Thing} making is getting ready. Try again in a moment.`,
      teen: `${Thing} making is getting ready. Try again in a moment.`,
      child: `${things} are waking up. Try again in a moment.`,
      repairs_link: null,
    };
    case "offline": return {
      adult: `${Thing} making isn't answering. An owner can check Repairs.`,
      teen: `${Thing} making isn't answering. Ask a grown-up to check Repairs.`,
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

const FAILURE_ADVICE_MESSAGES: Record<FailureKind, { cause: MessageDescriptor; next_step: MessageDescriptor; repairs: boolean }> = {
  busy: { cause: /*i18n*/ { id: "failure.advice.busy.cause", message: "The chat engine was still starting or busy, so the reply never started." }, next_step: /*i18n*/ { id: "failure.advice.busy.next_step", message: "Wait a moment, then retry." }, repairs: false },
  memory: { cause: /*i18n*/ { id: "failure.advice.memory.cause", message: "The computer was too low on memory to run the chat engine." }, next_step: /*i18n*/ { id: "failure.advice.memory.next_step", message: "Free some memory, then retry." }, repairs: false },
  stopped: { cause: /*i18n*/ { id: "failure.advice.stopped.cause", message: "The chat engine was stopped, so the reply never started." }, next_step: /*i18n*/ { id: "failure.advice.stopped.next_step", message: "Start the chat engine in Repairs." }, repairs: true },
  slow: { cause: /*i18n*/ { id: "failure.advice.slow.cause", message: "The chat engine stopped answering before the reply finished." }, next_step: /*i18n*/ { id: "failure.advice.slow.next_step", message: "Retry. If it keeps happening, check Repairs." }, repairs: true },
  unreachable: { cause: /*i18n*/ { id: "failure.advice.unreachable.cause", message: "Home could not reach the chat engine." }, next_step: /*i18n*/ { id: "failure.advice.unreachable.next_step", message: "Check that the MaiPai Stack is running in Repairs." }, repairs: true },
  engine_computer: { cause: /*i18n*/ { id: "failure.advice.engine_computer.cause", message: "Home could not reach the engine computer." }, next_step: /*i18n*/ { id: "failure.advice.engine_computer.next_step", message: "Retry when the connection is back. If it stays down, check Repairs." }, repairs: true },
  context_too_large: { cause: /*i18n*/ { id: "failure.advice.context_too_large.cause", message: "The request was too large for the chat engine's context window." }, next_step: /*i18n*/ { id: "failure.advice.context_too_large.next_step", message: "Retry with less text, or start a new chat." }, repairs: false },
  other: { cause: /*i18n*/ { id: "failure.advice.other.cause", message: "The reply failed, and the engine did not say why." }, next_step: /*i18n*/ { id: "failure.advice.other.next_step", message: "Retry. If it keeps happening, check Repairs." }, repairs: true },
};
export const FAILURE_ADVICE = Object.fromEntries(Object.entries(FAILURE_ADVICE_MESSAGES).map(([kind, row]) => [kind, { cause: row.cause.message, next_step: row.next_step.message, repairs: row.repairs }])) as Record<FailureKind, FailureAdvice>;

/** The same mapping for a failed tool call, keyed by lookupFallback.ts's
 * failure kinds (kept as plain strings here so this file stays import-free). */
type ToolFailureKind = "unavailable" | "timed_out" | "found_nothing" | "errored" | "bad_arguments";
const TOOL_FAILURE_MESSAGES: Record<ToolFailureKind, { verb: MessageDescriptor; next_step: MessageDescriptor; repairs: boolean }> = {
  unavailable: { verb: /*i18n*/ { id: "failure.tool.unavailable.verb", message: "could not reach its service" }, next_step: /*i18n*/ { id: "failure.tool.unavailable.next_step", message: "Retry once the service is back. If it stays down, check Repairs." }, repairs: true },
  timed_out: { verb: /*i18n*/ { id: "failure.tool.timed_out.verb", message: "timed out" }, next_step: /*i18n*/ { id: "failure.tool.timed_out.next_step", message: "Retry; the service was slow to answer." }, repairs: false },
  found_nothing: { verb: /*i18n*/ { id: "failure.tool.found_nothing.verb", message: "found nothing" }, next_step: /*i18n*/ { id: "failure.tool.found_nothing.next_step", message: "Try asking a different way." }, repairs: false },
  errored: { verb: /*i18n*/ { id: "failure.tool.errored.verb", message: "failed" }, next_step: /*i18n*/ { id: "failure.tool.errored.next_step", message: "Retry. If it keeps happening, check Repairs." }, repairs: true },
  bad_arguments: { verb: /*i18n*/ { id: "failure.tool.bad_arguments.verb", message: "got a request it could not use" }, next_step: /*i18n*/ { id: "failure.tool.bad_arguments.next_step", message: "Retry; the model may word the request differently." }, repairs: false },
};
export const TOOL_FAILURE_ADVICE = Object.fromEntries(Object.entries(TOOL_FAILURE_MESSAGES).map(([kind, row]) => [kind, { verb: row.verb.message, next_step: row.next_step.message, repairs: row.repairs }])) as Record<ToolFailureKind, { verb: string; next_step: string; repairs: boolean }>;

/** The descriptor behind failureLine: the web client translates it; the server, the robot and Go read `.message` (failureLine). */
export function failureMessage(kind: FailureKind, minor: boolean, awayFromHome = false): MessageDescriptor {
  if (kind === "engine_computer" && awayFromHome && !minor) {
    return FAILURE_MESSAGES.engine_computer.adultAway ?? FAILURE_MESSAGES.engine_computer.adult;
  }
  return minor ? FAILURE_MESSAGES[kind].minor : FAILURE_MESSAGES[kind].adult;
}

export function failureLine(kind: FailureKind, minor: boolean, awayFromHome = false): string {
  return failureMessage(kind, minor, awayFromHome).message;
}

const PARTIAL_NOTE_MESSAGES = {
  minor: /*i18n*/ { id: "failure.partial.minor", message: "I had to stop there. Ask me again if you want the rest." },
  slow: /*i18n*/ { id: "failure.partial.slow", message: "I had to stop there because the AI stopped answering. Ask me to continue if you want the rest." },
  other: /*i18n*/ { id: "failure.partial.other", message: "I had to stop there because the AI stopped working. Ask me to continue if you want the rest." },
};

/** The closing note after a reply that was cut off with some text already
 * on screen. The person keeps what was written; this says it stopped. */
export function partialReplyNote(kind: FailureKind, minor: boolean, awayFromHome = false): string {
  if (kind === "engine_computer") return failureLine(kind, minor, awayFromHome);
  if (minor) return PARTIAL_NOTE_MESSAGES.minor.message;
  return kind === "slow" ? PARTIAL_NOTE_MESSAGES.slow.message : PARTIAL_NOTE_MESSAGES.other.message;
}

/** THIN-3G (rule 4's last sentence): written chat only, never a spoken
 * turn. `carry_offer` when the stable prefix, the summary and the message
 * cannot fit together: the new chat brings the summary along. `too_big`
 * when the message cannot fit even alone. Neither asks the person to
 * shorten anything. */
const PROMPT_LIMIT_MESSAGES: Record<"carry_offer" | "too_big", { adult: MessageDescriptor; minor: MessageDescriptor }> = {
  carry_offer: {
    adult: /*i18n*/ { id: "failure.prompt_limit.carry_offer.adult", message: "This chat has grown too long for me to keep in mind alongside that message. Start a new chat with New chat: I'll bring a summary of this one along, and I'll use it from your next message there." },
    minor: /*i18n*/ { id: "failure.prompt_limit.carry_offer.minor", message: "This chat is really long now. Tap New chat and I'll bring along what we talked about." },
  },
  too_big: {
    adult: /*i18n*/ { id: "failure.prompt_limit.too_big.adult", message: "That message is more than I can read in one go on this computer, so I couldn't answer it." },
    minor: /*i18n*/ { id: "failure.prompt_limit.too_big.minor", message: "That message is too big for me to read all at once." },
  },
};

export function promptLimitLine(kind: "carry_offer" | "too_big", minor: boolean): string {
  return minor ? PROMPT_LIMIT_MESSAGES[kind].minor.message : PROMPT_LIMIT_MESSAGES[kind].adult.message;
}

/** FORM-CHAT-WEB-01: the line a typed form shows in its own destructive error when a Submit is refused.
 * Says what went wrong and what to do. `invalid_input` names the field the hub named in its message
 * (the field's label only, never the value). */
const ASK_FORM_MESSAGES = {
  stale: /*i18n*/ { id: "failure.ask_form.stale", message: "This form has expired or was already sent. Ask me again to get a new form." },
  field: /*i18n*/ { id: "failure.ask_form.field", message: "The answer for \"{label}\" did not fit. Correct that field, then submit the form again." },
  invalid: /*i18n*/ { id: "failure.ask_form.invalid", message: "One answer did not fit. Check each field, then submit the form again." },
  unreachable: /*i18n*/ { id: "failure.ask_form.unreachable", message: "I could not send the form. Check your connection, then submit it again." },
  other: /*i18n*/ { id: "failure.ask_form.other", message: "I could not send the form. Submit it again in a moment." },
};

/** The descriptor for the line above; `values.label` is set when the hub named the field. */
export function askFormFailureMessage(code: string, hubMessage?: string): MessageDescriptor {
  if (code === "ask_stale") return ASK_FORM_MESSAGES.stale;
  if (code === "invalid_input") {
    const label = hubMessage?.match(/ for "([^"]{1,80})"\./)?.[1];
    return label ? { ...ASK_FORM_MESSAGES.field, values: { label } } : ASK_FORM_MESSAGES.invalid;
  }
  if (code === "hub_unreachable" || code === "client_unreachable" || code === "timeout") return ASK_FORM_MESSAGES.unreachable;
  return ASK_FORM_MESSAGES.other;
}

export function askFormFailureLine(code: string, hubMessage?: string): string {
  return formatMessage(askFormFailureMessage(code, hubMessage));
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

/** Every descriptor above, found by shape, so a client that is handed only the English text (a health row's `notice`, an `advice` block,
 * a stored turn error) can still show it in the person's language. Minor lines (`.minor`, `.teen`, `.child`) and adult lines are looked up
 * apart: a minor never resolves to an adult id, and an adult never to a minor one (rule 0). Text with no descriptor (an admin's own words,
 * a reason from another part) is not found, and the client shows it as it came. */
const isMinorId = (id: string): boolean => /\.(minor|teen|child)$/.test(id);
let lineIndex: Map<string, MessageDescriptor> | undefined;
function indexLines(): Map<string, MessageDescriptor> {
  if (lineIndex) return lineIndex;
  const found = new Map<string, MessageDescriptor>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const line = value as Partial<MessageDescriptor>;
    if (typeof line.id === "string" && typeof line.message === "string") {
      const key = `${isMinorId(line.id) ? "minor" : "adult"}\u0000${line.message}`;
      if (!found.has(key) && !line.message.includes("{")) found.set(key, line as MessageDescriptor);
      return;
    }
    for (const child of Object.values(value)) walk(child);
  };
  for (const table of [VOICE_FAILURE_MESSAGES, FAILURE_MESSAGES, COMPOSER_NOTICE_MESSAGES, CAUSE_NOTICE_MESSAGES, FAILURE_ADVICE_MESSAGES, TOOL_FAILURE_MESSAGES, PARTIAL_NOTE_MESSAGES, PROMPT_LIMIT_MESSAGES, ASK_FORM_MESSAGES]) walk(table);
  lineIndex = found;
  return found;
}
export function descriptorForLine(text: string, minor: boolean): MessageDescriptor | undefined {
  return indexLines().get(`${minor ? "minor" : "adult"}\u0000${text}`);
}
