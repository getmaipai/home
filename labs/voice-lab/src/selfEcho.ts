import { decideBackchannel, type BackchannelDecision } from "./backchannel";
// A person's interruption is judged on the words that are NOT the assistant's own: when the page's microphone hears her voice
// from the speakers, the recognizer writes her own words down, and those must never stop her.
const STOPPERS = new Set(["stop", "wait", "hold", "shut", "no", "nope", "hang", "enough", "quiet", "pause", "hey", "sorry", "excuse"]);
const FUNCTION = new Set("the a an of to and in on at as is was were be been are am it its that this these those there then than so but while with for from by or if not we you i he she they me him her them us my your his their our what who which when where how just very really about into over out up down too also can could would should will did does do had has have get got let lets said say says one".split(" "));
const words = (t: string) => t.toLowerCase().replace(/[^a-z'\s-]/g, " ").replace(/-/g, "").split(/\s+/).filter(Boolean);
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
export function judgeCutIn(heard: string, spoken: string, echoLikely = true): EchoVerdict {
  const hw = words(heard); if (!hw.length) return "unknown";
  const spokenWords = [...new Set(words(spoken))];
  // A short utterance with a stop word in it is a command ("wait, stop", "stop here"), even if her story happens to contain the same words.
  if (hw.length <= 3 && hw.some((w) => STOPPERS.has(w))) return decideBackchannel(heard) === "ack" ? "ack" : "interrupt";
  const resid = hw.filter((w) => !spokenWords.some((s) => near(w, s)));
  if (!resid.length) return "echo";
  if (decideBackchannel(resid.join(" ")) === "ack") return "ack";
  // A spoken "wait" or "stop" comes first (or right after one word like "okay" or "please") and has little else after it. The
  // recognizer's blur of her own voice sometimes writes "hold" or "no" in the middle of a sentence; that is not a command.
  const content = resid.filter((w) => w.length > 2 && !FUNCTION.has(w) && !STOPPERS.has(w));
  const stopAt = hw.findIndex((w) => STOPPERS.has(w) && resid.includes(w)), stoppers = resid.filter((w) => STOPPERS.has(w)).length;
  // At the start of a short utterance, or two stop words together ("wait, stop"), it is a command. A single stop word later in the text
  // counts only when the microphone does not look like her own voice (the envelope check); her blurred voice often writes "hold" or "no".
  if (stopAt >= 0 && ((stopAt <= 1 && content.length <= 1) || stoppers >= 2 || (!echoLikely && content.length <= 2))) return "interrupt";
  return content.length >= 3 ? "interrupt" : "echo";
}
