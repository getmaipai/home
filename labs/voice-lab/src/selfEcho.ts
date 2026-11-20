import { decideBackchannel, type BackchannelDecision } from "./backchannel";
// A person's interruption is judged on the words that are NOT the assistant's own: when the page's microphone hears her voice
// from the speakers, the recognizer writes her own words down, and those must never stop her.
const STOPPERS = new Set(["stop", "wait", "hold", "shut", "nope", "hang", "enough", "quiet", "pause", "hey", "sorry", "excuse"]);
// Words that are common openers in her own replies ("Hey!", "I am so sorry", "excuse me"): they stop her only when they are NOT words she is saying right now.
const SOFT = new Set(["hey", "sorry", "excuse"]);
const FUNCTION = new Set("the a an of to and in on at as is was were be been are am it its that this these those there then than so but while with for from by or if not we you i he she they me him her them us my your his their our what who which when where how just very really about into over out up down too also can could would should will did does do had has have get got let lets said say says one".split(" "));
// Curly and straight apostrophes are the same, and contractions are two words ("I'm" and "I am" are the same speech): her written reply says "I’m", the recognizer writes "I'm" or "I am". Recorded self-stops: "I'm so sorry." vs "Oh, I am so sorry", "that I'm sorry" vs "that I’m sorry".
const CONTRACTIONS: Array<[RegExp, string]> = [[/\bwon't\b/g, "will not"], [/\bcan't\b/g, "can not"], [/n't\b/g, " not"], [/'m\b/g, " am"], [/'re\b/g, " are"], [/'ve\b/g, " have"], [/'ll\b/g, " will"], [/'d\b/g, " would"], [/'s\b/g, " is"]];
const words = (t: string) => { let x = t.toLowerCase().replace(/[\u2018\u2019`]/g, "'"); for (const [re, to] of CONTRACTIONS) x = x.replace(re, to); return x.replace(/[^a-z\s-]/g, " ").replace(/-/g, "").split(/\s+/).filter(Boolean); };
function near(a: string, b: string) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.length >= 5 && b.length >= 5 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let diff = 0; const m = Math.min(a.length, b.length); for (let i = 0; i < m && diff < 2; i++) if (a[i] !== b[i]) diff++; return diff < 2;
}
export type EchoVerdict = BackchannelDecision | "echo";
/** Only these, or three or more unrecognised words, count as a person asking her to stop. One or two stray words (a half-heard name, a
 * blur of her own voice) never do: a person who really wants her to stop says "wait" or "stop", or goes on talking, and the next check hears more. */
export function judgeCutIn(heard: string, spoken: string, echoLikely = true, playingNow = spoken, personLouder = false): EchoVerdict {
  const hw = words(heard); if (!hw.length) return "unknown";
  const spokenWords = [...new Set(words(spoken))];
  // A short utterance with a stop word in it is a command ("wait, stop", "stop here"), even if her story happens to contain the same words.
  // ...unless every word of it is in the phrase she is saying right now (her own "hold on" coming back from the speakers).
  // "no" alone is too common a blur of her own voice; "no, no" is a command.
  const strong = hw.some((w) => STOPPERS.has(w)) || hw.filter((w) => w === "no").length >= 2;
  if (hw.length <= 3 && strong) {
    const nowWords = [...new Set(words(playingNow))];
    const ownWords = hw.every((w) => nowWords.some((n) => near(w, n)));
    // Her own "Hey!" or "so sorry" coming back is echo even when the microphone level looks louder than her (early in a reply her echo level is not yet known); a hard command word still needs the loudness test.
    if (ownWords && (!personLouder || hw.every((w) => SOFT.has(w) || !STOPPERS.has(w)))) return "echo"; // unless the sound is clearly louder than her echo has been: then it is a person
    return decideBackchannel(heard) === "ack" ? "ack" : "interrupt";
  }
  const resid = hw.filter((w) => !spokenWords.some((s) => near(w, s)));
  if (!resid.length) return "echo";
  if (decideBackchannel(resid.join(" ")) === "ack") return "ack";
  // A spoken "wait" or "stop" comes first (or right after one word like "okay" or "please") and has little else after it. The
  // recognizer's blur of her own voice sometimes writes "hold" or "no" in the middle of a sentence; that is not a command.
  const content = resid.filter((w) => w.length > 2 && !FUNCTION.has(w) && !STOPPERS.has(w));
  const stopAt = hw.findIndex((w) => STOPPERS.has(w) && resid.includes(w)), stoppers = resid.filter((w) => STOPPERS.has(w)).length;
  // At the start of a short utterance, or two stop words together ("wait, stop"), it is a command. A single stop word later in the text
  // counts only when the microphone does not look like her own voice (the envelope check); her blurred voice often writes "hold" or "no".
  if (stopAt >= 0 && ((stopAt <= 1 && content.length <= 1) || stoppers >= 2)) return "interrupt";
  return content.length >= 3 ? "interrupt" : "echo";
}

/** The content words in what was heard that are NOT in what she has said (and are not stop words): per window these are 0 to 2 for her own garbled echo, and they pile up when a person talks over her with a new sentence. */
export function residualContent(heard: string, spoken: string): string[] {
  const spokenWords = [...new Set(words(spoken))];
  return [...new Set(words(heard).filter((w) => !spokenWords.some((s) => near(w, s)) && w.length > 2 && !FUNCTION.has(w) && !STOPPERS.has(w)))];
}
export const SUSTAINED = { windowMs: 4000, needWords: 6 };
/** A person who talks over her in a normal voice is heard in rolling 0.67 s windows with only one or two new words each, so no single window ever counts. Words that are new to her speech pile up over a few seconds: enough of them means a person is saying something, whatever the individual windows said. */
export function sustainedNewWords(history: Array<{ at: number; words: string[] }>, at: number, resid: string[], cfg = SUSTAINED): { interrupt: boolean; words: string[] } {
  history.push({ at, words: resid }); while (history.length && at - history[0]!.at > cfg.windowMs) history.shift();
  const all = [...new Set(history.flatMap((h) => h.words))]; return { interrupt: all.length >= cfg.needWords, words: all };
}

export const ECHO_DROP = { windowMs: 10_000, ratio: 0.7, graceMs: 1000, minWords: 2 };
/** Second layer behind the word matching: before a turn commits, a transcript that is mostly (70%+, fuzzy) made of words she said in the last 10 s, and that started while she was speaking (or within a second of it), is her own voice coming back, not a person. A person who repeats her last sentence after she has been quiet for more than a second still commits. */
export function isOwnEchoTurn(i: { transcript: string; spoken: string; speechStartMs: number; lastSpokeMs: number; nowMs: number }, cfg = ECHO_DROP): { drop: boolean; ratio: number } {
  const hw = words(i.transcript); if (hw.length < cfg.minWords || !i.spoken || i.lastSpokeMs < 0) return { drop: false, ratio: 0 };
  if (hw.some((w) => STOPPERS.has(w) && !SOFT.has(w))) return { drop: false, ratio: 0 };   // "wait", "stop": a command is never dropped, even if her story contains the same words (recorded: a person's "Wait, stop." was dropped with ratio 1)
  if (i.nowMs - i.lastSpokeMs > cfg.windowMs || i.speechStartMs > i.lastSpokeMs + cfg.graceMs) return { drop: false, ratio: 0 };
  const sw = [...new Set(words(i.spoken))]; const hit = hw.filter((w) => sw.some((x) => near(w, x))).length; const ratio = hit / hw.length;
  return { drop: ratio >= cfg.ratio, ratio: +ratio.toFixed(2) };
}
