// MEDIA-PODCASTS-01: podcasts through the ONE shelf poller and the shared media-app host. A localhost fixture feed (tests/fixtures/podcast/
// feed.xml.tmpl, three episodes, the middle one explicit) is served by Bun.serve on 127.0.0.1; the poller's injectable fetch maps the
// fixture's public-looking host onto it and a stub DNS answers a public address, so the SSRF guard runs unchanged. Nothing leaves the machine.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, mediaItems, mediaSources, shares } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetProgressForTests, flushProgress } from "@/lib/media/progress";
import { removeItem } from "@/lib/media/items";
import { __setPodcastFetchDepsForTests, applyAutoRules, chaptersFromNotes, parsePodcastFeed, plainNotes } from "@/lib/media/podcasts";
import { getFeed, updateFeed } from "@/lib/shelf/feedStore";
import { pollFeed, type PollDeps } from "@/lib/shelf/shelfPoller";
import { __resetShelfCountersForTests } from "@/lib/shelf/shelfCounters";

const HOST = "https://pod.example.com";
const EPISODE_BYTES = new Uint8Array(4096).map((_, index) => (index * 7) % 251);
/** Each episode has its own bytes (the file store keeps identical bytes once, which would make the three one file). */
const episodeBytes = (n: number): Uint8Array => EPISODE_BYTES.map((value, index) => (index === 0 ? n : value));
const ART_BYTES = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

interface Call { path: string; headers: Record<string, string> }
let server: ReturnType<typeof Bun.serve>;
let calls: Call[];
let feedXml: string;
let feedEtag: string;
const FEED_MODIFIED = "Thu, 15 Oct 2026 06:00:00 GMT";

const template = readFileSync(join(import.meta.dir, "fixtures/podcast/feed.xml.tmpl"), "utf8");
const feedFor = (extraItem = ""): string => template.replaceAll("__BASE__", HOST).replace("</channel>", `${extraItem}</channel>`);
const episode4 = `<item><title>Question 4</title><guid isPermaLink="false">urn:sprout:ep4</guid><pubDate>Fri, 14 Oct 2026 06:00:00 GMT</pubDate><description>Episode 4.&lt;br&gt;0:00 Hello&lt;br&gt;1:00 The big idea&lt;br&gt;2:30 Goodbye</description><enclosure url="${HOST}/sprout-ep4.mp3" length="4096" type="audio/mpeg"/><itunes:duration>00:03:10</itunes:duration></item>`;

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => { headers[key] = value; });
      calls.push({ path: url.pathname, headers });
      if (url.pathname === "/feed.xml") {
        if (request.headers.get("if-none-match") === feedEtag) return new Response(null, { status: 304 });
        return new Response(feedXml, { headers: { "content-type": "application/rss+xml; charset=utf-8", etag: feedEtag, "last-modified": FEED_MODIFIED } });
      }
      if (url.pathname === "/sprout.jpg") return new Response(ART_BYTES, { headers: { "content-type": "image/png" } });
      const ep = /^\/sprout-ep(\d)\.mp3$/.exec(url.pathname);
      if (ep) return new Response(episodeBytes(Number(ep[1])), { headers: { "content-type": "audio/mpeg" } });
      return new Response("no", { status: 404 });
    },
  });
});
afterAll(() => { server.stop(true); });

let clock = Date.parse("2026-10-15T12:00:00Z");
const publicDns = async () => ({ address: "93.184.216.34", family: 4 });
const deps: PollDeps = {
  dnsLookup: publicDns,
  now: () => clock,
  fetch: ((input: URL | string, init?: RequestInit) => fetch(String(input).replace(HOST, `http://127.0.0.1:${server.port}`), init)) as typeof fetch,
};
const later = (seconds = 3600) => { clock += seconds * 1000; };

beforeEach(() => {
  resetDb();
  __resetRateLimiterForTests();
  __resetShelfCountersForTests();
  __resetProgressForTests();
  calls = [];
  feedXml = feedFor();
  feedEtag = '"v1"';
  clock = Date.parse("2026-10-15T12:00:00Z");
  __setPodcastFetchDepsForTests(deps);
});

type Row = { id: string; title: string; channel: string | null; copy_label: string; progress?: number; summary: string };

async function setup() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const signIn = async (displayName: string, role: string) => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...(role === "child" ? { birthdate: "2018-03-01" } : {}) });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return { client, id: created.id };
  };
  const adult = await signIn("Marlow", "adult");
  const child = await signIn("Sprout", "child");
  const data = async <T = Row[]>(client: TestClient, id: string, body: Record<string, unknown> = {}) => (await client.post(`/api/plugins/podcasts/data/${id}`, body)).json() as Promise<T>;
  /** Adds the fixture show by the route, then polls its feed once (the route's own background poll fails harmlessly first: no clock moves). */
  const subscribe = async (visible_to?: string[]) => {
    // The route starts its own first poll in the background; it is pointed at a dead fetch here so the test's polls are the only ones.
    __setPodcastFetchDepsForTests({ dnsLookup: publicDns, now: () => clock, fetch: (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch });
    const res = await owner.post("/api/plugins/podcasts/subscribe", { url: `${HOST}/feed.xml`, ...(visible_to ? { visible_to } : {}) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    __setPodcastFetchDepsForTests(deps);
    expect(res.status).toBe(200);
    const { source_id } = (await res.json()) as { source_id: string };
    return { sourceId: source_id, feedId: db.select().from(mediaSources).where(eq(mediaSources.id, source_id)).get()!.feedId! };
  };
  const poll = async (feedId: string) => { later(); return pollFeed(getFeed(feedId)!, deps); };
  const idOf = async (title: string) => (await data(adult.client, "episodes")).find((row) => row.title === title)!.id;
  return { owner, adult, child, data, subscribe, poll, idOf };
}

describe("parsing", () => {
  test("a feed becomes a show and episodes, newest first, with explicit, duration and chapters from the notes", () => {
    const show = parsePodcastFeed(feedFor(episode4), clock);
    expect(show.title).toBe("Sprout Science");
    expect(show.episodes.map((e) => e.title)).toEqual(["Question 4", "Question 3", "Question 2", "Question 1"]);
    const ep4 = show.episodes.find((e) => e.title === "Question 4")!;
    expect(ep4.durationS).toBe(190);
    expect(ep4.chapters.map((c) => [c.start_s, c.title])).toEqual([[0, "Hello"], [60, "The big idea"], [150, "Goodbye"]]);
    expect(show.episodes.find((e) => e.title === "Question 2")!.explicit).toBe(true);
    expect(show.episodes.find((e) => e.title === "Question 1")!.explicit).toBe(false);
  });
  test("show notes become plain lines; a chapter list needs three climbing lines from the start", () => {
    expect(plainNotes("<p>Hi &amp; welcome</p><p>0:00 One</p>")).toBe("Hi & welcome\n0:00 One");
    expect(chaptersFromNotes("0:00 One\n1:00 Two")).toEqual([]);
    expect(chaptersFromNotes("5:00 One\n6:00 Two\n7:00 Three")).toEqual([]);
  });
});

describe("the one poller reads a podcast feed", () => {
  test("the newest episode lists and streams from its own address; the explicit one is adult-only", async () => {
    const { owner, adult, data, subscribe, poll } = await setup();
    const { sourceId, feedId } = await subscribe();
    expect(await poll(feedId)).toBe("ok");
    const episodes = await data(adult.client, "episodes");
    expect(episodes.map((row) => row.title)).toEqual(["Question 3", "Question 2", "Question 1"]);
    expect(episodes.every((row) => row.copy_label === "Not saved")).toBe(true);
    const item = await data<{ src: string; saved: boolean; duration_s: number }>(adult.client, "item", { id: episodes[0]!.id });
    expect(item.src).toBe(`${HOST}/sprout-ep3.mp3`); // the person's own device plays it; the hub relays nothing
    expect(item.saved).toBe(false);
    expect(item.duration_s).toBe(12);
    const row = db.select().from(mediaItems).where(eq(mediaItems.id, episodes[1]!.id)).get()!;
    expect(row).toMatchObject({ kind: "podcast_episode", bandOk: "adult", advisoryExplicit: true, subtitle: "Sprout Science" });
    expect(JSON.parse(row.external!)).toMatchObject({ extractor: "rss", id: "urn:sprout:ep2" });
    expect((db.select().from(mediaSources).where(eq(mediaSources.id, sourceId)).get()!).label).toBe("Sprout Science");
    // The show's picture was fetched once into the household file store, origin fetched, and the items point at it.
    const art = db.select().from(attachments).all().filter((file) => file.origin === "fetched");
    expect(art).toHaveLength(1);
    expect(art[0]).toMatchObject({ mediaType: "image/png", retention: "kept", conversationId: null });
    expect((await owner.get(`/api/media/items/${episodes[0]!.id}/artwork`)).status).toBe(200);
  });

  test("conditional GET: the second poll sends If-None-Match and If-Modified-Since and gets 304", async () => {
    const { subscribe, poll } = await setup();
    const { feedId } = await subscribe();
    expect(await poll(feedId)).toBe("ok");
    const first = calls.filter((call) => call.path === "/feed.xml");
    expect(first.at(-1)!.headers["if-none-match"]).toBeUndefined();
    expect(await poll(feedId)).toBe("not_modified");
    const second = calls.filter((call) => call.path === "/feed.xml").at(-1)!;
    expect(second.headers["if-none-match"]).toBe('"v1"');
    expect(second.headers["if-modified-since"]).toBe(FEED_MODIFIED);
    expect(second.headers["user-agent"]).toMatch(/MaiPai/i);
    expect(second.headers.cookie).toBeUndefined();
    // A new episode changes the validator: the next poll is a full 200 and adds only the new one.
    feedXml = feedFor(episode4);
    feedEtag = '"v2"';
    expect(await poll(feedId)).toBe("ok");
    expect(db.select().from(mediaItems).all().filter((row) => row.kind === "podcast_episode")).toHaveLength(4);
  });

  test("Save fetches the enclosure into the household file store (origin fetched) and the item then plays from the hub", async () => {
    const { owner, adult, data, subscribe, poll, idOf } = await setup();
    const { feedId } = await subscribe();
    await poll(feedId);
    const id = await idOf("Question 3");
    const saved = await owner.post("/api/plugins/podcasts/save", { media_id: id });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ ok: true, on: true, label: "Saved" });
    const file = db.select().from(attachments).all().find((candidate) => candidate.provenance === "podcast:manual")!;
    expect(file).toMatchObject({ origin: "fetched", mediaType: "audio/mpeg", retention: "kept", size: EPISODE_BYTES.length });
    expect(db.select().from(shares).all().some((share) => share.fileId === file.id && share.to === "household")).toBe(true);
    const item = await data<{ src: string; saved: boolean; copy_label: string }>(adult.client, "item", { id });
    expect(item).toMatchObject({ src: `/api/media/items/${id}/content`, saved: true, copy_label: "Saved" });
    // Another adult reads the bytes (a household share), with Range.
    const range = await adult.client.get(`/api/media/items/${id}/content`, { range: "bytes=10-19" });
    expect(range.status).toBe(206);
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(EPISODE_BYTES.slice(10, 20));
    expect((await data(adult.client, "saved")).map((row) => row.id)).toEqual([id]);
    // The feed's address is kept: Unsave goes back to streaming and removes the copy.
    const removed = await owner.post("/api/plugins/podcasts/save", { media_id: id, on: false });
    expect(await removed.json()).toMatchObject({ on: false, label: "Not saved" });
    expect(db.select().from(attachments).all().filter((candidate) => candidate.provenance === "podcast:manual")).toHaveLength(0);
    expect((await data<{ src: string }>(adult.client, "item", { id })).src).toBe(`${HOST}/sprout-ep3.mp3`);
  });

  test("an episode resumes where it stopped; the show's skip-intro is where a first listen starts; skip-outro counts as played", async () => {
    const { owner, adult, data, subscribe, poll, idOf } = await setup();
    const { sourceId, feedId } = await subscribe();
    await poll(feedId);
    const id = await idOf("Question 3");
    expect((await owner.post("/api/plugins/podcasts/source", { source_id: sourceId, skip_intro_s: 3, skip_outro_s: 2, speed: 1.2 })).status).toBe(200);
    expect(await data(adult.client, "item", { id })).toMatchObject({ position_s: 3, speed: 1.2, skip_outro_s: 2 });
    await adult.client.post("/api/plugins/podcasts/progress", { media_id: id, position_s: "6", duration_s: "12", reason: "pause" });
    flushProgress();
    expect(await data(adult.client, "item", { id })).toMatchObject({ position_s: 6 });
    expect((await data(adult.client, "continue")).map((row) => row.id)).toEqual([id]);
    // Reaching the last 2 seconds finishes it.
    const done = await adult.client.post("/api/plugins/podcasts/progress", { media_id: id, position_s: "10.5", duration_s: "12", reason: "interval" });
    expect(await done.json()).toMatchObject({ completed: true });
  });

  test("a queued episode shows in the queue, plays next and leaves when finished; bookmarks are kept as marks", async () => {
    const { adult, data, subscribe, poll, idOf } = await setup();
    const { feedId } = await subscribe();
    await poll(feedId);
    const three = await idOf("Question 3");
    const one = await idOf("Question 1");
    await adult.client.post("/api/plugins/podcasts/queue", { media_id: three });
    await adult.client.post("/api/plugins/podcasts/queue", { media_id: one, on: true });
    expect((await data(adult.client, "queue")).map((row) => row.id)).toEqual([three, one]);
    expect((await data<Array<{ id: string }>>(adult.client, "up-next", { id: three }))[0]!.id).toBe(one);
    expect(await data(adult.client, "item", { id: three })).toMatchObject({ queued: true });
    const bookmark = await adult.client.post("/api/plugins/podcasts/bookmark", { media_id: three, at_s: "5", label: "good bit" });
    expect(await bookmark.json()).toMatchObject({ ok: true, at_s: 5 });
    expect((await data(adult.client, "bookmarks"))[0]).toMatchObject({ id: three, summary: "Bookmark at 0:05: good bit" });
    await adult.client.post("/api/plugins/podcasts/progress", { media_id: three, position_s: "12", duration_s: "12", reason: "ended" });
    expect((await data(adult.client, "queue")).map((row) => row.id)).toEqual([one]);
  });

  test("auto keep-latest saves the newest N after a poll, never prunes a manual save, and removes played copies", async () => {
    const { owner, adult, data, subscribe, poll, idOf } = await setup();
    const { sourceId, feedId } = await subscribe();
    await owner.post("/api/plugins/podcasts/source", { source_id: sourceId, auto: { save: "audio", keep_latest: 2, remove_watched: true } });
    await poll(feedId);
    const saved = async () => (await data(adult.client, "saved")).map((row) => row.title).sort();
    // The explicit episode is adult-only but the owner is an adult: the newest two (3 and 2) are saved.
    expect(await saved()).toEqual(["Question 2", "Question 3"]);
    const one = await idOf("Question 1");
    await owner.post("/api/plugins/podcasts/save", { media_id: one }); // a person's own save
    // A newer episode arrives: keep the newest 2 = 4 and 3. Auto copy of 2 goes; the manual copy of 1 stays.
    feedXml = feedFor(episode4);
    feedEtag = '"v2"';
    await poll(feedId);
    expect(await saved()).toEqual(["Question 1", "Question 3", "Question 4"]);
    // Everyone who has progress finished 3: its auto copy is removed, and nothing is lost for the manual one.
    await adult.client.post("/api/plugins/podcasts/progress", { media_id: await idOf("Question 3"), position_s: "12", duration_s: "12", reason: "ended" });
    flushProgress();
    expect(await applyAutoRules(sourceId, deps, clock)).toMatchObject({ removed: 1 });
    expect(await saved()).toEqual(["Question 1", "Question 4"]);
  });

  test("deleted stays gone: a removed episode is not brought back by the next poll", async () => {
    const { subscribe, poll, idOf, adult } = await setup();
    const { feedId } = await subscribe();
    await poll(feedId);
    const id = await idOf("Question 1");
    expect(removeItem(id)).toBe(true);
    updateFeed(feedId, { etag: null, lastModified: null }, new Date(clock).toISOString());
    expect(await poll(feedId)).toBe("ok");
    const titles = (await (await adult.client.post("/api/plugins/podcasts/data/episodes", {})).json() as Row[]).map((row) => row.title);
    expect(titles).toEqual(["Question 3", "Question 2"]);
  });

  test("a child sees only child-cleared episodes of a show an adult named for them, never an explicit one", async () => {
    const { owner, adult, child, data, subscribe, poll } = await setup();
    const { feedId } = await subscribe([child.id, adult.id]);
    await poll(feedId);
    expect((await data(child.client, "episodes")).map((row) => row.title)).toEqual(["Question 3", "Question 1"]);
    expect((await data(child.client, "shows")).map((row) => row.title)).toEqual(["Sprout Science"]);
    const explicit = (await data(adult.client, "episodes")).find((row) => row.title === "Question 2")!;
    expect(await data<unknown[]>(child.client, "item", { id: explicit.id })).toEqual([]);
    expect((await child.client.post("/api/plugins/podcasts/queue", { media_id: explicit.id })).status).toBe(404);
    expect((await child.client.get(`/api/media/items/${explicit.id}/artwork`)).status).toBe(404);
    // A child cannot save or add a show, and gets no discovery rows.
    const first = (await data(child.client, "episodes"))[0]!;
    expect((await child.client.post("/api/plugins/podcasts/save", { media_id: first.id })).status).toBe(403);
    expect((await child.client.post("/api/plugins/podcasts/subscribe", { url: `${HOST}/other.xml` })).status).toBe(403);
    expect(await data<unknown[]>(child.client, "new")).toEqual([]);
    // A show nobody named for the child is not on their list at all.
    await owner.post("/api/plugins/podcasts/source", { source_id: (await subscribeAgainHidden(owner)), visible_to: [adult.id] });
    expect((await data(child.client, "shows")).map((row) => row.title)).toEqual(["Sprout Science"]);
  });

  test("only an adult admin adds or removes a show; an address on a private network is refused", async () => {
    const { owner, adult } = await setup();
    expect((await adult.client.post("/api/plugins/podcasts/subscribe", { url: `${HOST}/feed.xml` })).status).toBe(403);
    expect((await owner.post("/api/plugins/podcasts/subscribe", { url: "http://pod.example.com/feed.xml" })).status).toBe(400);
    const lan = await owner.post("/api/plugins/podcasts/subscribe", { url: "https://192.168.1.20/feed.xml" });
    expect(lan.status).toBe(400);
    expect(((await lan.json()) as { error: string }).error).toMatch(/home network/);
    expect((await adult.client.post("/api/plugins/podcasts/unsubscribe", { source_id: "msrc-nothing01" })).status).toBe(403);
  });

  test("removing a show stops its polling and hides its episodes", async () => {
    const { owner, adult, data, subscribe, poll } = await setup();
    const { sourceId, feedId } = await subscribe();
    await poll(feedId);
    expect((await owner.post("/api/plugins/podcasts/unsubscribe", { source_id: sourceId })).status).toBe(200);
    expect(getFeed(feedId)).toBeNull();
    expect(await data<unknown[]>(adult.client, "episodes")).toEqual([]);
  });
});

async function subscribeAgainHidden(owner: TestClient): Promise<string> {
  const res = await owner.post("/api/plugins/podcasts/subscribe", { url: `${HOST}/second.xml`, visible_to: [] });
  return ((await res.json()) as { source_id: string }).source_id;
}

describe("OPML", () => {
  test("export then import round-trips the show list; bad and repeated addresses are reported, not fatal", async () => {
    const { owner, subscribe } = await setup();
    await subscribe();
    const exported = await owner.get("/api/plugins/podcasts/opml/export");
    expect(exported.status).toBe(200);
    const opml = await exported.text();
    expect(opml).toContain(`xmlUrl="${HOST}/feed.xml"`);
    expect(opml).not.toMatch(/person-|media-/);
    // The same file again: already there.
    expect(await (await owner.post("/api/plugins/podcasts/opml/import", { opml })).json()).toMatchObject({ added: 0, already: 1 });
    // After removing the show, the file brings it back, and a plain-http line is skipped with its reason.
    const sourceId = db.select().from(mediaSources).all().find((row) => row.kind === "feed")!.id;
    await owner.post("/api/plugins/podcasts/unsubscribe", { source_id: sourceId });
    const mixed = opml.replace("</body>", '<outline type="rss" text="Plain" xmlUrl="http://plain.example.com/f.xml"/></body>');
    const result = (await (await owner.post("/api/plugins/podcasts/opml/import", { opml: mixed })).json()) as { added: number; skipped: Array<{ reason: string }> };
    expect(result.added).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/https/);
    expect(db.select().from(mediaSources).all().filter((row) => row.kind === "feed" && !row.deletedAt)).toHaveLength(1);
    expect((await owner.post("/api/plugins/podcasts/opml/import", { opml: "not xml at all" })).status).toBe(400);
  });
});
