// IVY-CHECK-01: a plain-words check of a video prompt before any GPU time is spent. Pure code, no model, no network.
// Each finding says what is wrong and, when one safe edit mends it, carries the whole mended prompt in `fix`.
// Ideas (not code) from public open-source video studios: dialogue pace caps, no negatives the model cannot read,
// one camera move per shot. It never blocks a render by itself; the Create page decides what to do with an error.

export type PromptFinding = { code: string; level: "error" | "warn" | "info"; message: string; fix: string | null };

const SPEECH_WORDS_PER_SECOND = 2.5;
const FILLER = /\b(very|really|extremely|incredibly|beautiful|stunning|amazing|masterpiece|4k|8k|ultra[- ]?hd|highly detailed)\b/gi;
const CAMERA_MOVES = /\b(dolly|push[- ]in|pull[- ]back|pan(?:s|ning)?|tilt(?:s|ing)?|orbit(?:s|ing)?|arc(?:s|ing)?|tracking shot|track(?:s|ing)? (?:left|right|alongside)|handheld|zoom(?:s|ing)?|crane|whip pan|truck(?:s|ing)? (?:left|right))\b/gi;
const NEGATIVES = /\b(?:no|not|without|never|avoid)\s+(?:any\s+)?(?:blur(?:ry)?|noise|artifacts?|distortion|watermarks?|text|extra (?:fingers|limbs)|bad (?:hands|anatomy)|low quality|jitter|flicker(?:ing)?)\b[,.]?/gi;
const QUOTED = /["“]([^"”]*)["”]/g;

function wordCount(text: string): number { return (text.match(/[\p{L}\p{N}']+/gu) ?? []).length; }

export function checkVideoPrompt(prompt: string, opts: { seconds?: number } = {}): PromptFinding[] {
  const findings: PromptFinding[] = [];
  const text = prompt.trim();
  if (!text) return findings;
  const seconds = opts.seconds && opts.seconds > 0 ? opts.seconds : null;

  if (text.length > 1200) findings.push({ code: "too_long", level: "error", message: `The prompt is ${text.length} characters; a video prompt holds at most 1200. Cut the least important details.`, fix: null });

  const lines = [...text.matchAll(QUOTED)].map((m) => m[1] ?? "");
  if (seconds && lines.length > 0) {
    const spoken = lines.reduce((sum, line) => sum + wordCount(line), 0);
    const room = Math.floor(seconds * SPEECH_WORDS_PER_SECOND);
    if (spoken > room) findings.push({ code: "dialogue_too_long", level: "error", message: `The spoken words (${spoken}) are more than fit in ${seconds} seconds (about ${room}). Shorten the lines or make the clip longer.`, fix: null });
  }
  if (lines.some((line) => /\.{2,}|…/.test(line))) {
    const fixed = text.replace(QUOTED, (whole, inner: string) => whole.replace(inner, inner.replace(/(\.{2,}|…)\s*$/, ".").replace(/\.{2,}|…/g, ",")));
    findings.push({ code: "dialogue_ellipsis", level: "warn", message: "Dots inside a spoken line make the voice stumble. Use a comma or a full stop.", fix: fixed });
  }

  const neg = text.match(NEGATIVES);
  if (neg) findings.push({ code: "unanchored_negative", level: "warn", message: `The model cannot read "${neg[0].replace(/[,.]$/, "")}". Describe what you want to see instead.`, fix: tidy(text.replace(NEGATIVES, "")) });

  const filler = text.match(FILLER);
  if (filler) findings.push({ code: "filler_words", level: "info", message: `Words like "${filler[0]}" add nothing the model can show.`, fix: tidy(text.replace(FILLER, "")) });

  const moves = new Set((text.replace(QUOTED, " ").match(CAMERA_MOVES) ?? []).map((m) => m.toLowerCase().split(/\s+/)[0]!.replace(/(?:ning|ing|s)$/, "")));
  if (moves.size > 1) findings.push({ code: "many_camera_moves", level: "warn", message: `Several camera moves (${[...moves].join(", ")}) in one clip tend to blur together. Pick one.`, fix: null });

  const order = { error: 0, warn: 1, info: 2 } as const;
  return findings.sort((a, b) => order[a.level] - order[b.level]);
}

function tidy(text: string): string {
  const out = text.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/^[\s,.]+/, "").trim().replace(/,+$/, "");
  return out && !/[.!?"\u201D]$/.test(out) ? `${out}.` : out;
}
