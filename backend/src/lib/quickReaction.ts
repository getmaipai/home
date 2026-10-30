// VOICE-QUICK-01: the quick lane. While the main model works out the answer, the small judge model Home already runs
// (Qwen3 4B, 70 to 230 ms for a few words, measured 2026-10-29) writes the short reaction a person who is listening
// would make: no fixed list, no answer, no advice, no facts. The main model stays the only one that answers (INSTANT-05:
// the 4B invented forecasts and scores when asked to answer). The reaction is spoken, never stored in the thread.
import { completeBackground, type LlmMessage } from "@/lib/llm";
import { topicMessagesForId } from "@/lib/topicPrompt";
import { KNOWN_CUE_TAGS, normalizeTagList } from "@/lib/voiceCues";

export const QUICK_REACTION_DEADLINE_MS = 700;
const MAX_WORDS = 6;
const RECENT_KEPT = 4;
const recent = new Map<string, string[]>();
let runner: typeof completeBackground = completeBackground;
export function __setQuickReactionRunnerForTests(fn: typeof completeBackground | null): void { runner = fn ?? completeBackground; }
export function __resetQuickReactionForTests(): void { recent.clear(); runner = completeBackground; }

const SYSTEM = [
  "You are the listening half of a voice assistant. The person just spoke. Reply with exactly one line in one of three forms.",
  "REACT: followed by one to six words a friend would say out loud right away, in the same mood, when the person shares sad or frustrating news, good news, or something surprising or exciting.",
  "ACK: followed by one or two words, only a natural thinking sound such as hmm, mm, well, okay, right or let's see, when the person asks a question, makes a request or asks for a story; never use any other word, never promise anything, never mention time, and do not use the same sound every time.",
  "NONE when the person only greeted you, said a plain okay or mm, or left a sentence unfinished.",
  "Never answer, advise, name an emotion, or repeat their words.",
].join(" ");

/** A thinking sound is the only thing an ACK may be: the small model's acknowledgments of a question guessed answers and echoed numbers ("Maybe tomorrow.", "Eight seventeen."). */
const THINKING_SOUND = /^(?:(?:hm+|mm+|mhm|um+|uh+|well|so|okay|ok|alright|right|yeah|let's see|let me see)[,.…]?\s*){1,2}$/i;

export interface QuickCue {
  text: string;
  /** A reaction to news is spoken the moment it is ready; a thinking sound only if the answer is not there yet. */
  immediate: boolean;
}

/** One line from the model ("REACT: Oh no.", "ACK: Hmm.", "NONE") to a cue, or null. */
export function parseQuickCue(raw: string, said: string, banned: readonly string[], lastFew: readonly string[], tags: readonly string[]): QuickCue | null {
  const line = raw.trim().split("\n")[0] ?? "";
  const match = line.match(/^(REACT|ACK)\s*:\s*(.+)$/i);
  if (!match) return null;
  if (match[1]!.toUpperCase() === "REACT") {
    const text = cleanReaction(match[2]!, said, banned, lastFew, tags);
    return text ? { text, immediate: true } : null;
  }
  const sound = match[2]!.trim();
  if (!THINKING_SOUND.test(sound)) return null;
  const lower = sound.toLowerCase();
  if (banned.some((phrase) => lower.includes(phrase.toLowerCase())) || lastFew.some((previous) => previous.toLowerCase() === lower)) return null;
  return { text: sound, immediate: false };
}

/** The same words back, or a mostly-copied phrase, is an echo, not a reaction. */
function echoes(reaction: string, said: string): boolean {
  const r = reaction.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  const s = new Set(said.toLowerCase().match(/[\p{L}']+/gu) ?? []);
  return r.length >= 3 && r.filter((w) => s.has(w)).length / r.length >= 0.6;
}

export function cleanReaction(raw: string, said: string, banned: readonly string[], lastFew: readonly string[], tags: readonly string[] = []): string | null {
  let text = raw.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "").replace(/\s+/g, " ");
  // VOICE-DELIVERY-01: one leading sound tag from the engine's own list is kept (it is not a word); any other bracket is dropped.
  let tag = "";
  const lead = text.match(/^\[\s*([A-Za-z ]+?)\s*\]\s*/);
  if (lead) {
    const name = lead[1]!.toLowerCase().replace(/\s+/g, " ");
    if (tags.includes(name)) tag = `[${name}] `;
    text = text.slice(lead[0].length);
  }
  if (!text || /^none\.?$/i.test(text)) return null;
  // The model sometimes names the sound instead of making it ("sigh"): that becomes the tag when the engine has it, else nothing.
  if ((KNOWN_CUE_TAGS as readonly string[]).includes(text.toLowerCase().replace(/[^a-z ]/g, "").trim())) {
    const name = text.toLowerCase().replace(/[^a-z ]/g, "").trim();
    return tags.includes(name) ? `[${name}]` : null;
  }
  if (!/^[\p{L}][\p{L}'’\-, .!?…]*$/u.test(text)) return null;
  const words = text.match(/[\p{L}']+/gu) ?? [];
  if (words.length === 0 || words.length > MAX_WORDS) return null;
  const lower = text.toLowerCase();
  if (banned.some((phrase) => lower.includes(phrase.toLowerCase()))) return null;
  if (lastFew.some((previous) => previous.toLowerCase() === lower)) return null;
  if (echoes(text, said)) return null;
  return `${tag}${text}`;
}

/** One short spoken reaction to `said`. null: the model chose to say nothing (or the text failed the checks), so no cue should play. undefined: the model was slow or unavailable, so the caller may use a fixed bridge phrase. Never throws. */
export async function quickReaction(personId: string, said: string, banned: readonly string[] = [], deadlineMs = QUICK_REACTION_DEADLINE_MS, soundTags: readonly string[] = [], earlier?: string): Promise<QuickCue | null | undefined> {
  const tags = normalizeTagList(soundTags).filter((tag) => (KNOWN_CUE_TAGS as readonly string[]).includes(tag));
  const heard = said.trim().slice(0, 400);
  if (!heard) return null;
  const lastFew = recent.get(personId) ?? [];
  const avoid = lastFew.length > 0 ? ` Recent reactions you already used, so say something different: ${lastFew.join(" / ")}.` : "";
  const sounds = tags.length > 0 ? ` You may begin with one real sound in square brackets when it truly fits, chosen only from ${tags.map((t) => `[${t}]`).join(" ")}, for example a sigh with sympathy or a laugh at something funny; most reactions need none.` : "";
  const messages: LlmMessage[] = topicMessagesForId(personId, [{ role: "system", content: SYSTEM + sounds + avoid }, { role: "user", content: earlier ? `Earlier, the assistant said: ${earlier.slice(-160)}\nThe person now says: ${heard}` : heard }]);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), deadlineMs);
  try {
    const result = await runner(messages, { max_tokens: 18, temperature: 0.9, thinking: false, dropReasoning: true, exactCeiling: true, signal: abort.signal });
    if (process.env.MAIPAI_DEBUG_QUICK === "1") console.log("[quick]", JSON.stringify({ heard: heard.slice(0, 60), ok: result.ok, text: result.ok ? result.text : null }));
    if (!result.ok) return undefined;
    const cue = parseQuickCue(result.text, heard, banned, lastFew, tags);
    if (cue) recent.set(personId, [...lastFew, cue.text].slice(-RECENT_KEPT));
    return cue;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
