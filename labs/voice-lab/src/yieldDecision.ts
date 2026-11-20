import { decideBackchannel } from "./backchannel";
// Reference-based cut-in (behind the `echoReference` setting, off by default). Here the page's microphone has been through the browser's echo
// canceller, with her playback as its reference, so what is left in it is the person. The DEVICE says whether a person is overlapping her
// (sustained energy above the residual floor); recognised words only help decide whether to yield, never whether it is her own echo.
// No speaker-identity gate: the voice may be a clone of the person talking.
export type YieldInput = { overlapMs: number; words: string; heardAnything: boolean };
export type YieldVerdict = "continue" | "yield";
export const YIELD = { minOverlapMs: 250, certainMs: 650 };
export function decideYield(i: YieldInput): YieldVerdict {
  if (i.overlapMs < YIELD.minOverlapMs) return "continue";           // nothing human is overlapping her: echo residue or noise
  if (i.overlapMs >= YIELD.certainMs) return "yield";                // a person is clearly talking over her, whatever the words
  const verdict = decideBackchannel(i.words);                         // a short overlap: words only help
  if (verdict === "ack") return "continue";                           // "mm-hm", "yeah", "right": keep going
  return "yield";                                                     // "Thursday?" (the repeated word is the point), "yeah, actually...", "stop"
}
