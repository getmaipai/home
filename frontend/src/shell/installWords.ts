import { formatBytes } from "@maipai/ui/src/format";
import { formatUnit } from "@/lib/format";

// One place for what an install is called in plain words. The strip, its expanded list and the
// announcer all read this; nothing else turns a model id into a sentence. Ids come from the
// Stack's install plan (GET /stack/v1/install-plan); the Stack's component list carries the same
// ids, so a part it adds later falls back to its role until a line is added here.
// MODELS-FROM-STACK-01 (2026-11-22): the lines say what a part does, never which product it is. A model's name, size and description come
// from the Stack's parts list (it knows each model, Home keeps no name for one), so no rule here carries a product name.

/** Sizes the way the download itself reports them (1 GB = 1,000 MB), so "19.4 GB" matches the file listing. */
export function plainSize(bytes: number): string {
  formatBytes(bytes); // Keep the shared formatter as the canonical size entry point.
  const unit = bytes >= 1e12 ? 1e12 : bytes >= 1e9 ? 1e9 : bytes >= 1e6 ? 1e6 : bytes >= 1e3 ? 1e3 : 1;
  const name = unit === 1 ? "byte" : unit === 1e3 ? "kilobyte" : unit === 1e6 ? "megabyte" : unit === 1e9 ? "gigabyte" : "terabyte";
  const value = bytes / unit;
  return formatUnit(value, name, { maximumFractionDigits: value >= 100 ? 0 : 1 });
}

export interface InstallWords {
  /** "Installing", "Downloading", "Getting ... ready", "Setting up". */
  verb: string;
  /** What it is, in a few plain words: "the picture maker". */
  what: string;
  /** The product's own name, shown in brackets. Rules in this file never set it; a caller that holds the Stack's own label for the part may. */
  product?: string;
  /** Why it matters, one short sentence for the expanded list. */
  benefit: string;
  /** Set when the sentence reads better with the verb wrapped around it ("Getting the video model ready"). */
  tail?: string;
}

interface Rule { match: RegExp; words: InstallWords }

// Most specific first.
const RULES: readonly Rule[] = [
  { match: /^qwen3-vl|vision|mmproj/i, words: { verb: "Installing", what: "picture reading", benefit: "Chat can look at pictures you send." } },
  { match: /coder|code/i, words: { verb: "Downloading", what: "the coding helper", benefit: "Better help with code and scripts." } },
  { match: /flux/i, words: { verb: "Downloading", what: "the picture maker", benefit: "Home can make pictures from a description." } },
  { match: /wan2|wan-2|wan\b/i, words: { verb: "Getting", what: "the video model", tail: "ready", benefit: "Home can make short videos." } },
  { match: /ace-?step|musicgen|music/i, words: { verb: "Downloading", what: "the music maker", benefit: "Home can make music and songs." } },
  { match: /chatterbox|voxcpm|pocket-?tts|kokoro|piper|tts/i, words: { verb: "Installing", what: "voice", benefit: "Home can read answers aloud." } },
  { match: /moonshine|whisper|parakeet|silero|stt|vad/i, words: { verb: "Installing", what: "speech listening", benefit: "Home can understand what you say out loud." } },
  { match: /embed|bge|minilm|nomic/i, words: { verb: "Installing", what: "memory search", benefit: "Home can find the right memories and files when you ask." } },
  { match: /ddgs|searx|search/i, words: { verb: "Setting up", what: "web search", benefit: "Home can look things up on the web when you ask." } },
  { match: /rmbg|birefnet|lama|upscal|real-?esrgan|image-?tools|onnx/i, words: { verb: "Installing", what: "editing tools", benefit: "Remove a background, erase an object or sharpen a picture." } },
];

const BY_ROLE: Record<string, InstallWords> = {
  chat: { verb: "Downloading", what: "a chat model", benefit: "A model for chat on this computer." },
  stt: { verb: "Installing", what: "speech listening", benefit: "Home can understand what you say out loud." },
  tts: { verb: "Installing", what: "voice", benefit: "Home can read answers aloud." },
  embed: { verb: "Installing", what: "memory search", benefit: "Home can find the right memories and files when you ask." },
  image: { verb: "Downloading", what: "the picture maker", benefit: "Home can make pictures from a description." },
  video: { verb: "Getting", what: "the video model", tail: "ready", benefit: "Home can make short videos." },
  music: { verb: "Downloading", what: "the music maker", benefit: "Home can make music and songs." },
  vision: { verb: "Installing", what: "picture reading", benefit: "Chat can look at pictures you send." },
  code: { verb: "Downloading", what: "the coding helper", benefit: "Better help with code and scripts." },
};

const GENERIC: InstallWords = { verb: "Downloading", what: "a part of your AI", benefit: "Part of what Home needs to do its job." };

/** Plain words for one install, from the model/component id and, when the id is new, its role. */
export function installWords(input: { id?: string | null; role?: string | null }): InstallWords {
  const id = input.id ?? "";
  const hit = RULES.find((rule) => rule.match.test(id));
  if (hit) return hit.words;
  return (input.role ? BY_ROLE[input.role] : undefined) ?? GENERIC;
}

/** "Downloading the picture maker (16 GB)": size is shown from 1 GB up, where it sets expectations. */
export function installLabel(words: InstallWords, totalBytes?: number | null): string {
  const size = totalBytes && totalBytes >= 1e9 ? plainSize(totalBytes).replace(" ", "\u00a0") : null;
  const inside = [words.product, size].filter(Boolean).join(", ");
  const core = words.tail ? `${words.verb} ${words.what} ${words.tail}` : `${words.verb} ${words.what}`;
  return inside ? `${core} (${inside})` : core;
}

/** "about 7 min left" for the strip's second line; null when there is no honest number. */
export function timeLeft(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 90) return "less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} min left`;
  return `about ${Math.round(seconds / 360) / 10} hr left`;
}

export function speedLine(bytesPerSecond: number | null | undefined): string | null {
  return bytesPerSecond && bytesPerSecond > 0 ? `${plainSize(bytesPerSecond)}/s` : null;
}
