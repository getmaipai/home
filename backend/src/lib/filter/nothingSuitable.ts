/**
 * C10 and chat rule 6: when the filter left nothing to show, no fixed line goes out (a fixed line is delivered with no model call, so the
 * model never redirects). The result carries no list and this hint, and the model says so in its own words. The one definition, used by
 * News (`newsMinorFloor.ts`, which appends its own "with no list of headlines" clause) and by web search (`floorSearchResult`, the ddgs
 * source). It names no age, role, rule, rating, filter or profile.
 */
export const NOTHING_SUITABLE_HINT =
  "there is nothing suitable to share right now; say that in a sentence of your own and offer something else to talk about or look up";
