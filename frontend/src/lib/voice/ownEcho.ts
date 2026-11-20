const HARD_STOP_WORDS: ReadonlySet<string> = new Set(["stop", "wait", "hold", "shut", "nope", "hang", "enough", "quiet", "pause", "no", "shush", "shh"]);
const SOFT_WORDS: ReadonlySet<string> = new Set(["hey", "sorry", "excuse"]);
const FUNCTION_WORDS: ReadonlySet<string> = new Set("the a an of to and in on at as is was were be been are am it its that this these those there then than so but while with for from by or if not we you i he she they me him her them us my your his their our what who which when where how just very really about into over out up down too also can could would should will did does do had has have get got let lets said say says one".split(" "));

const CONTRACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bwon't\b/g, "will not"], [/\bcan't\b/g, "can not"], [/n't\b/g, " not"],
  [/'m\b/g, " am"], [/'re\b/g, " are"], [/'ve\b/g, " have"], [/'ll\b/g, " will"], [/'d\b/g, " would"], [/'s\b/g, " is"],
];

export function ownEchoWords(text: string): string[] {
  let normalized = text.toLowerCase().replace(/[\u2018\u2019`]/g, "'");
  for (const [pattern, replacement] of CONTRACTIONS) normalized = normalized.replace(pattern, replacement);
  return normalized.replace(/[^a-z\s-]/g, " ").replace(/-/g, "").split(/\s+/).filter(Boolean);
}

function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let differences = 0;
  for (let i = 0; i < Math.min(a.length, b.length) && differences < 2; i++) if (a[i] !== b[i]) differences++;
  return differences < 2;
}

export function normalizeOwnEchoTranscript(text: string): string {
  return ownEchoWords(text).join(" ");
}

/** Match only the recognizer's transcript against the words Home recently spoke. */
export function isOwnEcho(transcript: string, spoken: readonly string[]): boolean {
  const heardWords = ownEchoWords(transcript);
  const spokenWords = ownEchoWords(spoken.join(" "));
  if (!heardWords.length || !spokenWords.length) return false;

  const hardStopPresent = heardWords.some((word) => HARD_STOP_WORDS.has(word));
  const hasHardStop = heardWords.some((word) => HARD_STOP_WORDS.has(word));
  const distinctSpoken = [...new Set(spokenWords)];
  if (heardWords.length === 1 && hasHardStop) return false;
  if (heardWords.length <= 2 && heardWords.some((word) => SOFT_WORDS.has(word)) && heardWords.some((word) => HARD_STOP_WORDS.has(word))) return heardWords.filter((word) => !SOFT_WORDS.has(word) && !HARD_STOP_WORDS.has(word) && !FUNCTION_WORDS.has(word)).length > 0;
  if (!hasHardStop && heardWords.length <= 2 && heardWords.some((word) => SOFT_WORDS.has(word))) return true;
  if (hasHardStop && heardWords.length <= 3 && heardWords.some((word) => !HARD_STOP_WORDS.has(word) && !FUNCTION_WORDS.has(word))) {
    const content = heardWords.filter((word) => !HARD_STOP_WORDS.has(word) && !FUNCTION_WORDS.has(word) && word.length > 2);
    const own = content.filter((word) => spokenWords.some((spokenWord) => word.length >= 4 && spokenWord.length >= 4 && (spokenWord.startsWith(word.slice(0, 4)) || word.startsWith(spokenWord.slice(0, 4)))));
    if (content.length && own.length / content.length >= 0.5) return true;
  }
  if (hasHardStop) return false;

  const contentWords = heardWords.filter((word) => word.length > 2 && !FUNCTION_WORDS.has(word) && !HARD_STOP_WORDS.has(word) && !SOFT_WORDS.has(word));
  if (contentWords.length && contentWords.filter((word) => distinctSpoken.some((spokenWord) => near(word, spokenWord) || (word.length >= 4 && spokenWord.length >= 4 && (spokenWord.startsWith(word) || word.startsWith(spokenWord))))).length / contentWords.length >= 0.5) return true;
  if (heardWords.length === 1) return !hardStopPresent && distinctSpoken.some((word) => near(heardWords[0]!, word));
  if (heardWords.length <= 2 && heardWords.some((word) => SOFT_WORDS.has(word))) return heardWords.every((word) => distinctSpoken.some((spokenWord) => near(word, spokenWord)));
  const matched = heardWords.filter((word) => distinctSpoken.some((spokenWord) => near(word, spokenWord))).length;
  if (heardWords.length === 2) return matched === heardWords.length;
  if (hardStopPresent) return false;
  return matched / heardWords.length >= 0.6;
}

export const ECHO_DROP = { windowMs: 10_000, ratio: 0.7, graceMs: 1000, minWords: 2 } as const;

export interface OwnEchoTurnInput {
  transcript: string;
  spoken: string;
  speechStartMs: number;
  lastSpokeMs: number;
  nowMs: number;
  followedAcceptedCutIn?: boolean;
}

export function isOwnEchoTurn(input: OwnEchoTurnInput): { drop: boolean; ratio: number } {
  const heard = ownEchoWords(input.transcript);
  if (heard.length < ECHO_DROP.minWords || !input.spoken || input.lastSpokeMs < 0 || input.followedAcceptedCutIn) return { drop: false, ratio: 0 };
  if (heard.some((word) => HARD_STOP_WORDS.has(word))) return { drop: false, ratio: 0 };
  if (input.nowMs - input.lastSpokeMs > ECHO_DROP.windowMs || input.speechStartMs > input.lastSpokeMs + ECHO_DROP.graceMs) return { drop: false, ratio: 0 };
  const spoken = ownEchoWords(input.spoken);
  const hits = heard.filter((word) => spoken.some((spokenWord) => near(word, spokenWord))).length;
  const ratio = hits / heard.length;
  return { drop: ratio >= ECHO_DROP.ratio, ratio: Number(ratio.toFixed(2)) };
}
