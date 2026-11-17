// MINOR-SEARCH-01g (design layer L4): the news package's headlines pass the same deterministic
// floor a minor's search pages do (checkSafety with isMinor), one headline at a time. A child
// never gets the raw list: the reply is handed to the model to retell in plain words.
import type { PluginResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";
import type { AgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import { checkText, surfaceActor } from "@/lib/filter/textGate";
import { NOTHING_SUITABLE_HINT } from "@/lib/filter/nothingSuitable";

// CONTENT-POLICY-02 (C10, chat rule 6): when nothing is left to show, no fixed line goes out (a fixed line is delivered with no model call, so
// the model never redirects). The result carries no headlines and this hint, and the model says so in its own words. The shared wording is
// `NOTHING_SUITABLE_HINT` (SEARCH-RATING-02); News adds its own clause about headlines.
const NOTHING_SUITABLE_NEWS_HINT = `${NOTHING_SUITABLE_HINT}, with no list of headlines`;
const CHILD_NEWS_HINT =
  "retell these headlines for a child in simple, calm words, a sentence or two each, with no links and no graphic detail; if something is too scary, leave it out";
const TOP = 3;

const nothingSuitable = (result: PluginResult): PluginResult => {
  const { reply: _reply, ...rest } = result;
  return { ...rest, data: { headlines: [] }, synthesis_hint: NOTHING_SUITABLE_NEWS_HINT } as PluginResult;
};

/** Applies the minor floor to a news result: each headline goes through the filter door (today's floor and, for a child or teen, the content
 * rules). Adults get the package's reply without the extra candidate list. */
export function applyNewsMinorFloor(result: PluginResult, band: AgeBand, actor: PersonRow = surfaceActor(band)): PluginResult {
  const raw = (result.data as Record<string, unknown> | undefined)?.headlines;
  if (band === "adult") {
    if (!Array.isArray(raw)) return result;
    const { headlines: _drop, ...rest } = result.data as Record<string, unknown>;
    return { ...result, data: rest } as PluginResult;
  }
  if (!Array.isArray(raw)) {
    // Fail closed: a headline reply with no list to check is withheld; the handler's own "none found" and error lines pass.
    return result.reply?.text.startsWith("Top headlines:") ? nothingSuitable(result) : result;
  }
  if (raw.length === 0) return { ...result, data: { headlines: [] } } as PluginResult;
  const kept = raw.filter((h): h is string => typeof h === "string" && !checkText({ surface: "news", actor, band, text: h, field: "title" }).held).slice(0, TOP);
  if (kept.length === 0) return nothingSuitable(result);
  const text = `Top headlines: ${kept.map((h) => h.replace(/[.!?\s]+$/, "")).join(". ")}.`;
  return {
    ...result,
    reply: { text, speech: text },
    data: { headlines: kept },
    ...(band === "child" ? { synthesis_hint: CHILD_NEWS_HINT } : {}),
  } as PluginResult;
}
