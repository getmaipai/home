// NEWS-02b: the localhost fixture feed server, proven through the same parser the poller uses.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parseFeed } from "feedsmith";
import { SLOW_DELAY_MS, defaultItems, startFixtureFeedServer, type FixtureFeedServer } from "./support/fixtureFeedServer";

let srv: FixtureFeedServer;
beforeAll(() => { srv = startFixtureFeedServer(); });
afterAll(async () => { await srv.close(); });

describe("fixture feed server", () => {
  test("binds loopback only, on an ephemeral port", () => {
    expect(srv.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(Number(new URL(srv.origin).port)).toBeGreaterThan(0);
    expect(srv.url("rss.xml")).toBe(`${srv.origin}/rss.xml`);
  });
  test("serves RSS, Atom and JSON Feed that feedsmith parses, with pictures on the first two items only", async () => {
    for (const [path, format] of [["/rss.xml", "rss"], ["/atom.xml", "atom"], ["/feed.json", "json"]] as const) {
      const body = await (await fetch(srv.url(path))).text();
      const parsed = parseFeed(body) as { format: string; feed: Record<string, any> };
      expect(parsed.format).toBe(format);
      const entries = (parsed.feed.items ?? parsed.feed.entries) as unknown[];
      expect(entries).toHaveLength(3);
      expect(body.match(/pictures\/[a-z]+\.png/g)).toHaveLength(format === "rss" ? 4 : 2);
      expect(body.replace(/xmlns(?::\w+)?="[^"]*"/g, "").replace("https://jsonfeed.org/version/1.1", "")).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/); // only the XML namespace and JSON Feed version names may be non-local
    }
  });
  test("serves the pictures as real PNGs and the article pages; unknown paths are 404", async () => {
    const pic = await fetch(srv.url("/pictures/falls.png"));
    expect(pic.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await pic.arrayBuffer()).slice(0, 4)).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
    expect((await fetch(srv.url("/pictures/nope.png"))).status).toBe(404);
    const html = await (await fetch(srv.url("/articles/falls-reopen"))).text();
    expect(html).toContain("<blockquote>");
    expect((await fetch(srv.url("/articles/none"))).status).toBe(404);
    expect((await fetch(srv.url("/elsewhere"))).status).toBe(404);
  });
  test("429 and 500 modes answer per path and clear back to ok", async () => {
    srv.setMode("/rss.xml", "429");
    const r = await fetch(srv.url("/rss.xml"));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    expect((await fetch(srv.url("/atom.xml"))).status).toBe(200);
    srv.setMode("/rss.xml", "500");
    expect((await fetch(srv.url("/rss.xml"))).status).toBe(500);
    srv.setMode("/rss.xml", "ok");
    expect((await fetch(srv.url("/rss.xml"))).status).toBe(200);
  });
  test("slow mode delays the answer", async () => {
    srv.setMode("/feed.json", "slow");
    const t = performance.now();
    expect((await fetch(srv.url("/feed.json"))).status).toBe(200);
    expect(performance.now() - t).toBeGreaterThanOrEqual(SLOW_DELAY_MS - 100);
    srv.setMode("/feed.json", "ok");
  });
  test("records requests, and setItems replaces the feed", async () => {
    const before = srv.count("/rss.xml");
    srv.setItems(defaultItems().slice(0, 1));
    const parsed = parseFeed(await (await fetch(srv.url("/rss.xml"))).text()) as { feed: { items: unknown[] } };
    expect(parsed.feed.items).toHaveLength(1);
    expect(srv.count("/rss.xml")).toBe(before + 1);
    expect(srv.requests.at(-1)?.method).toBe("GET");
  });
});
