// KS-05b: the `news` package's answer, read from the shelf instead of fetched
// live. While the shelf is on, asking for the news never reaches a publisher:
// the answer is whatever the poller already stored for this user type's lists.
// While the shelf is off, or its store cannot be opened, the package keeps its
// old live path (returns null). The result carries the headline list the minor
// floor (newsMinorFloor.ts) checks one by one, so a child still gets them
// through the model.
import type { PluginResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";
import type { AgeBand } from "@/lib/ageBand";
import { releaseShelfItems, visibleFeedIds } from "./shelfRead";
import { shelfEnabled } from "./shelfPolicy";
import { sharedShelfStore, type ShelfStore } from "./shelfStore";

const ADULT_HEADLINES = 5;
const MINOR_CANDIDATES = 12;

export const SHELF_EMPTY_TEXT =
  "I don't have any saved headlines for you yet. The news shelf fills up a little at a time, so try again in a while.";
export const SHELF_NO_LISTS_TEXT =
  "No news lists are turned on for you. Ask an admin to turn one on in Settings, under News shelf.";

function reply(text: string, headlines: string[]): PluginResult {
  return { reply: { text, speech: text }, data: { headlines }, actions: [] } as unknown as PluginResult;
}

/** Null when the live path should answer; otherwise the shelf's answer. */
export function shelfNewsResult(band: AgeBand, store: ShelfStore | null = sharedShelfStore()): PluginResult | null {
  if (!shelfEnabled() || !store) return null;
  if (visibleFeedIds(band).length === 0) return reply(SHELF_NO_LISTS_TEXT, []);
  const items = releaseShelfItems(band, band === "adult" ? ADULT_HEADLINES : MINOR_CANDIDATES, store);
  const headlines = items.map((item) => item.title.replace(/\s+/g, " ").trim()).filter((title) => title.length > 0);
  if (headlines.length === 0) return reply(SHELF_EMPTY_TEXT, []);
  // Keep a title's own ? or ! so a question still reads as one.
  const text = `Top headlines: ${headlines.map((title) => (/[.!?]$/.test(title) ? title : `${title}.`)).join(" ")}`;
  return reply(text, headlines);
}
