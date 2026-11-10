// PODCAST-RATE-01: the listening speed a person picks is remembered per person and show. The play page's `player.rate` reads `show_rate` from the
// episode row and calls PATCH /api/plugins/podcasts/shows/{show_id}/rate with `{rate}` when the speed changes. Local data only.
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaSources } from "@/db/schema";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetProgressForTests } from "@/lib/media/progress";
import { __setPodcastFetchDepsForTests } from "@/lib/media/podcasts";
import { getFeed } from "@/lib/shelf/feedStore";
import { pollFeed, type PollDeps } from "@/lib/shelf/shelfPoller";
import { __resetShelfCountersForTests } from "@/lib/shelf/shelfCounters";
import { PACKAGES_DIR } from "@/lib/paths";
import { TestClient } from "./client";
import { owner } from "./support/testAuth";
import { resetDb } from "./reset-db";

const HOST = "https://rate.example.com";
const FEED = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Rate Show</title><itunes:author>Marlow</itunes:author><description>A show.</description><item><title>Ep 1</title><guid isPermaLink="false">urn:r:1</guid><pubDate>Mon, 05 Oct 2026 06:00:00 GMT</pubDate><description>Notes</description><enclosure url="${HOST}/e1.mp3" length="10" type="audio/mpeg"/><itunes:duration>00:10:00</itunes:duration></item></channel></rss>`;
let clock = Date.parse("2026-10-30T12:00:00Z");
const deps: PollDeps = {
  dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }),
  now: () => clock,
  fetch: (async (input: URL | string) => new Response(String(input).endsWith("feed.xml") ? FEED : "no", { status: String(input).endsWith("feed.xml") ? 200 : 404, headers: { "content-type": "application/rss+xml" } })) as unknown as typeof fetch,
};
beforeEach(() => { clock = Date.parse("2026-10-30T12:00:00Z"); resetDb(); __resetRateLimiterForTests(); __resetShelfCountersForTests(); __resetProgressForTests(); __setPodcastFetchDepsForTests(deps); });

async function setup() {
  const { client, row } = await owner();
  __setPodcastFetchDepsForTests({ ...deps, fetch: (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch });
  const res = await client.post("/api/plugins/podcasts/subscribe", { url: `${HOST}/feed.xml` });
  await new Promise((resolve) => setTimeout(resolve, 20));
  __setPodcastFetchDepsForTests(deps);
  const { source_id } = (await res.json()) as { source_id: string };
  const feedId = db.select().from(mediaSources).where(eq(mediaSources.id, source_id)).get()!.feedId!;
  clock += 3_600_000;
  await pollFeed(getFeed(feedId)!, deps);
  const episodes = (await (await client.post("/api/plugins/podcasts/data/episodes", {})).json()) as Array<{ id: string }>;
  const item = async (who: TestClient) => (await (await who.post("/api/plugins/podcasts/data/item", { scope: "item", id: episodes[0]!.id })).json()) as Record<string, unknown>;
  const rate = (who: TestClient, show: string, body: unknown) => who.request(`/api/plugins/podcasts/shows/${encodeURIComponent(show)}/rate`, { method: "PATCH", body });
  return { client, personId: row.id, sourceId: source_id, episodeId: episodes[0]!.id, item, rate };
}

describe("per-show speed memory", () => {
  test("a saved speed comes back on the episode row as show_rate, with the show id the page calls", async () => {
    const { client, sourceId, item, rate } = await setup();
    expect((await item(client)).show_rate).toBeUndefined();
    const saved = await rate(client, sourceId, { rate: 1.5 });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ ok: true, show_id: sourceId, rate: 1.5 });
    expect(await item(client)).toMatchObject({ show_rate: 1.5, show_id: sourceId });
    // Changing it again replaces the one row, never adds a second.
    await rate(client, sourceId, { rate: 0.5 });
    expect((await item(client)).show_rate).toBe(0.5);
    expect(await (await client.get("/api/plugins/podcasts/shows/" + encodeURIComponent(sourceId) + "/rate")).json()).toMatchObject({ rate: 0.5 });
  });

  test("a show with no saved speed starts at the Podcast speed setting, and its own saved speed wins", async () => {
    const { client, personId, sourceId, item, rate } = await setup();
    expect((await client.put("/api/settings", { scope: `person:${personId}`, key: "audio.speed.podcast", value: 1.25 })).status).toBe(200);
    expect((await item(client)).show_rate).toBe(1.25);
    await rate(client, sourceId, { rate: 0.75 });
    expect((await item(client)).show_rate).toBe(0.75);
  });

  test("the range is 0.5 to 2; anything else is refused with a plain line and nothing is stored", async () => {
    const { client, sourceId, item, rate } = await setup();
    for (const bad of [0.4, 2.1, 0, -1, "fast", null, Number.NaN]) {
      const res = await rate(client, sourceId, { rate: bad });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toContain("0.5");
    }
    expect((await rate(client, sourceId, {})).status).toBe(422);
    expect((await item(client)).show_rate).toBeUndefined();
    expect((await rate(client, sourceId, { rate: 2 })).status).toBe(200);
    expect((await rate(client, sourceId, { rate: "1.25" })).status).toBe(200);
    expect((await item(client)).show_rate).toBe(1.25);
  });

  test("a show the person cannot see is a 404, and one person's speed is never another's", async () => {
    const { client, sourceId, episodeId, item, rate } = await setup();
    expect((await rate(client, "src-nope", { rate: 1.2 })).status).toBe(404);
    const made = await client.post("/api/people", { displayName: "Quill", role: "adult", secret: "0000" });
    const other = new TestClient();
    await other.post("/api/auth/verify-secret", { personId: ((await made.json()) as { id: string }).id, secret: "0000" });
    await rate(client, sourceId, { rate: 1.75 });
    const theirs = await rate(other, sourceId, { rate: 1.1 });
    expect([200, 404]).toContain(theirs.status);
    expect((await item(client)).show_rate).toBe(1.75);
    const seen = (await (await other.post("/api/plugins/podcasts/data/item", { scope: "item", id: episodeId })).json()) as { show_rate?: number } | unknown[];
    if (!Array.isArray(seen)) expect(seen.show_rate).not.toBe(1.75);
  });
});

describe("the play page", () => {
  const play = JSON.parse(readFileSync(join(PACKAGES_DIR, "podcasts/pages/play.json"), "utf8")) as { body: Array<{ main: Array<Record<string, any>> }> };
  const player = play.body[0]!.main[0]!;
  test("player.rate reads show_rate and calls the rate route with the speed and the show id", () => {
    expect(player.rate).toEqual({
      field: "show_rate",
      value: 1,
      on_change: { call: { target: "/api/plugins/podcasts/shows/{show_id}/rate", method: "PATCH", args: { rate: "{rate}" } } },
    });
  });
});
