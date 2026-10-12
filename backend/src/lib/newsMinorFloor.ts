// MINOR-SEARCH-01g (design layer L4): the news package's headlines pass the same deterministic
// floor a minor's search pages do (checkSafety with isMinor), one headline at a time. A child
// never gets the raw list: the reply is handed to the model to retell in plain words.
import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";
import type { PluginResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";
import type { AgeBand } from "@/lib/ageBand";

export const NEWS_NONE_FOR_MINOR_TEXT =
  "I don't have any news that's right for you to read today. Ask a grown-up to read the news with you.";
export const NEWS_NONE_FOR_TEEN_TEXT =
  "None of today's headlines passed the filter on your profile. Try again later, or ask an adult in your home to read the news with you.";
const CHILD_NEWS_HINT =
  "retell these headlines for a child in simple, calm words, a sentence or two each, with no links and no graphic detail; if something is too scary, leave it out";
const TOP = 3;

/** Applies the minor floor to a news result. Adults get the package's reply without the extra candidate list. */
export function applyNewsMinorFloor(result: PluginResult, band: AgeBand): PluginResult {
  const raw = (result.data as Record<string, unknown> | undefined)?.headlines;
  if (band === "adult") {
    if (!Array.isArray(raw)) return result;
    const { headlines: _drop, ...rest } = result.data as Record<string, unknown>;
    return { ...result, data: rest } as PluginResult;
  }
  if (!Array.isArray(raw)) {
    // Fail closed: a headline reply with no list to check is withheld; the handler's own "none found" and error lines pass.
    return result.reply?.text.startsWith("Top headlines:") ? { ...result, reply: { text: band === "child" ? NEWS_NONE_FOR_MINOR_TEXT : NEWS_NONE_FOR_TEEN_TEXT } } : result;
  }
  if (raw.length === 0) return { ...result, data: { headlines: [] } } as PluginResult;
  const kept = raw.filter((h): h is string => typeof h === "string" && !checkSafety(h, { isMinor: true }).flagged).slice(0, TOP);
  if (kept.length === 0) {
    const none = band === "child" ? NEWS_NONE_FOR_MINOR_TEXT : NEWS_NONE_FOR_TEEN_TEXT;
    return { ...result, reply: { text: none, speech: none }, data: { headlines: [] } } as PluginResult;
  }
  const text = `Top headlines: ${kept.map((h) => h.replace(/[.!?\s]+$/, "")).join(". ")}.`;
  return {
    ...result,
    reply: { text, speech: text },
    data: { headlines: kept },
    ...(band === "child" ? { synthesis_hint: CHILD_NEWS_HINT } : {}),
  } as PluginResult;
}
