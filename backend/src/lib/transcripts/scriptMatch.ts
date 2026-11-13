import { buildCues, CAPTION_HOLD_AFTER_LAST_WORD, CAPTION_LEAD_BEFORE_FIRST_WORD, CAPTION_MIN_DURATION } from "./cues";
import type { Segment } from "./store";

export type HeardWord = { text: string; start_s: number; end_s: number };
export type ScriptWord = HeardWord;

export function quotedLines(words: string): string[] {
  return [...words.matchAll(/[“"]([^”"]+)[”"]/g)].map((match) => match[1]!.trim()).filter(Boolean);
}

const token = (word: string) => word.toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, "");

/** Aligns script tokens to heard words by edit distance, retaining script spelling and the audio clock. */
export function matchScript(script: string, heard: HeardWord[]): ScriptWord[] {
  const words = script.trim().split(/\s+/).filter(Boolean);
  if (!words.length || !heard.length) return [];
  const n = words.length, m = heard.length;
  const score = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  const move = Array.from({ length: n + 1 }, () => Array<"match" | "script" | "heard">(m + 1).fill("script"));
  for (let i = 1; i <= n; i++) { score[i]![0] = i; move[i]![0] = "script"; }
  for (let j = 1; j <= m; j++) { score[0]![j] = j; move[0]![j] = "heard"; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const same = token(words[i - 1]!) === token(heard[j - 1]!.text);
    const choices = [score[i - 1]![j - 1]! + (same ? 0 : 1), score[i - 1]![j]! + 1, score[i]![j - 1]! + 1];
    const best = Math.min(...choices); score[i]![j] = best;
    move[i]![j] = choices[0] === best ? "match" : choices[1] === best ? "script" : "heard";
  }
  const aligned = new Map<number, HeardWord>();
  let i = n, j = m;
  while (i || j) {
    const step = move[i]![j]!;
    if (i && j && step === "match") { aligned.set(i - 1, heard[j - 1]!); i--; j--; }
    else if (i && (!j || step === "script")) i--;
    else j--;
  }
  const out: ScriptWord[] = [];
  for (let k = 0; k < n; k++) {
    const heardWord = aligned.get(k);
    if (heardWord) out.push({ text: words[k]!, start_s: heardWord.start_s, end_s: heardWord.end_s });
    else {
      let before = k - 1; while (before >= 0 && !aligned.has(before)) before--;
      let after = k + 1; while (after < n && !aligned.has(after)) after++;
      const left = before >= 0 ? aligned.get(before)!.end_s : after < n ? aligned.get(after)!.start_s : 0;
      const right = after < n ? aligned.get(after)!.start_s : left;
      const count = after < n ? after - before : 1;
      const start_s = left + ((right - left) * (k - before)) / count;
      out.push({ text: words[k]!, start_s, end_s: start_s });
    }
  }
  return out;
}

export function scriptCaptionCues(words: readonly ScriptWord[]) {
  if (!words.length) return [];
  const segments: Segment[] = [];
  let group: ScriptWord[] = [];
  const flush = () => {
    const first = group[0]!, last = group[group.length - 1]!;
    segments.push({ id: `script-${segments.length + 1}`, text: group.map((word) => word.text).join(" "), start: Math.max(0, first.start_s - CAPTION_LEAD_BEFORE_FIRST_WORD), end: last.end_s + CAPTION_HOLD_AFTER_LAST_WORD });
    group = [];
  };
  for (const word of words) {
    if (group.length && `${group.map((item) => item.text).join(" ")} ${word.text}`.length > 42) flush();
    group.push(word);
  }
  flush();
  const cues = buildCues(segments, { maxCharsPerLine: 42, maxLines: 1, minDuration: CAPTION_MIN_DURATION });
  const lastWordEnd = words[words.length - 1]!.end_s + CAPTION_HOLD_AFTER_LAST_WORD;
  const lastCue = cues[cues.length - 1];
  if (lastCue) {
    if (lastCue.start + CAPTION_MIN_DURATION > lastWordEnd && cues.length > 1) lastCue.start = lastWordEnd - CAPTION_MIN_DURATION;
    lastCue.end = Math.max(lastCue.start + CAPTION_MIN_DURATION, lastWordEnd);
  }
  return cues;
}
