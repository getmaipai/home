// REG-02: composer-owned voice disfluencies and nonverbal cues.
//
// The composer, never the model, decides where a spoken reply gets a
// laugh, a sigh or a "hmm," and only in the SPOKEN rendering (the text
// handed to the speech engine). The written reply never carries a cue.
// Owner ruling 2026-10-06: default light, rate limited, behind the
// `voice.hesitations` key, never inside numbers, names, instructions,
// safety, alarms or child learning. Chat rule 0 outranks all of it: a
// child or a teen never gets a cue, whatever the setting says.
//
// Everything here is pure (state in, state out) so the policy is tested
// without an engine. Insertion happens only at sentence boundaries, which
// is what keeps a cue out of a number, a name or a step.
//
// Tags are engine vocabulary: an engine honors only the tags it advertises
// (`tts.tags` on the Stack's tts role state and voice entry). An engine
// that advertises none (Pocket TTS) gets no nonverbal tag; the optional
// spoken filler ("Hmm,") is plain text any engine can say.

export type HesitationLevel = "off" | "light" | "natural";
export type CueBand = "child" | "teen" | "adult";

export const HESITATION_LEVELS: readonly HesitationLevel[] = ["off", "light", "natural"];
export const DEFAULT_HESITATION_LEVEL: HesitationLevel = "light";

/** Every nonverbal tag name Home knows how to place: only the tags verified
 * by ear on Chatterbox Turbo (2026-10-17). "groan" sounds like speech and an
 * unknown tag is read aloud as a word, so neither is ever inserted. A tag
 * outside this list is never placed, and only a name the active engine
 * advertises is kept on the way to it. */
export const KNOWN_CUE_TAGS = ["laugh", "chuckle", "cough", "sigh", "clear throat", "gasp"] as const;

export function normalizeTagName(tag: string): string {
  return tag.trim().replace(/^\[|\]$/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeTagList(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const name = normalizeTagName(tag);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

export interface CueState {
  turnId: string | null;
  /** Sentences planned so far in the current turn. */
  sentences: number;
  /** Cues and fillers inserted so far in the current turn. */
  insertedThisTurn: number;
  /** Sentence index of the last insertion in this turn, or null. */
  lastInsertedSentence: number | null;
  /** Whole turns since the last insertion; Infinity before the first. */
  turnsSinceInsert: number;
}

export function freshCueState(): CueState {
  return { turnId: null, sentences: 0, insertedThisTurn: 0, lastInsertedSentence: null, turnsSinceInsert: Number.POSITIVE_INFINITY };
}

export interface CuePolicy {
  maxPerTurn: number;
  /** Minimum sentences between two insertions inside one turn. */
  minGapSentences: number;
  /** Minimum whole turns between insertions across turns. */
  cooldownTurns: number;
  /** Chance (0 to 1) that a sentence that earned a cue gets it. */
  cueChance: number;
  /** Chance that an opener gets a spoken filler. */
  fillerChance: number;
  allowOpenerTag: boolean;
}

export const CUE_POLICIES: Record<Exclude<HesitationLevel, "off">, CuePolicy> = {
  light: { maxPerTurn: 1, minGapSentences: 3, cooldownTurns: 3, cueChance: 0.6, fillerChance: 0.2, allowOpenerTag: false },
  natural: { maxPerTurn: 2, minGapSentences: 3, cooldownTurns: 1, cueChance: 0.9, fillerChance: 0.4, allowOpenerTag: true },
};

/** VOICE-DELIVERY-01: when the small model chooses, it already decides how often; these are only the outer limits. */
const MODEL_POLICY: CuePolicy = { maxPerTurn: 2, minGapSentences: 2, cooldownTurns: 0, cueChance: 1, fillerChance: 0, allowOpenerTag: false };

export interface CueInput {
  /** One sentence (or short run) about to be spoken. */
  text: string;
  turnId: string;
  level: HesitationLevel;
  /** The speaker's age band. Anything but "adult" gets nothing. */
  band: CueBand;
  /** Tags the active engine advertises; empty means none. */
  supportedTags: readonly string[];
  /** True for a safety line, refusal, crisis resource, alarm, timer or tool status line. */
  blocked?: boolean;
  /** Test hook: replaces the seeded roll. */
  roll?: number;
  /** VOICE-DELIVERY-01: what the small model chose for this sentence. undefined means it gave no answer (the keyword rules decide); null or a tag-less choice means "play it plain". */
  choice?: { tag: string | null; place: "before" | "after" } | null;
  state: CueState;
}

export interface CueResult {
  text: string;
  state: CueState;
  /** What was added: a tag name, a filler word, or null. */
  inserted: { kind: "tag"; name: string } | { kind: "filler"; word: string } | null;
}

/** FNV-1a hash to a stable number in [0, 1): the same turn and sentence
 * always roll the same, so tests and replays are stable. */
export function seededRoll(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x100000000;
}

const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|quarter|percent|o'clock)\b/i;
const SAFETY_WORDS = /\b(emergency|911|988|112|999|hotline|crisis|suicid\w*|self[- ]harm|poison\w*|overdose|dangerous|unsafe|abuse\w*|assault\w*|harm\w*|hurt\w*|injur\w*|medicine|medication|dosage|dose|allerg\w*|alarm|smoke detector|timer|reminder|can't help|cannot help|can't do that|not able to|won't be able|i'm sorry|i am sorry|sorry)\b/i;
const INSTRUCTION_START = /^\s*(step\s+\w+|first|second|third|next|then|finally|now|make sure|be sure|remember to|you should|you must|you need to|don't|do not|never|always|please|turn|press|tap|click|open|go to|set|add|mix|stir|pour|bake|cook|preheat|take|put|use)\b/i;
const MACHINE_TEXT = /https?:\/\/|www\.|@\w+\.\w+|\d|[:;]\s|\b[A-Za-z0-9_-]+\.(com|org|net|io|app|local)\b/;

/** Whether a sentence is off limits for any cue or filler: it holds a
 * number, a link, an instruction step or safety wording. The insertion
 * point is always outside the sentence's own words, so this is a second
 * guard on top of the boundary rule, not the only one. */
export function isProtectedSentence(text: string): boolean {
  return MACHINE_TEXT.test(text) || NUMBER_WORDS.test(text) || SAFETY_WORDS.test(text) || INSTRUCTION_START.test(text);
}

interface Trigger { pattern: RegExp; tags: string[]; place: "after" | "before" }

// Tag to situation mapping. Emotional or humorous content only; order is
// priority. laugh/chuckle after humor, sigh after weariness or sympathy,
// gasp before a surprise. cough and clear throat are not here: they are rare
// interjections at the start of a reply (see OPENER_TAGS).
const TRIGGERS: Trigger[] = [
  { pattern: /\b(ha(?:ha)+|hehe+|lol|funny|hilarious|joke|silly|ridiculous|amusing|made me laugh|crack(?:ed)? me up)\b|\bha[,!.]/i, tags: ["laugh", "chuckle"], place: "after" },
  { pattern: /\b(wow|whoa|no way|oh my|oh my goodness|can't believe|what a surprise|unexpected)\b/i, tags: ["gasp"], place: "before" },
  { pattern: /\b(oh well|bummer|ugh|what a day|long day|tired|exhausting|oh dear|that's a shame|sounds (?:\w+ )?(?:hard|tough|rough|exhausting)|that's (?:tough|rough)|i understand)\b/i, tags: ["sigh"], place: "after" },
];

/** Rare opener interjections for a long first sentence, in preference order:
 * a clear throat before a long explanation, then a cough. Natural level only. */
const OPENER_TAGS = ["clear throat", "cough"] as const;

const FILLERS = ["Hmm,", "Well,"] as const;
const LEADING_FILLER = /^\s*(hmm+|well|um+|uh+|er|oh|ah|so|okay|ok|right|let me think)\b/i;
// Words that are safe to lowercase after a filler ("Hmm, the ...").
const LOWERCASE_SAFE = /^(the|this|that|these|those|it|it's|there|there's|here|here's|you|you're|we|they|yes|no|sure|maybe|probably|honestly|actually|i'd|i'll|i'm)$/i;

function endsSentence(text: string): boolean {
  return /[.!?]["')\]]*\s*$/.test(text);
}

function withState(state: CueState, turnId: string): CueState {
  if (state.turnId === turnId) return { ...state };
  // A new turn: the old turn counts as one turn without a new insertion
  // unless it inserted something (then the cooldown restarts at zero).
  const turnsSinceInsert = state.turnId === null ? state.turnsSinceInsert
    : state.insertedThisTurn > 0 ? 1 : state.turnsSinceInsert + 1;
  return { turnId, sentences: 0, insertedThisTurn: 0, lastInsertedSentence: null, turnsSinceInsert };
}

function plain(text: string, state: CueState): CueResult {
  return { text, state, inserted: null };
}

/** The whole insertion policy. Returns the text to speak (the input with
 * at most one cue or filler added at a sentence boundary) and the new
 * state. With the gates closed it returns the input untouched. */
export function planVoiceCues(input: CueInput): CueResult {
  const { text, level, band } = input;
  const state = withState(input.state, input.turnId);
  const index = state.sentences;
  state.sentences = index + 1;

  // Gates, in order. Age first (chat rule 0); nothing below can reopen it.
  if (band !== "adult") return plain(text, state);
  if (level !== "light" && level !== "natural") return plain(text, state);
  if (input.blocked) return plain(text, state);
  const trimmed = text.trim();
  if (!trimmed || isProtectedSentence(trimmed)) return plain(text, state);

  const policy = input.choice !== undefined ? MODEL_POLICY : CUE_POLICIES[level];
  if (state.insertedThisTurn >= policy.maxPerTurn) return plain(text, state);
  if (state.lastInsertedSentence !== null && index - state.lastInsertedSentence < policy.minGapSentences) return plain(text, state);
  if (state.insertedThisTurn === 0 && state.turnsSinceInsert < policy.cooldownTurns) return plain(text, state);

  const roll = input.roll ?? seededRoll(`${input.turnId}:${index}`);
  const advertised = normalizeTagList(input.supportedTags);
  const advertisesTags = advertised.length > 0;
  const supported = advertised.filter((t) => (KNOWN_CUE_TAGS as readonly string[]).includes(t));

  const commit = (nextText: string, inserted: CueResult["inserted"]): CueResult => {
    state.insertedThisTurn += 1;
    state.lastInsertedSentence = index;
    state.turnsSinceInsert = 0;
    return { text: nextText, state, inserted };
  };

  // 0. The small model's own choice, when it gave one. It replaces the keyword rules and the chance roll; the gates above and the caps still apply.
  if (input.choice !== undefined) {
    const picked = input.choice;
    if (!picked || !picked.tag || !supported.includes(picked.tag)) return plain(text, state);
    if (picked.place === "after" && !endsSentence(trimmed)) return plain(text, state);
    return picked.place === "after" ? commit(`${trimmed} [${picked.tag}]`, { kind: "tag", name: picked.tag }) : commit(`[${picked.tag}] ${trimmed}`, { kind: "tag", name: picked.tag });
  }

  // 1. A nonverbal cue, only when the engine advertises the tag.
  if (supported.length > 0 && roll < policy.cueChance) {
    for (const trigger of TRIGGERS) {
      if (!trigger.pattern.test(trimmed)) continue;
      const name = trigger.tags.find((t) => supported.includes(t));
      if (!name) continue;
      if (trigger.place === "after") {
        if (!endsSentence(trimmed)) continue;
        return commit(`${trimmed} [${name}]`, { kind: "tag", name });
      }
      return commit(`[${name}] ${trimmed}`, { kind: "tag", name });
    }
    if (policy.allowOpenerTag && index === 0 && roll < 0.12 && trimmed.length >= 80) {
      const name = OPENER_TAGS.find((t) => supported.includes(t));
      if (name) return commit(`[${name}] ${trimmed}`, { kind: "tag", name });
    }
  }

  // 2. A spoken filler at the opener, plain text any engine can say, only
  // for an engine that advertises no tags (Pocket fallback). An engine that
  // honors tags gets the verified tags and no opener (owner ruling 2026-10-17).
  if (advertisesTags) return plain(text, state);
  if (index === 0 && trimmed.length >= 30 && !LEADING_FILLER.test(trimmed) && !trimmed.endsWith("?") && roll < policy.fillerChance) {
    const word = FILLERS[Math.floor(seededRoll(`${input.turnId}:filler`) * FILLERS.length)]!;
    const first = trimmed.split(/\s+/)[0]!.replace(/[^\w']/g, "");
    const body = LOWERCASE_SAFE.test(first) ? trimmed.charAt(0).toLowerCase() + trimmed.slice(1) : trimmed;
    return commit(`${word} ${body}`, { kind: "filler", word });
  }

  return plain(text, state);
}

const KNOWN_TAG_PATTERN = new RegExp(`\\s*\\[\\s*(?:${KNOWN_CUE_TAGS.map((t) => t.replace(" ", "\\s+")).join("|")})\\s*\\](?!\\()`, "gi");
const ANY_WORD_TAG_PATTERN = /\s*\[\s*[A-Za-z]+(?:\s+[A-Za-z]+){0,2}\s*\](?![(:])/g;

function tidy(text: string): string {
  return text.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?;:])/g, "$1").replace(/^\s+/, "");
}

/** Removes every known nonverbal tag from text that is shown or stored.
 * The composer inserts tags only into the spoken rendering, so this is the
 * guard for a model that wrote one on its own: a tag is never shown. */
export function stripCueTags(text: string): string {
  if (!text.includes("[")) return text;
  return tidy(text.replace(KNOWN_TAG_PATTERN, ""));
}

/** What may reach a speech engine: tags the engine advertises stay, every
 * other bracketed word tag is dropped, so an engine that does not honor a
 * tag never reads "[laugh]" aloud. Markdown links and numeric citations
 * are not tags and are left for the normalizer. */
export function sanitizeSpeechTags(text: string, supportedTags: readonly string[]): string {
  if (!text.includes("[")) return text;
  const supported = new Set(normalizeTagList(supportedTags));
  const out = text.replace(ANY_WORD_TAG_PATTERN, (match) => {
    const name = normalizeTagName(match);
    return supported.has(name) ? match : "";
  });
  return tidy(out);
}

// Per-person state across sentences and turns. In memory only: a restart
// resets the cooldown, which is harmless and keeps nothing about what
// anyone said.
const states = new Map<string, CueState>();
const MAX_TRACKED_PEOPLE = 500;

/** How many sentences of this turn have been planned so far for this person (0 for a new turn). */
export function sentenceIndexFor(personId: string, turnId: string): number {
  const state = states.get(personId);
  return state && state.turnId === turnId ? state.sentences : 0;
}

export function planForPerson(personId: string, input: Omit<CueInput, "state">): CueResult {
  const result = planVoiceCues({ ...input, state: states.get(personId) ?? freshCueState() });
  if (states.size >= MAX_TRACKED_PEOPLE && !states.has(personId)) states.delete(states.keys().next().value as string);
  states.set(personId, result.state);
  return result;
}

export function __resetVoiceCueStateForTests(): void {
  states.clear();
}
