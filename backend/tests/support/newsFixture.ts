import { setHouseholdSettingValue } from "@/lib/settings";
// NEWS-02 test support: the news package installed as an app (its pages and data declared over the bundled package, as the
// apps test does for remind), a shelf seeded with feeds and items, and a localhost fixture server standing in for a
// publisher's picture host and article pages. Nothing here reaches a real network address (docs/THIRD-PARTY-SERVICES.md).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { packageInstalls } from "@/db/schema";
import { PACKAGES_DIR, cacheDir, installedPackageVersionDir } from "@/lib/paths";
import { __resetAppCachesForTests } from "@/lib/apps";
import { __resetPackageCachesForTests } from "@/lib/plugins";
import { __resetSharedShelfStoreForTests, sharedShelfStore } from "@/lib/shelf/shelfStore";
import { __resetSharedFetchCacheForTests } from "@/lib/retrieval/fetchCache";
import { createFeed } from "@/lib/shelf/feedStore";
import { NewsItem } from "@maipai/spec/gen/ts/news-item.js";
import type { AgeBand } from "@/lib/ageBand";
import { __setNewsPictureDepsForTests, __resetNewsPicturesForTests, newsPictureDir } from "@/lib/news/pictures";
import { __resetNewsArticleForTests } from "@/lib/news/article";
import { __resetNewsEnrichForTests } from "@/lib/news/enrich";
import { __setPageFetchForTests, type AttemptResult } from "@/lib/packageHost";
import { __setListsReadyForTests } from "@/lib/blocklists/listStore";

export const NEWS_VERSION = "9.9.9";
const SPEC_PAGES = join(import.meta.dir, "..", "..", "node_modules", "@maipai", "spec", "ui", "pages");
const specPage = (name: string): unknown => JSON.parse(readFileSync(join(SPEC_PAGES, name), "utf-8"));

const mixPage = {
  type: "page", id: "news-mix", title: "My Mix",
  body: [{
    type: "answer_blocks", bind: { source: "package", path: "mix" }, kinds: ["story_feed"],
    actions: {
      reset_mix: { confirm: { prompt: "Reset My Mix?", on_confirm: { call: { target: "/api/plugins/news/actions/reset_mix" } } } },
      feedback: { call: { target: "/api/plugins/news/actions/feedback" } },
    },
  }],
};
const channelPage = {
  type: "page", id: "news-channel", title: "Channel",
  body: [{ type: "answer_blocks", bind: { source: "package", path: "channel", params: { kind: "$state.kind", key: "$state.key" } }, kinds: ["story_feed"], actions: { follow: { call: { target: "/api/plugins/news/actions/follow" } } } }],
};
const savedPage = {
  type: "page", id: "news-saved", title: "Saved",
  body: [{ type: "list", bind: { source: "package", path: "saved" }, item_key_field: "key", item_label_field: "label", row_action: { icon: "chevron-right", label: "Open {label}", action: { call: { target: "/api/plugins/news/actions/read" } } } }],
};

export interface NewsAppOptions { pageRoles?: Record<string, string> }

/** Installs the news package as an app: index (Today), following, channel, saved, story at the package floor (child) and mix at teen unless told otherwise. */
export function installNewsApp(options: NewsAppOptions = {}): void {
  const dir = installedPackageVersionDir("news", NEWS_VERSION);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, ".."), { recursive: true });
  cpSync(join(PACKAGES_DIR, "news"), dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8"));
  manifest.version = NEWS_VERSION;
  manifest.returns_blocks = ["story_feed", "article"];
  const roles = { mix: "teen", ...(options.pageRoles ?? {}) };
  const page = (id: string, module: string) => ({ id, label: id, icon: "newspaper", nav: !["channel", "story", "search"].includes(id), kind: "schema", module, ...(roles[id as keyof typeof roles] ? { min_role: roles[id as keyof typeof roles] } : {}) });
  manifest.contributes = {
    ...manifest.contributes,
    pages: [page("index", "news-today"), page("following", "news-following"), page("mix", "news-mix"), page("channel", "news-channel"), page("saved", "news-saved"), page("story", "news-story"), page("search", "news-search")],
    data: [
      { id: "today" }, { id: "mix" }, { id: "channel" }, { id: "story" }, { id: "household-today" },
      { id: "topics", rows: "list" }, { id: "sources", rows: "list" }, { id: "saved", rows: "list" }, { id: "search" }, { id: "search-recents", rows: "list" },
    ],
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  mkdirSync(join(dir, "pages"), { recursive: true });
  const docs: Record<string, unknown> = {
    "news-today": specPage("news-today.json"), "news-following": specPage("news-following.json"), "news-story": specPage("news-story.json"),
    "news-mix": mixPage, "news-channel": channelPage, "news-saved": savedPage,
    "news-search": JSON.parse(readFileSync(join(PACKAGES_DIR, "news", "pages", "search.json"), "utf-8")),
  };
  // The fixture story page also lists the household-today id and the read action so every id and action is owned by a page.
  for (const [module, doc] of Object.entries(docs)) writeFileSync(join(dir, "pages", `${module}.json`), JSON.stringify(doc));
  db.delete(packageInstalls).where(eq(packageInstalls.packageId, "news")).run();
  db.insert(packageInstalls).values({ packageId: "news", version: NEWS_VERSION, previousVersion: null, channel: "stable", sourceCommit: "test", permissions: "[]", installedAt: "2026-10-17T00:00:00.000Z" }).run();
  __resetPackageCachesForTests();
  __resetAppCachesForTests();
}

export function removeNewsApp(): void {
  rmSync(installedPackageVersionDir("news", NEWS_VERSION), { recursive: true, force: true });
  db.delete(packageInstalls).where(eq(packageInstalls.packageId, "news")).run();
  __resetPackageCachesForTests();
  __resetAppCachesForTests();
}

/** A clean shelf, picture cache and article memory for a test. */
export function resetNewsState(): void {
  __resetSharedShelfStoreForTests();
  __resetSharedFetchCacheForTests();
  for (const name of ["knowledge.db", "knowledge.db-wal", "knowledge.db-shm"]) rmSync(join(cacheDir, name), { force: true });
  rmSync(newsPictureDir(), { recursive: true, force: true });
  __resetNewsPicturesForTests();
  __resetNewsArticleForTests();
  __resetNewsEnrichForTests();
  __setListsReadyForTests(true);
}

// ---- Fixture publisher server (localhost only) ---------------------------------------------------

export interface Publisher {
  port: number;
  /** Every request path the server received, in order. */
  requests: string[];
  /** Hosts the hub asked for (the Host header it sent), in order. */
  hosts: string[];
  /** The most `/slowimg/` requests the server held open at once (each takes 150 ms). */
  slowImagePeak(): number;
  stop(): void;
  /** Install the seams so the hub's one picture fetch and its article fetch reach this server. */
  attach(): void;
  detach(): void;
}

export const ARTICLE_SENTENCES = Array.from({ length: 14 }, (_, i) => `Sentence number ${i + 1} describes what the harbor council decided on Tuesday evening in plain words.`);

export function articleHtml(extra = "", link = `<a href="https://elsewhere.example.org/more">the full report</a>`): string {
  const paragraphs = [ARTICLE_SENTENCES.slice(0, 5).join(" "), `${ARTICLE_SENTENCES.slice(5, 9).join(" ")} Read ${link}.${extra ? ` ${extra}` : ""}`, ARTICLE_SENTENCES.slice(9).join(" ")];
  return `<html><head><title>Harbor</title></head><body><nav>Menu</nav><article><h1>Harbor plan</h1>${paragraphs.map((p) => `<p>${p}</p>`).join("")}<blockquote>A quoted line from the mayor.</blockquote></article><footer>Footer</footer></body></html>`;
}

export async function startPublisher(pages: Record<string, string | ((req: Request) => Response | Promise<Response>)> = {}): Promise<Publisher> {
  const png = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 30, g: 90, b: 160 } } }).png().toBuffer();
  const requests: string[] = [];
  const hosts: string[] = [];
  let slowNow = 0;
  let slowPeak = 0;
  const server = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      requests.push(url.pathname);
      hosts.push(req.headers.get("x-original-host") ?? "");
      if (url.pathname.startsWith("/limited/")) return new Response("slow down", { status: 429 });
      if (url.pathname.startsWith("/slowimg/")) {
        slowNow++; slowPeak = Math.max(slowPeak, slowNow);
        await new Promise((resolve) => setTimeout(resolve, 150));
        slowNow--;
        return new Response(png, { headers: { "content-type": "image/png" } });
      }
      if (url.pathname.startsWith("/img/")) return new Response(png, { headers: { "content-type": "image/png" } });
      if (url.pathname.startsWith("/text/")) return new Response("not an image", { headers: { "content-type": "text/plain" } });
      const page = pages[url.pathname];
      if (typeof page === "function") return page(req);
      return page !== undefined ? new Response(page, { headers: { "content-type": "text/html" } }) : new Response("missing", { status: 404 });
    },
  });
  const fetchFromServer = (original: URL, init?: RequestInit) => fetch(`http://127.0.0.1:${server.port}${original.pathname}${original.search}`, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), "x-original-host": original.hostname } });
  return {
    port: server.port ?? 0, requests, hosts,
    slowImagePeak: () => slowPeak,
    stop: () => server.stop(true),
    attach() {
      __setNewsPictureDepsForTests({
        dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }),
        request: async (url, _target, options) => fetchFromServer(url, { method: "GET", headers: options.headers as Record<string, string>, signal: options.signal }),
      });
      __setPageFetchForTests(async (target): Promise<AttemptResult> => {
        const url = new URL(target);
        if (url.pathname === "/robots.txt" && pages["/robots.txt"] === undefined) return { ok: false, status: 404 };
        const response = await fetchFromServer(url);
        return response.ok ? { ok: true, status: 200, value: await response.text() } : { ok: false, status: response.status, error: new Error(`HTTP ${response.status}`) as never };
      });
    },
    detach() {
      __setNewsPictureDepsForTests(null);
      __setPageFetchForTests(null);
    },
  };
}

// ---- Shelf seeding --------------------------------------------------------------------------------

export const KIDS_HOST = "https://kids.example.test";
export const ADULT_HOST = "https://wire.example.test";

/** One Kids' feed and one household feed on the package lists (ticked for child and teen/adult by default). */
export function seedFeeds(): { kids: string; household: string } {
  const nowIso = new Date().toISOString();
  const kids = createFeed({ url: `${KIDS_HOST}/feed.xml`, title: "Kids", publisher: "Kids Daily", band: "child", packageId: "feeds-children", pollIntervalS: 1800, provenance: "package:feeds-children", nowIso });
  const household = createFeed({ url: `${ADULT_HOST}/feed.xml`, title: "Wire", publisher: "Example Wire", band: "teen", packageId: "feeds-household", pollIntervalS: 1800, provenance: "package:feeds-household", nowIso });
  return { kids: kids.id, household: household.id };
}

let counter = 0;
export function putItem(feedId: string, host: string, over: Partial<{ title: string; summary: string; topics: string[]; image: string | null; ageHours: number; bandOk: AgeBand; path: string; id: string; publisher: string }> = {}): NewsItem {
  counter += 1;
  const n = String(counter).padStart(5, "0");
  const path = over.path ?? `/story/${n}`;
  const published = new Date(Date.now() - (over.ageHours ?? 1) * 3_600_000).toISOString();
  const item = NewsItem.parse({
    id: over.id ?? `news-t${n}abcdef`, feed_id: feedId, url: `${host}${path}`, canonical_url: `${host}${path}`, title: over.title ?? `Headline ${n}`,
    summary: over.summary ?? `A short summary of story ${n} in plain words.`, published_at: published, fetched_at: published, publisher: over.publisher ?? (host === KIDS_HOST ? "Kids Daily" : "Example Wire"),
    lang: "en", band_ok: over.bandOk ?? "child", hlc: "1:0:abcdef", provenance: "test",
    ...(over.image === null ? {} : { image_url: over.image ?? `${host}/img/${n}.png` }), ...(over.topics ? { topics: over.topics } : {}),
  });
  sharedShelfStore()!.put(item);
  if (over.topics) sharedShelfStore()!.setTopics(item.id, over.topics);
  return item;
}

export function pictureFiles(): string[] {
  const dir = newsPictureDir();
  return existsSync(dir) ? require("node:fs").readdirSync(dir).filter((name: string) => name.endsWith(".webp")) : [];
}

/** Switches the household's default followed topics off for every user type, so a test about follow mechanics sees only a person's own taps. */
export function noDefaultTopics(): void {
  for (const band of ["adult", "teen", "child"]) setHouseholdSettingValue(`news.default_topics.${band}`, []);
}
