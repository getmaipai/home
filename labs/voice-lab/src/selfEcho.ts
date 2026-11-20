import { decideBackchannel, type BackchannelDecision } from "./backchannel";
// A person's interruption is judged on the words that are NOT the assistant's own: when the page's microphone hears her voice
// from the speakers, the recognizer writes her own words down, and those must never stop her.
const STOPPERS = new Set(["stop", "wait", "hold", "shut", "nope", "hang", "enough", "quiet", "pause"]);
const words = (t: string) => t.toLowerCase().replace(/[^a-z'\s-]/g, " ").replace(/-/g, "").split(/\s+/).filter(Boolean);
function near(a: string, b: string) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.length >= 5 && b.length >= 5 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let diff = 0; const m = Math.min(a.length, b.length); for (let i = 0; i < m && diff < 2; i++) if (a[i] !== b[i]) diff++; return diff < 2;
}
export type EchoVerdict = BackchannelDecision | "echo";
export function judgeCutIn(heard: string, spoken: string): EchoVerdict {
  const hw = words(heard); if (!hw.length) return "unknown";
  const spokenWords = [...new Set(words(spoken))];
  const resid: string[] = []; let echoCount = 0;
  for (const w of hw) { if (spokenWords.some((s) => near(w, s))) echoCount++; else resid.push(w); }
  if (echoCount === 0) return decideBackchannel(heard);
  if (!resid.length) return "echo";
  if (resid.some((w) => STOPPERS.has(w)) || (resid.length >= 1 && resid.join(" ").match(/\b(no way)\b/) === null && resid.some((w) => w === "no"))) return "interrupt";
  if (echoCount >= resid.length && resid.length < 3) return "echo";
  return decideBackchannel(resid.join(" "));
}
