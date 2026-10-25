import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NewsItem } from "@maipai/spec/gen/ts/news-item.js";
import { openShelfStore } from "@/lib/shelf/shelfStore";
import { releaseShelfItems, __resetFloorMemoForTests } from "@/lib/shelf/shelfRead";
import { FEED_LISTS } from "@/lib/shelf/shelfPolicy";
import { syncShelfFeeds } from "@/lib/shelf/shelfFeeds";
import { listFeeds } from "@/lib/shelf/feedStore";
import { setHouseholdSettingValue } from "@/lib/settings";
import { resetDb } from "./reset-db";
import { __releasedForBandForTests } from "@/lib/news/data";

describe("shelf read speed", () => {
  beforeEach(() => resetDb());
  test("memoizes teen floor checks and orders shelf reads with the recent index", () => {
    const store = openShelfStore(":memory:");
    try {
      const now = new Date().toISOString();
      const packages = mkdtempSync(join(tmpdir(), "shelf-speed-"));
      for (const list of FEED_LISTS) { mkdirSync(join(packages, list.package_id)); writeFileSync(join(packages, list.package_id, "feeds.json"), JSON.stringify({ list_id: list.id, feeds: [] })); }
      setHouseholdSettingValue("news.feeds.teen", "https://speed.example/feed.xml");
      syncShelfFeeds({ nowIso: now, store, packagesDir: packages });
      const feedId = listFeeds().find((feed) => feed.url === "https://speed.example/feed.xml")!.id;
      for (let n = 0; n < 3_000; n++) store.put(NewsItem.parse({
        id: `news-speed${n}`, feed_id: feedId, url: `https://speed.example/${n}`, canonical_url: `https://speed.example/${n}`,
        title: `A safe headline ${n}`, summary: "A safe summary.", published_at: new Date(Date.now() - n * 1000).toISOString(), fetched_at: now,
        publisher: "Example", lang: "en", band_ok: "child", hlc: "1:0:abcdef", provenance: "test",
      }));
      expect(store.explainListPlan().join(" ")).not.toContain("USE TEMP B-TREE");
      __resetFloorMemoForTests();
      releaseShelfItems("teen", 500, store);
      const started = performance.now();
      expect(releaseShelfItems("teen", 500, store)).toHaveLength(500);
      expect(performance.now() - started).toBeLessThan(60);
    } finally { store.close(); }
  });

  test("a newly unticked teen feed is removed from released memo results immediately", () => {
    const store = openShelfStore(":memory:");
    try {
      const now = new Date().toISOString();
      syncShelfFeeds({ nowIso: now, store });
      const feed = listFeeds().find((candidate) => candidate.package_id === "feeds-household")!;
      setHouseholdSettingValue("news.lists.teen", ["feeds-household"]);
      store.put(NewsItem.parse({ id: "news-untickabcdef", feed_id: feed.id, url: "https://speed.example/untick", canonical_url: "https://speed.example/untick", title: "Safe headline", summary: "Safe summary", published_at: now, fetched_at: now, publisher: "Example", lang: "en", band_ok: "child", hlc: "1:0:abcdef", provenance: "test" }));
      expect(__releasedForBandForTests("teen", store).map((item) => item.id)).toContain("news-untickabcdef");
      setHouseholdSettingValue("news.lists.teen", []);
      expect(__releasedForBandForTests("teen", store).map((item) => item.id)).not.toContain("news-untickabcdef");
    } finally { store.close(); }
  });
});
