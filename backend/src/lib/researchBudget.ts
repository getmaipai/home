// RESEARCH-TIER-01 (owner ruling 2026-11-01): the page budget of one research run. A run is one message
// answered under Thinking or Max; every search of its rounds shares this budget: at most 40 pages read,
// at most 4 from one site, a site's pages at least 3 seconds apart, and the first refusal (403 or 429)
// ends page reading for the rest of the run. The run carries it through an AsyncLocalStorage so the page
// reader (packageHost.ts) can honor it without a new argument on every tool call.
import { AsyncLocalStorage } from "node:async_hooks";
import type { NoteStats, PageNote } from "@/lib/turnMachine/pageNotes";

export const RESEARCH_PAGES_MAX = 40;
export const RESEARCH_HOST_PAGES_MAX = 4;
export const RESEARCH_HOST_PACE_MS = 3_000;
export const RESEARCH_SEARCHES_MAX = 12;

export interface ResearchRunBudget {
  pages: number;
  perHost: Map<string, { pages: number; lastAt: number }>;
  /** Sites that refused a page this run: no more pages from them, the other sites are still read. */
  declinedHosts: Set<string>;
  /** The admin turned Max web research off (research.max_web): rounds after the first search the offline library only. */
  libraryOnly: boolean;
  /** Counts only, for the run's trace (rule 6a: no queries, URLs or titles in logs). */
  searches: number;
  /** RESEARCH-CLOCK-01: the moment (ms since the epoch) page reading stops for this turn. */
  deadlineAt?: number;
  /** RESEARCH-NOTES-01: set by the tool node; the page reader hands each page it reads (its whole text) to it, and it starts the page's notes. */
  noteJob?: (page: { url: string; title: string; text: string }) => void;
  /** RESEARCH-NOTES-01: the notes being written, one promise per page address. */
  notes: Map<string, Promise<PageNote[]>>;
  noteStats?: NoteStats;
}

const store = new AsyncLocalStorage<ResearchRunBudget>();

export function newResearchBudget(libraryOnly: boolean): ResearchRunBudget {
  return { pages: 0, perHost: new Map(), declinedHosts: new Set(), libraryOnly, searches: 0, notes: new Map() };
}
export const runWithResearchBudget = <T>(budget: ResearchRunBudget, fn: () => T): T => store.run(budget, fn);
export const currentResearchBudget = (): ResearchRunBudget | undefined => store.getStore();

/** Whether one more page from this host may be read now (the pace is waited out by `waitForHostPace`). */
export function researchPageAllowed(budget: ResearchRunBudget, host: string): boolean {
  if (budget.declinedHosts.has(host) || budget.pages >= RESEARCH_PAGES_MAX) return false;
  return (budget.perHost.get(host)?.pages ?? 0) < RESEARCH_HOST_PAGES_MAX;
}
/** Waits until this host's last page of the run is 3 seconds old (never longer than 3 seconds). */
export async function waitForHostPace(budget: ResearchRunBudget, host: string, now: () => number = Date.now): Promise<void> {
  const last = budget.perHost.get(host)?.lastAt;
  if (last === undefined) return;
  const wait = RESEARCH_HOST_PACE_MS - (now() - last);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(wait, RESEARCH_HOST_PACE_MS)));
}
export function notePageRead(budget: ResearchRunBudget, host: string, now: () => number = Date.now): void {
  budget.pages += 1;
  const entry = budget.perHost.get(host) ?? { pages: 0, lastAt: 0 };
  budget.perHost.set(host, { pages: entry.pages + 1, lastAt: now() });
}
/** A site refused a page: no more pages from that site this run. */
export function noteDeclined(budget: ResearchRunBudget, host: string): void { budget.declinedHosts.add(host); }

/** Sites no research run asks for pages: social, video and short-post hosts refuse bots, hold no article text, and (before this rule) one
 * refusal from them ended all page reading for the run (the live V runs: 8 searches, 29 sites listed, 2 pages read). */
const UNREADABLE_HOSTS = /(^|\.)(instagram|facebook|fb|youtube|youtu|tiktok|twitter|x|pinterest|linkedin|snapchat|threads|vimeo|dailymotion|twitch)\.(com|be|me|tv)$/i;
export const isUnreadableHost = (host: string): boolean => UNREADABLE_HOSTS.test(host.replace(/^www\./i, ""));
/** Characters of a page a research run keeps for the notes and the writer (the default search keeps 2,500). */
export const RESEARCH_PAGE_TEXT_CHARS = 8_000;
/** Pages one research search reads at once (all on different sites), within the run's 40. */
export const RESEARCH_PAGES_PER_SEARCH = 4;
/** The whole page-reading step of one research search gives up after this long and keeps what arrived. */
export const RESEARCH_PAGE_STEP_MS = 10_000;
