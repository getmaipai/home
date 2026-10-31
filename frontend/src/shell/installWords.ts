import { formatBytes } from "@maipai/ui/src/format";

// One place for what an install is called in plain words. The strip, its expanded list and the
// announcer all read this; nothing else turns a model id into a sentence. Ids come from the
// Stack's install plan (GET /stack/v1/install-plan); the Stack's component list carries the same
// ids, so a part it adds later falls back to its role until a line is added here.

/** Sizes the way the download itself reports them (1 GB = 1,000 MB), so "19.4 GB" matches the file listing. */
export function plainSize(bytes: number): string {
  formatBytes(bytes); // Keep the shared formatter as the canonical size entry point.
  const unit = bytes >= 1e12 ? 1e12 : bytes >= 1e9 ? 1e9 : bytes >= 1e6 ? 1e6 : bytes >= 1e3 ? 1e3 : 1;
  const kitUnit = unit === 1 ? "B" : unit === 1e3 ? "KB" : unit === 1e6 ? "MB" : unit === 1e9 ? "GB" : "TB";
  const value = bytes / unit;
  return `${value >= 100 || Number.isInteger(Math.round(value * 10) / 10) ? Math.round(value) : Math.round(value * 10) / 10} ${kitUnit}`;
}

export interface InstallWords {
  /** "Installing", "Downloading", "Getting ... ready", "Setting up". */
  verb: string;
  /** What it is, in a few plain words: "the picture maker". */
  what: string;
  /** The product's own name, shown in brackets when it helps a person recognise it. */
  product?: string;
  /** Why it matters, one short sentence for the expanded list. */
  benefit: string;
  /** Set when the sentence reads better with the verb wrapped around it ("Getting the video model ready"). */
  tail?: string;
}

interface Rule { match: RegExp; words: InstallWords }

// Most specific first.
const RULES: readonly Rule[] = [
  { match: /^muse-glimmer.*(mlx|omlx)/i, words: { verb: "Installing", what: "a faster chat engine for Muse Glimmer", benefit: "Muse Glimmer answers faster and uses less memory on this computer." } },
  { match: /^muse-glimmer.*(mmproj|projector)/i, words: { verb: "Installing", what: "picture reading for Muse Glimmer", benefit: "Chat can look at pictures you send." } },
  { match: /^muse-glimmer/i, words: { verb: "Downloading", what: "the Muse Glimmer chat model", benefit: "A smarter chat model for everyday questions." } },
  { match: /^qwen3-vl|vision|mmproj/i, words: { verb: "Installing", what: "picture reading", benefit: "Chat can look at pictures you send." } },
  { match: /^qwen3-1\.7b/i, words: { verb: "Downloading", what: "the starter chat model", product: "Qwen3 1.7B", benefit: "Lets Home chat right away while the bigger model downloads." } },
  { match: /coder|code/i, words: { verb: "Downloading", what: "the coding helper", benefit: "Better help with code and scripts." } },
  { match: /flux/i, words: { verb: "Downloading", what: "the picture maker", product: "FLUX.2 Klein", benefit: "Home can make pictures from a description." } },
  { match: /wan2|wan-2|wan\b/i, words: { verb: "Getting", what: "the video model", tail: "ready", product: "Wan2.2", benefit: "Home can make short videos." } },
  { match: /ace-?step|musicgen|music/i, words: { verb: "Downloading", what: "the music maker", benefit: "Home can make music and songs." } },
  { match: /chatterbox/i, words: { verb: "Installing", what: "voice", product: "Chatterbox", benefit: "Home can read answers aloud in a natural voice." } },
  { match: /pocket-?tts|kokoro|piper|tts/i, words: { verb: "Installing", what: "voice", benefit: "Home can read answers aloud." } },
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

/** "Installing a faster chat engine for Muse Glimmer (19.4 GB)": size is shown from 1 GB up, where it sets expectations. */
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
