// RESEARCH-TIER-01 (owner ruling 2026-11-01): the page budget of one research run. A run is one message
// answered under Thinking or Max; every search of its rounds shares this budget: at most 40 pages read,
// at most 4 from one site, a site's pages at least 3 seconds apart, and the first refusal (403 or 429)
// ends page reading for the rest of the run. The run carries it through an AsyncLocalStorage so the page
// reader (packageHost.ts) can honor it without a new argument on every tool call.
import { AsyncLocalStorage } from "node:async_hooks";

export const RESEARCH_PAGES_MAX = 40;
export const RESEARCH_HOST_PAGES_MAX = 4;
export const RESEARCH_HOST_PACE_MS = 3_000;
export const RESEARCH_SEARCHES_MAX = 12;

export interface ResearchRunBudget {
  pages: number;
  perHost: Map<string, { pages: number; lastAt: number }>;
  /** A site refused a page: no more pages this run, the answer goes on with what it has. */
  declined: boolean;
  /** The admin turned Max web research off (research.max_web): rounds after the first search the offline library only. */
  libraryOnly: boolean;
  /** Counts only, for the run's trace (rule 6a: no queries, URLs or titles in logs). */
  searches: number;
}

const store = new AsyncLocalStorage<ResearchRunBudget>();

export function newResearchBudget(libraryOnly: boolean): ResearchRunBudget {
  return { pages: 0, perHost: new Map(), declined: false, libraryOnly, searches: 0 };
}
export const runWithResearchBudget = <T>(budget: ResearchRunBudget, fn: () => T): T => store.run(budget, fn);
export const currentResearchBudget = (): ResearchRunBudget | undefined => store.getStore();

/** Whether one more page from this host may be read now (the pace is waited out by `waitForHostPace`). */
export function researchPageAllowed(budget: ResearchRunBudget, host: string): boolean {
  if (budget.declined || budget.pages >= RESEARCH_PAGES_MAX) return false;
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
export function noteDeclined(budget: ResearchRunBudget): void { budget.declined = true; }
