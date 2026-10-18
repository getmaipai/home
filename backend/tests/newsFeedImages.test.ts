// The picture a feed names: the widest copy it lists, and BBC's larger size. Offline: a stub fetch plays the feed server.
import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { createFeed } from "@/lib/shelf/feedStore";
import { pollFeed } from "@/lib/shelf/shelfPoller";
import { largerFeedImage } from "@/lib/shelf/imageAddress";
import { openShelfStore, type ShelfStore } from "@/lib/shelf/shelfStore";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const publicDns = async () => ({ address: "93.184.216.34", family: 4 });
let store: ShelfStore;
beforeEach(() => { resetDb(); __resetRateLimiterForTests(); store = openShelfStore(":memory:"); });

function feedWith(itemXml: string): string {
  return `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>T</title><link>https://example.com</link><description>d</description><item><title>A story</title><link>https://news.example.com/a</link><description>Words.</description>${itemXml}</item></channel></rss>`;
}
async function imageOfFirstItem(xml: string): Promise<string | undefined> {
  const feed = createFeed({ url: "https://news.example.com/feed.xml", title: "News", publisher: "Example", band: "adult", pollIntervalS: 1800, provenance: "admin", nowIso: new Date(NOW).toISOString() });
  const fetcher = (async () => new Response(xml)) as unknown as typeof fetch;
  await pollFeed(feed, { fetch: fetcher, dnsLookup: publicDns, now: () => NOW, store });
  return store.list([feed.id], ["child", "teen", "adult"], 5)[0]?.image_url ?? undefined;
}

describe("the picture a feed names", () => {
  test("the widest listed copy wins over an earlier narrow one", async () => {
    const image = await imageOfFirstItem(feedWith(`<media:content url="https://img.example.com/p.jpg?width=140" width="140"/><media:content url="https://img.example.com/p.jpg?width=460" width="460"/>`));
    expect(image).toBe("https://img.example.com/p.jpg?width=460");
  });
  test("entries with no width keep the feed's order", async () => {
    const image = await imageOfFirstItem(feedWith(`<media:thumbnail url="https://img.example.com/first.jpg"/><media:thumbnail url="https://img.example.com/second.jpg"/>`));
    expect(image).toBe("https://img.example.com/first.jpg");
  });
  test("BBC's 240 px picture is asked for at 976 px", async () => {
    const image = await imageOfFirstItem(feedWith(`<media:thumbnail url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/3671/live/x.jpg" width="240" height="134"/>`));
    expect(image).toBe("https://ichef.bbci.co.uk/ace/standard/976/cpsprodpb/3671/live/x.jpg");
  });
});

describe("largerFeedImage", () => {
  test("only BBC's picture server is rewritten, never to a smaller width, and a bad address is returned as given", () => {
    expect(largerFeedImage("https://ichef.bbci.co.uk/ace/standard/976/a.jpg")).toBe("https://ichef.bbci.co.uk/ace/standard/976/a.jpg");
    expect(largerFeedImage("https://ichef.bbci.co.uk/ace/standard/1024/a.jpg")).toBe("https://ichef.bbci.co.uk/ace/standard/1024/a.jpg");
    expect(largerFeedImage("https://i.guim.co.uk/img/a.jpg?width=140&s=sig")).toBe("https://i.guim.co.uk/img/a.jpg?width=140&s=sig");
    expect(largerFeedImage("not an address")).toBe("not an address");
  });
});
