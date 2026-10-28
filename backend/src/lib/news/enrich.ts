// Foreground News enrichment: one honest read of this story only. No picture bytes, link expansion or Archive traffic.
import { parseHTML } from "linkedom";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import type { AgeBand } from "@/lib/ageBand";
import { urlAllowedFor } from "@/lib/blocklists/hostLists";
import { pageHtml, PageDeclinedError } from "@/lib/packageHost";
import { extractFullArticle } from "@/lib/retrieval/extractArticle";
import { tripsMinorFloor } from "@/lib/retrieval/minorFloor";
import { feedImageAddress, isSiteArt } from "@/lib/shelf/imageAddress";
import { releaseShelfItem } from "@/lib/shelf/shelfRead";
import { sharedShelfStore, type ShelfItem, type ShelfStore } from "@/lib/shelf/shelfStore";
import { acceptArticleText } from "./contentQuality";
import { gateFor, inlineText } from "./childGate";
import type { Enrichment } from "./enrichmentStore";
import { newsHostQuiet, quietNewsHost, __resetNewsHostBackoffForTests } from "./hostBackoff";
import { bumpNewsCounter } from "./newsCounters";

export const ENRICHMENT_NONE_MS = 12 * 3_600_000;
let now = Date.now;
let generation = 0;
export function __setNewsEnrichClockForTests(clock: (() => number) | null): void { now = clock ?? Date.now; }
interface HostState { active: number; lastStart: number; tail: Promise<void>; waiters: Set<() => void> }
const hosts = new Map<string, HostState>();
// An item lock, rather than a band lock: simultaneous bands take turns and each keeps only its own guarded result.
const inFlight = new Map<string, Promise<Enrichment | null>>();
export function __resetNewsEnrichForTests(): void { generation++; hosts.clear(); inFlight.clear(); now = Date.now; __resetNewsHostBackoffForTests(); }

export function enrichmentFresh(value: Enrichment | null): boolean {
  return !!value && (value.status === "ok" || now() - value.at < ENRICHMENT_NONE_MS);
}

function plain(value: string): string {
  // Meta descriptions sometimes contain HTML or literal links. Neither belongs in a card's plain-text dek.
  const { document } = parseHTML(`<html><body>${value}</body></html>`);
  for (const node of document.querySelectorAll("script,style")) node.remove();
  return (document.body.textContent ?? "").replace(/https?:\S+/gi, "").replace(/\s+/g, " ").trim();
}

function extract(html: string, item: ShelfItem, band: AgeBand): Pick<Enrichment, "image_url" | "description"> {
  const { document } = parseHTML(html);
  const meta = (key: string): string[] => [...document.querySelectorAll("meta")]
    .filter((node) => (node.getAttribute("property") ?? node.getAttribute("name") ?? "").toLowerCase() === key)
    .map((node) => node.getAttribute("content") ?? "");
  // A site-wide logo or default share image is not this story's picture: the card shows the publisher tile instead.
  const siteImage = /(?:logo|favicon|sprite|placeholder|default[-_]?(?:image|share|og|social)|site[-_]?(?:image|share))/i;
  const image_url = [...meta("og:image"), ...meta("twitter:image")].map(feedImageAddress).find((address) => !!address && !siteImage.test(new URL(address).pathname) && !isSiteArt(address)) ?? null;
  let description = [...meta("og:description"), ...meta("description")].map(plain).find(Boolean) ?? null;
  if (!description) {
    const article = extractFullArticle(html, { book: "news", allowedBooks: new Set(), allowLinks: false, allowImages: false, mode: "news", baseUrl: item.canonical_url });
    const paragraphs = article.blocks.flatMap((block) => block.type === "paragraph" ? [plain(inlineText(block.inlines))] : []);
    if (acceptArticleText(paragraphs.join("\n\n"))) description = paragraphs.filter((p) => p.length >= 60).slice(0, 2).join("\n\n") || null;
  }
  if (description && band === "child") description = gateFor("child").text(description) || null;
  if (description && band !== "adult" && tripsMinorFloor(description)) description = null;
  return { image_url, description };
}

async function perHost<T>(host: string, deadlineAt: number, task: () => Promise<T>): Promise<T | null | undefined> {
  let state = hosts.get(host);
  if (!state) {
    state = { active: 0, lastStart: -Infinity, tail: Promise.resolve(), waiters: new Set() };
    hosts.set(host, state);
  }
  const slot = state;
  const admission = slot.tail.then(async () => {
    while (slot.active >= 2) await new Promise<void>((resolve) => slot.waiters.add(resolve));
    if (Date.now() >= deadlineAt) return "late";
    if (newsHostQuiet(host, now())) return "quiet";
    const delay = Math.max(0, slot.lastStart + 1000 - now());
    if (Date.now() + delay >= deadlineAt) return "late";
    if (delay) await Bun.sleep(delay);
    if (Date.now() >= deadlineAt) return "late";
    if (newsHostQuiet(host, now())) return "quiet";
    slot.active++;
    slot.lastStart = now();
    return "run";
  });
  slot.tail = admission.then(() => undefined);
  const admitted = await admission;
  if (admitted === "late") return undefined;
  if (admitted === "quiet") { bumpNewsCounter("enrichment_blocked"); return null; }
  try { return await task(); }
  catch (error) {
    if (error instanceof PageDeclinedError || (error instanceof HostError && error.code === "invalid_input")) {
      quietNewsHost(host, now());
      bumpNewsCounter("enrichment_blocked");
    }
    return null;
  } finally {
    slot.active--;
    for (const resolve of slot.waiters) resolve();
    slot.waiters.clear();
  }
}

/** One fetch per item in flight, with an independent persistent result per band. A failed cache or fetch never fails a card. */
export async function enrichItem(item: ShelfItem, band: AgeBand, options: { store?: ShelfStore | null; deadlineAt?: number } = {}): Promise<Enrichment | null> {
  const store = options.store === undefined ? sharedShelfStore() : options.store;
  const deadlineAt = options.deadlineAt ?? Infinity;
  const startedIn = generation;
  if (!store || !releaseShelfItem(band, item.id, store)) return null;
  try {
    const cached = store.getEnrichment(item.id, band);
    if (enrichmentFresh(cached)) return cached;
    const running = inFlight.get(item.id);
    if (running) {
      await running;
      if (startedIn !== generation) return null;
      return enrichItem(item, band, options);
    }
    if (Date.now() >= deadlineAt) return null;
    const next = (async (): Promise<Enrichment | null> => {
      let result: Pick<Enrichment, "image_url" | "description"> | null | undefined = null;
      const host = new URL(item.canonical_url).hostname.toLowerCase();
      if (!urlAllowedFor(band, item.canonical_url)) {
        bumpNewsCounter("enrichment_blocked");
      } else {
        result = await perHost(host, deadlineAt, async () => {
          bumpNewsCounter("enrichment_attempts");
          const page = await pageHtml(item.canonical_url, AbortSignal.timeout(10_000), band === "adult" ? undefined : band, { background: true });
          return extract(page.html, item, band);
        });
      }
      if (result === undefined) return null; // no page was attempted: leave it eligible for the next request
      const value: Enrichment = { image_url: result?.image_url ?? null, description: result?.description ?? null, status: result?.image_url || result?.description ? "ok" : "none", at: now() };
      if (startedIn !== generation) return null;
      bumpNewsCounter(value.status === "ok" ? "enrichment_ok" : "enrichment_none");
      try { store.putEnrichment(item.id, band, value); } catch { /* disposable cache */ }
      return value;
    })().finally(() => { if (inFlight.get(item.id) === next) inFlight.delete(item.id); });
    inFlight.set(item.id, next);
    return await next;
  } catch { return null; }
}
