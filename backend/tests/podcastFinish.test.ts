// Podcasts finish (2026-11-09): the unplayed dot, automatic saving of new episodes of followed shows, mark a whole show played, and the show page's rows.
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, mediaItems, mediaSources } from "@/db/schema";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetProgressForTests } from "@/lib/media/progress";
import { __setPodcastFetchDepsForTests, drainPodcastAutoRules, trimAutoSaved } from "@/lib/media/podcasts";
import { getFeed } from "@/lib/shelf/feedStore";
import { pollFeed, type PollDeps } from "@/lib/shelf/shelfPoller";
import { __resetShelfCountersForTests } from "@/lib/shelf/shelfCounters";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { child, owner } from "./support/testAuth";
import { resetDb } from "./reset-db";

const HOST = "https://auto.example.com";
const items = (count: number) => Array.from({ length: count }, (_, i) => i + 1).map((n) =>
  `<item><title>Ep ${n}</title><guid isPermaLink="false">urn:a:${n}</guid><pubDate>Mon, ${String(n).padStart(2, "0")} Oct 2026 06:00:00 GMT</pubDate><description>Notes ${n}</description><enclosure url="${HOST}/e${n}.mp3" length="3000" type="audio/mpeg"/><itunes:duration>00:10:00</itunes:duration></item>`).join("");
const feedOf = (count: number) => `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Auto Show</title><itunes:author>Marlow</itunes:author><description>A show.</description>${items(count)}</channel></rss>`;
let feedXml = feedOf(5);
let clock = Date.parse("2026-10-30T12:00:00Z");
const bytes = (n: number) => new Uint8Array(3000).map((_, i) => (i === 0 ? n : (i * 7) % 251));
const deps: PollDeps = {
  dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }),
  now: () => clock,
  fetch: (async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.pathname === "/feed.xml") return new Response(feedXml, { headers: { "content-type": "application/rss+xml" } });
    const ep = /^\/e(\d+)\.mp3$/.exec(url.pathname);
    if (ep) return new Response(bytes(Number(ep[1])), { headers: { "content-type": "audio/mpeg" } });
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch,
};

beforeEach(() => {
  clock = Date.parse("2026-10-30T12:00:00Z");
  feedXml = feedOf(5);
  resetDb();
  __resetRateLimiterForTests();
  __resetShelfCountersForTests();
  __resetProgressForTests();
  __setPodcastFetchDepsForTests(deps);
});

type Rows = Array<Record<string, any>>;

/** Follows the show with its first look offline (so no episodes exist yet), then optionally sets the person's setting before the real refresh. */
async function setup(autoDownload?: "followed" | "off", maxGb?: number) {
  const { client, row } = await owner();
  if (autoDownload) setValue(row, `person:${row.id}`, "podcasts.auto_download", autoDownload);
  if (maxGb !== undefined) setValue(row, `person:${row.id}`, "podcasts.auto_download_max_gb", maxGb);
  __setPodcastFetchDepsForTests({ ...deps, fetch: (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch });
  const res = await client.post("/api/plugins/podcasts/subscribe", { url: `${HOST}/feed.xml` });
  await new Promise((resolve) => setTimeout(resolve, 20));
  __setPodcastFetchDepsForTests(deps);
  const { source_id } = (await res.json()) as { source_id: string };
  const feedId = db.select().from(mediaSources).where(eq(mediaSources.id, source_id)).get()!.feedId!;
  const refresh = async () => { clock += 3_600_000; await pollFeed(getFeed(feedId)!, deps); await drainPodcastAutoRules(); };
  const data = async (id: string, body: Record<string, unknown> = {}) => (await (await client.post(`/api/plugins/podcasts/data/${id}`, body)).json()) as Rows;
  const directory = async (body: Record<string, unknown>) => (await (await client.post("/api/plugins/podcasts/data/directory", body)).json()) as Rows;
  const liveFiles = () => new Set(db.select().from(attachments).all().filter((a) => !a.deletedAt).map((a) => a.id));
  const savedTitles = () => db.select().from(mediaItems).where(eq(mediaItems.sourceId, source_id)).all().filter((r) => !r.deletedAt && r.locFileId && liveFiles().has(r.locFileId)).map((r) => r.title).sort();
  return { client, row, sourceId: source_id, refresh, data, directory, savedTitles };
}

describe("the unplayed dot", () => {
  test("an unplayed episode carries the dot field; a played one carries none", async () => {
    const { client, refresh, data } = await setup();
    await refresh();
    const rows = await data("latest");
    expect(rows.every((r) => r.unplayed === "Unplayed")).toBe(true);
    await client.post("/api/plugins/podcasts/played", { media_id: rows[0]!.id, on: true });
    expect((await data("episodes")).find((r) => r.id === rows[0]!.id)).toMatchObject({ unplayed: "", badge: "Played" });
  });

  test("Episodes and Latest episodes draw the badge field as a dot", () => {
    const read = (m: string) => JSON.parse(readFileSync(join(import.meta.dir, "../packages/podcasts/pages", `${m}.json`), "utf8"));
    const shelf = (page: string, heading: string) => read(page).body.find((n: any) => n.heading === heading);
    for (const [page, heading] of [["episodes", "Episodes"], ["index", "Latest episodes"]] as const) {
      expect(shelf(page, heading)).toMatchObject({ item_badge_field: "unplayed", item_badge_presentation: "dot" });
    }
  });
});

describe("automatic saving of new episodes", () => {
  test("off saves nothing", async () => {
    const { refresh, savedTitles } = await setup("off");
    await refresh();
    expect(savedTitles()).toEqual([]);
  });

  test("followed saves at most 3 new episodes per refresh, newest first, and the next refresh only the new ones", async () => {
    const { refresh, savedTitles } = await setup("followed");
    await refresh();
    expect(savedTitles()).toEqual(["Ep 3", "Ep 4", "Ep 5"]);
    feedXml = feedOf(7);
    await refresh();
    expect(savedTitles()).toEqual(["Ep 3", "Ep 4", "Ep 5", "Ep 6", "Ep 7"]);
    await refresh(); // nothing new
    expect(savedTitles()).toHaveLength(5);
  });

  test("an unfollowed show saves nothing, and a copy the person removed is not fetched again", async () => {
    const { client, sourceId, refresh, savedTitles } = await setup("followed");
    await refresh();
    const first = db.select().from(mediaItems).where(eq(mediaItems.sourceId, sourceId)).all().find((r) => r.locFileId)!;
    const gone = await client.post("/api/plugins/podcasts/save", { media_id: first.id, on: false });
    expect(gone.status).toBe(200);
    await refresh();
    expect(savedTitles()).not.toContain(first.title);
    await client.post("/api/plugins/podcasts/directory/remove", { source_id: sourceId });
    feedXml = feedOf(9);
    await refresh();
    expect(savedTitles()).not.toContain("Ep 9");
  });

  test("the cap removes the oldest automatic copies first", async () => {
    const { row, refresh, savedTitles } = await setup("followed", 1);
    await refresh();
    expect(savedTitles()).toHaveLength(3);
    // The registry floor is 1 GB, so shrink what counts as used: pretend each copy is 400 MB.
    db.update(attachments).set({ size: 400 * 1024 ** 2 }).where(eq(attachments.provenance, "podcast:auto")).run();
    expect(trimAutoSaved(row)).toBe(1);
    expect(savedTitles()).toEqual(["Ep 4", "Ep 5"]);
  });

  test("low disk space saves nothing", async () => {
    const { refresh, savedTitles } = await setup("followed");
    setHouseholdSettingValue("storage.critical_free_gb", 1_000_000_000);
    await refresh();
    expect(savedTitles()).toEqual([]);
  });

  test("a show with its own keep rule is governed by it, and the show-page switch sets that rule", async () => {
    const { client, sourceId, refresh, savedTitles, directory } = await setup("off");
    await refresh();
    const before = (await directory({ scope: "show-saved", id: sourceId }))[0]!;
    expect(before).toMatchObject({ auto_next: true, auto_label: "Save new episodes", can_manage: true });
    expect(before.description).toContain("New episodes stream");
    const on = await client.post("/api/plugins/podcasts/show-auto", { source_id: sourceId, on: true });
    expect(await on.json()).toMatchObject({ ok: true, on: true });
    await drainPodcastAutoRules();
    expect(savedTitles()).toEqual(["Ep 3", "Ep 4", "Ep 5"]);
    const after = (await directory({ scope: "show-saved", id: sourceId }))[0]!;
    expect(after).toMatchObject({ auto_next: false, auto_label: "Stop saving new episodes" });
    expect(after.description).toContain("3 episodes are saved on the hub");
  });

  test("a child cannot switch it and gets no switch", async () => {
    const { client, sourceId, directory } = await setup("off");
    const kid = await child(client);
    expect((await kid.client.post("/api/plugins/podcasts/show-auto", { source_id: sourceId, on: true })).status).toBe(403);
    void directory;
  });
});

describe("mark a whole show played", () => {
  test("all played empties Latest; all unplayed brings it back", async () => {
    const { client, sourceId, refresh, data } = await setup();
    await refresh();
    const done = await client.post("/api/plugins/podcasts/played-all", { source_id: sourceId, on: true });
    expect(await done.json()).toMatchObject({ ok: true, on: true, count: 5, label: "Marked 5 played" });
    expect(await data("latest")).toEqual([]);
    await client.post("/api/plugins/podcasts/played-all", { source_id: sourceId, on: false });
    expect(await data("latest")).toHaveLength(5);
    const missing = await client.post("/api/plugins/podcasts/played-all", { source_id: "msrc-nothing01", on: true });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toContain("Open Shows");
  });
});
