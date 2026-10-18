// The reader and the page pace: a story opened while the hub's shared page bucket is empty waits for a token and is not remembered as a failure.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { __setPageFetchForTests } from "@/lib/packageHost";
import { __resetNewsArticleForTests, __setPaceWaitForTests, loadContent } from "@/lib/news/article";
import { resetDb } from "./reset-db";
import { ADULT_HOST, articleHtml, putItem, removeNewsApp, resetNewsState, seedFeeds } from "./support/newsFixture";

beforeEach(() => { resetDb(); resetNewsState(); __resetNewsArticleForTests(); });
afterEach(() => { __setPageFetchForTests(null); __setPaceWaitForTests(null); removeNewsApp(); });

function pageFetcher(limitedFirst: number): { fetch: (url: string) => Promise<never>; pageCalls: () => number } {
  let pages = 0;
  const fetch = (async (url: string) => {
    if (url.endsWith("/robots.txt")) return { ok: false, status: 404, networkFailure: false, error: new HostError("network_unreachable", "none") };
    pages++;
    if (pages <= limitedFirst) throw new HostError("rate_limited", "Web pages are rate-limited - try again shortly");
    return { ok: true, value: articleHtml(), status: 200 };
  }) as unknown as (url: string) => Promise<never>;
  return { fetch, pageCalls: () => pages };
}

describe("reading a story while the page pace is empty", () => {
  test("waits for a token and shows the full article", async () => {
    const waits: number[] = [];
    __setPaceWaitForTests(async (ms) => { waits.push(ms); });
    const page = pageFetcher(2);
    __setPageFetchForTests(page.fetch as never);
    const item = putItem(seedFeeds().household, ADULT_HOST);
    const loaded = await loadContent(item, "adult", { store: null });
    expect(loaded.source).toBe("fetched");
    expect(loaded.blocks.length).toBeGreaterThan(1);
    expect(waits).toEqual([2500, 2500]);
  });

  test("a pace that never clears shows the summary now and is not remembered, so the next open tries again", async () => {
    __setPaceWaitForTests(async () => {});
    const page = pageFetcher(1000);
    __setPageFetchForTests(page.fetch as never);
    const item = putItem(seedFeeds().household, ADULT_HOST);
    const first = await loadContent(item, "adult", { store: null });
    expect(first.source).toBe("teaser");
    const callsAfterFirst = page.pageCalls();
    expect(callsAfterFirst).toBe(4);
    const second = await loadContent(item, "adult", { store: null });
    expect(second.source).toBe("teaser");
    expect(page.pageCalls()).toBeGreaterThan(callsAfterFirst);
  });

  test("a background read never waits for the pace", async () => {
    const waits: number[] = [];
    __setPaceWaitForTests(async (ms) => { waits.push(ms); });
    __setPageFetchForTests(pageFetcher(1000).fetch as never);
    const item = putItem(seedFeeds().household, ADULT_HOST);
    await loadContent(item, "adult", { store: null, background: true });
    expect(waits).toEqual([]);
  });
});
