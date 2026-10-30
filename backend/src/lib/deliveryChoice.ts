// VOICE-DELIVERY-01: the small judge model (Qwen3 4B, already running) decides how a sentence is delivered: a laugh, a sigh, a gasp
// or nothing, and whether the sound comes before or after the words. It replaces the keyword lists in voiceCues.ts (a regex over the
// reply caught almost nothing, so people almost never heard a cue). It only picks from the tags the speech engine advertises and it
// never writes words; the sentence is not changed. A slow or unavailable model means "no opinion" and the old rules decide.
import { completeBackground, type LlmMessage } from "@/lib/llm";
import { KNOWN_CUE_TAGS, normalizeTagList } from "@/lib/voiceCues";

export interface DeliveryChoice { tag: string | null; place: "before" | "after" }
export const DELIVERY_DEADLINE_MS = 250;

/** Reads the model's one-line answer ("sigh after", "laugh before", "none"). Anything else is no tag. */
export function parseDelivery(raw: string, allowed: readonly string[]): DeliveryChoice {
  const words = raw.toLowerCase().replace(/[^a-z ]/g, " ").trim().split(/\s+/).filter(Boolean);
  const text = words.join(" ");
  const tag = allowed.find((candidate) => text.startsWith(candidate)) ?? null;
  if (!tag) return { tag: null, place: "after" };
  return { tag, place: text.slice(tag.length).trim().startsWith("before") ? "before" : "after" };
}

function systemPrompt(allowed: readonly string[]): string {
  return [
    "You choose how one sentence of a friendly voice assistant is spoken aloud. Choose one sound a real person might make while saying it, or none.",
    `Sounds available: ${allowed.join(", ")}.`,
    "Use a sound only when it truly fits what the sentence means and how the person was feeling: a laugh after something actually funny, a sigh with sympathy or weariness, a gasp before real surprise, a cough or clear throat only to start a long explanation. Most sentences get none.",
    "Answer with only the sound and where it goes, for example 'sigh after' or 'gasp before', or the single word none.",
  ].join(" ");
}

/** The choice for one sentence, or undefined when the model gave no answer in time (the caller then uses the old rules). Never throws. */
export async function chooseDelivery(sentence: string, said: string | undefined, supportedTags: readonly string[], deadlineMs = DELIVERY_DEADLINE_MS): Promise<DeliveryChoice | undefined> {
  const allowed = normalizeTagList(supportedTags).filter((tag) => (KNOWN_CUE_TAGS as readonly string[]).includes(tag));
  if (allowed.length === 0) return undefined;
  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt(allowed) },
    { role: "user", content: `${said ? `The person had just said: ${said.slice(0, 200)}\n` : ""}The sentence to speak: ${sentence.slice(0, 400)}` },
  ];
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), deadlineMs);
  try {
    const result = await runner(messages, { max_tokens: 6, temperature: 0.2, thinking: false, dropReasoning: true, exactCeiling: true, signal: abort.signal });
    return result.ok ? parseDelivery(result.text, allowed) : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

let runner: typeof completeBackground = completeBackground;
export function __setDeliveryRunnerForTests(fn: typeof completeBackground | null): void { runner = fn ?? completeBackground; }
