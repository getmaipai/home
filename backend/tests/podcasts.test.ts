// Podcasts use an in-memory fake fetch and public DNS fixture. No server or network is needed.
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversationTurns, fileReferences, mediaCollections, mediaItems, mediaSources, shares, people } from "@/db/schema";
import { evaluateFilter, filterSummary } from "@/lib/media/podcastFilters";
import { sharedWith } from "@/lib/media/collections";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetProgressForTests, flushProgress } from "@/lib/media/progress";
import { removeItem } from "@/lib/media/items";
import { __setPodcastFetchDepsForTests, applyAutoRules, queuePodcastAutoRules, drainPodcastAutoRules, saveEpisode, chaptersFromNotes, parsePodcastFeed, plainNotes } from "@/lib/media/podcasts";
import { getFeed, listFeeds, updateFeed } from "@/lib/shelf/feedStore";
import { privacyConnections } from "@/lib/privacy";
import { pollFeed, type PollDeps } from "@/lib/shelf/shelfPoller";
import { __resetShelfCountersForTests } from "@/lib/shelf/shelfCounters";

import { createFetchedFile } from "@/lib/media/fetchedFiles";
import { attachmentFilePath, createAttachment, readAttachment } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { createShare } from "@/lib/shares";
import { purgeExpired } from "@/lib/trash/registry";
import { nextHlc } from "@/lib/hlc";
import { newConversationTurnId, newMediaItemId, newShareId } from "@/lib/id";
import { setHouseholdSettingValue } from "@/lib/settings";
import { syncShelfFeeds } from "@/lib/shelf/shelfFeeds";
import { runShelfTick } from "@/lib/shelf/shelfJobs";

const HOST = "https://pod.example.com";
const EPISODE_BYTES = new Uint8Array(4096).map((_, index) => (index * 7) % 251);
/** Each episode has its own bytes (the file store keeps identical bytes once, which would make the three one file). */
const episodeBytes = (n: number): Uint8Array => EPISODE_BYTES.map((value, index) => (index === 0 ? n : value));
const ART_BYTES = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

interface Call { path: string; headers: Record<string, string> }
let calls: Call[];
let feedXml: string;
let feedEtag: string;
const FEED_MODIFIED = "Thu, 15 Oct 2026 06:00:00 GMT";

const template = readFileSync(join(import.meta.dir, "fixtures/podcast/feed.xml.tmpl"), "utf8");
const feedFor = (extraItem = ""): string => template.replaceAll("__BASE__", HOST).replace("</channel>", `${extraItem}</channel>`);
const episode4 = `<item><title>Question 4</title><guid isPermaLink="false">urn:sprout:ep4</guid><pubDate>Fri, 14 Oct 2026 06:00:00 GMT</pubDate><description>Episode 4.&lt;br&gt;0:00 Hello&lt;br&gt;1:00 The big idea&lt;br&gt;2:30 Goodbye</description><enclosure url="${HOST}/sprout-ep4.mp3" length="4096" type="audio/mpeg"/><itunes:duration>00:03:10</itunes:duration></item>`;

const fixtureFetch = async (input: URL | string, init?: RequestInit): Promise<Response> => {
      const request = new Request(String(input), init);
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
};

let clock = Date.parse("2026-10-15T12:00:00Z");
const publicDns = async () => ({ address: "93.184.216.34", family: 4 });
const deps: PollDeps = {
  dnsLookup: publicDns,
  now: () => clock,
  fetch: fixtureFetch as unknown as typeof fetch,
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
  await owner.post("/api/auth/setup", { displayName: "Atlas", secret: "correcthorse" });
  const signIn = async (displayName: string, role: string) => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...(role === "child" ? { birthdate: "2018-03-01" } : {}) });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return { client, id: created.id };
  };
  const adult = await signIn("Nova", "adult");
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
  const poll = async (feedId: string) => { later(); const result = await pollFeed(getFeed(feedId)!, deps); await drainPodcastAutoRules(); return result; };
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
    expect(episodes[0]!.channel).toMatch(/ · Sprout Science$/); // "Today · The show", as Apple Podcasts says it
    const item = await data<{ src: string; saved: boolean; duration_s: number }>(adult.client, "item", { id: episodes[0]!.id });
    expect(item.src).toBe(`${HOST}/sprout-ep3.mp3`); // the person's own device plays it; the hub relays nothing
    expect(item.saved).toBe(false);
    expect(item.duration_s).toBe(12);
    expect((item as unknown as { channel: string }).channel).toBe("Sprout Science"); // the player's artist line is the show alone
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
    expect(db.select().from(shares).all().some((share) => share.fileId === file.id && share.to === "household")).toBe(false);
    const item = await data<{ src: string; saved: boolean; copy_label: string }>(adult.client, "item", { id });
    expect(item).toMatchObject({ src: `/api/media/items/${id}/content`, saved: true, copy_label: "Saved" });
    // Another adult reads the bytes through the media gate, with Range.
    const range = await adult.client.get(`/api/media/items/${id}/content`, { range: "bytes=10-19" });
    expect(range.status).toBe(206);
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(EPISODE_BYTES.slice(10, 20));
    expect((await data(adult.client, "saved")).map((row) => row.id)).toEqual([id]);
    // The feed's address is kept: Unsave goes back to streaming and removes the copy.
    const removed = await owner.post("/api/plugins/podcasts/save", { media_id: id, on: false });
    expect(await removed.json()).toMatchObject({ on: false, label: "Not saved" });
    expect(db.select().from(attachments).all().filter((candidate) => candidate.provenance === "podcast:manual")).toHaveLength(1);
    expect(((await (await owner.get("/api/trash")).json()) as { rows: unknown[] }).rows).toHaveLength(1);
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

describe("the privacy page", () => {
  test("lists each podcast feed host with a conditional request and no identity, and only while a show is followed", async () => {
    const { owner, subscribe } = await setup();
    expect(privacyConnections().some((row) => row.id === "platform:podcast-feeds")).toBe(false);
    const { sourceId } = await subscribe();
    const row = privacyConnections().find((candidate) => candidate.id === "platform:podcast-feeds")!;
    expect(row.destination).toBe("pod.example.com");
    expect(row.what).toMatch(/conditional request/);
    expect(row.what).toMatch(/No name, device ID or cookie/);
    expect(row.when).toMatch(/keep rules/i);
    expect(row.what).toMatch(/picture.*hosts|hosts.*picture/);
    expect(row.what).toMatch(/redirect/);
    await owner.post("/api/plugins/podcasts/unsubscribe", { source_id: sourceId });
    expect(privacyConnections().some((candidate) => candidate.id === "platform:podcast-feeds")).toBe(false);
  });
});

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


describe("Podcasts review regressions", () => {
  test("fetched files ignore legacy household shares; only gated media routes serve an explicit copy", async () => {
    const { owner, adult, child, subscribe, poll, idOf } = await setup();
    const { sourceId, feedId } = await subscribe([child.id, adult.id]);
    await poll(feedId);
    // Allow the admin to make the save, then restore the source audience.
    db.update(mediaSources).set({ visibleTo: '"household"' }).where(eq(mediaSources.id, sourceId)).run();
    const id = await idOf("Question 2");
    expect((await owner.post("/api/plugins/podcasts/save", { media_id: id })).status).toBe(200);
    const file = db.select().from(attachments).all().find((row) => row.provenance === "podcast:manual")!;
    const atlas = db.select().from(people).where(eq(people.id, file.ownerPersonId)).get()!;
    expect(createShare(atlas, { fileId: file.id, to: "household" }).ok).toBe(false);
    expect(db.select().from(shares).all().filter((row) => row.fileId === file.id)).toEqual([]);
    // Old installations may still have these pointers. They must grant no access.
    db.insert(shares).values({ id: newShareId(), fileId: file.id, fromPersonId: file.ownerPersonId, to: "household", provenance: "fixture", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
    const guestMade = await owner.post("/api/people", { displayName: "Pippa", role: "guest", secret: "0000" });
    const guestId = ((await guestMade.json()) as { id: string }).id;
    const guest = new TestClient();
    await guest.post("/api/auth/verify-secret", { personId: guestId, secret: "0000" });
    for (const client of [child.client, guest, adult.client]) {
      const files = await (await client.get("/api/files")).json() as Array<{ file: { id: string } }>;
      expect(files.some((row) => row.file.id === file.id)).toBe(false);
      expect((await client.get(`/api/files/${file.id}/content`)).status).toBe(404);
    }
    expect((await child.client.get(`/api/media/items/${id}/content`)).status).toBe(404);
    expect((await adult.client.get(`/api/media/items/${id}/content`)).status).toBe(200);
    expect((await adult.client.get(`/api/media/items/${id}/artwork`)).status).toBe(200);
    db.update(mediaSources).set({ visibleTo: JSON.stringify([child.id]) }).where(eq(mediaSources.id, sourceId)).run();
    expect((await adult.client.get(`/api/media/items/${id}/content`)).status).toBe(404);
    await owner.post("/api/plugins/podcasts/unsubscribe", { source_id: sourceId });
    expect((await child.client.get(`/api/files/${file.id}/content`)).status).toBe(404);
  });

  test("dedupe never reuses a chat upload or another owner's fetched file", async () => {
    const { adult, subscribe } = await setup();
    const { sourceId } = await subscribe();
    const atlas = db.select().from(people).all().find((row) => row.role === "owner")!;
    const nova = db.select().from(people).where(eq(people.id, adult.id)).get()!;
    const input = { mediaType: "audio/mpeg", bytes: EPISODE_BYTES, mediaSourceId: sourceId, note: "podcast:auto" };
    const first = createFetchedFile(atlas, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    db.update(attachments).set({ origin: "sent", provenance: "private-chat" }).where(eq(attachments.id, first.value.id)).run();
    const second = createFetchedFile(atlas, input);
    const third = createFetchedFile(nova, input);
    expect(second.ok && second.value.id).not.toBe(first.value.id);
    expect(third.ok && third.value.id).not.toBe(second.ok && second.value.id);
    expect(db.select().from(shares).all()).toEqual([]);
    expect(db.select().from(attachments).where(eq(attachments.id, first.value.id)).get()!.provenance).toBe("private-chat");
  });

  test("a chat upload with a saved episode's bytes gets its own file, never the fetched copy or a share to it", async () => {
    const { adult, subscribe } = await setup();
    const { sourceId } = await subscribe();
    const atlas = db.select().from(people).all().find((row) => row.role === "owner")!;
    const fetched = createFetchedFile(atlas, { mediaType: "audio/mpeg", bytes: EPISODE_BYTES, mediaSourceId: sourceId, note: "podcast:manual" });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    const nova = db.select().from(people).where(eq(people.id, adult.id)).get()!;
    const conversation = resolveOrCreateConversation(nova, "chat");
    if (!conversation.ok) throw new Error(conversation.error);
    const turnId = newConversationTurnId();
    db.insert(conversationTurns).values({ id: turnId, personId: nova.id, surface: "chat", conversationId: conversation.value.id, userText: "note", replyText: "ok",
      source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
    const upload = createAttachment(nova, { conversationId: conversation.value.id, turnId, mediaType: "audio/mpeg", bytes: EPISODE_BYTES });
    expect(upload.ok).toBe(true);
    if (!upload.ok) return;
    expect(upload.value.id).not.toBe(fetched.value.id);
    expect(db.select().from(shares).all().filter((row) => row.fileId === fetched.value.id)).toEqual([]);
    expect(readAttachment(nova, upload.value.id).ok).toBe(true);
  });

  test("a saved copy whose file left with its owner can be cleared by an admin and saved again", async () => {
    const { owner, subscribe, poll, idOf } = await setup();
    const { feedId } = await subscribe();
    await poll(feedId);
    const id = await idOf("Question 3");
    expect((await owner.post("/api/plugins/podcasts/save", { media_id: id })).status).toBe(200);
    const fileId = db.select().from(mediaItems).where(eq(mediaItems.id, id)).get()!.locFileId!;
    db.delete(fileReferences).where(eq(fileReferences.fileId, fileId)).run();
    db.delete(attachments).where(eq(attachments.id, fileId)).run();
    expect((await owner.post("/api/plugins/podcasts/save", { media_id: id, on: false })).status).toBe(200);
    expect(db.select().from(mediaItems).where(eq(mediaItems.id, id)).get()!.locFileId).toBeNull();
    db.update(mediaItems).set({ locFileId: fileId }).where(eq(mediaItems.id, id)).run();
    expect((await owner.post("/api/plugins/podcasts/save", { media_id: id })).status).toBe(200);
    const saved = db.select().from(mediaItems).where(eq(mediaItems.id, id)).get()!.locFileId;
    expect(saved).not.toBe(fileId);
    expect(db.select().from(attachments).where(eq(attachments.id, saved!)).get()).toBeTruthy();
  });

  test("OPML import only schedules due feeds and makes no per-feed requests", async () => {
    const { owner } = await setup();
    let requests = 0;
    __setPodcastFetchDepsForTests({ ...deps, fetch: (async () => { requests++; return new Response("offline", { status: 503 }); }) as unknown as typeof fetch });
    const opml = `<opml version="2.0"><head/><body>${Array.from({ length: 200 }, (_, i) => `<outline type="rss" xmlUrl="https://pod${i}.example.com/feed.xml"/>`).join("")}</body></opml>`;
    expect(await (await owner.post("/api/plugins/podcasts/opml/import", { opml })).json()).toMatchObject({ added: 200 });
    expect(requests).toBe(0);
    expect(listFeeds("podcast")).toHaveLength(200);
    expect(listFeeds("podcast").every((feed) => Date.parse(feed.next_poll_at) <= Date.now())).toBe(true);
  });

  test("a slow auto-save does not hold the poll tick and one source never runs twice", async () => {
    const { subscribe } = await setup();
    const { sourceId, feedId } = await subscribe();
    db.update(mediaSources).set({ auto: JSON.stringify({ save: "audio", keep_latest: 1, remove_watched: false }) }).where(eq(mediaSources.id, sourceId)).run();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let downloads = 0;
    let started!: () => void;
    const downloading = new Promise<void>((resolve) => { started = resolve; });
    const slow: PollDeps = { ...deps, fetch: (async (input: URL | string, init?: RequestInit) => {
      if (String(input).endsWith(".mp3")) { downloads++; started(); await held; }
      return fixtureFetch(input, init);
    }) as unknown as typeof fetch };
    later();
    const result = await Promise.race([pollFeed(getFeed(feedId)!, slow), new Promise((resolve) => setTimeout(() => resolve("held-by-download"), 100))]);
    try {
      expect(result).toBe("ok");
      await downloading;
      const duplicate = applyAutoRules(sourceId, slow, clock);
      queuePodcastAutoRules(sourceId, slow, clock);
      expect(downloads).toBe(1);
      release();
      await duplicate;
      await drainPodcastAutoRules();
      expect(downloads).toBe(1);
    } finally { release(); await drainPodcastAutoRules(); }
  });

  test("keep rules can save a show named only for a child while its copies stay behind the item gate", async () => {
    const { owner, child, subscribe, poll } = await setup();
    const { sourceId, feedId } = await subscribe([child.id]);
    await owner.post("/api/plugins/podcasts/source", { source_id: sourceId, auto: { save: "audio", keep_latest: 1 } });
    await poll(feedId);
    const episode = db.select().from(mediaItems).all().find((row) => row.title === "Question 3" && !row.deletedAt)!;
    expect(episode.locFileId).not.toBeNull();
    expect((await child.client.get(`/api/media/items/${episode.id}/content`)).status).toBe(200);
    expect((await child.client.get(`/api/files/${episode.locFileId}/content`)).status).toBe(404);
  });

  test("a 304 check queues keep rules without downloading inside the tick", async () => {
    const { adult, data, subscribe, poll } = await setup();
    const { sourceId, feedId } = await subscribe();
    await poll(feedId);
    db.update(mediaSources).set({ auto: JSON.stringify({ save: "audio", keep_latest: 1 }) }).where(eq(mediaSources.id, sourceId)).run();
    expect(await poll(feedId)).toBe("not_modified");
    expect((await data(adult.client, "saved")).map((row) => row.title)).toEqual(["Question 3"]);
  });

  test("media playback keeps the saved file integrity check without a full-file buffer", async () => {
    const { owner, adult, subscribe, poll, idOf } = await setup();
    const { feedId } = await subscribe();
    await poll(feedId);
    const id = await idOf("Question 3");
    await owner.post("/api/plugins/podcasts/save", { media_id: id });
    const file = db.select().from(attachments).all().find((row) => row.provenance === "podcast:manual")!;
    writeFileSync(attachmentFilePath(file.storagePath), new Uint8Array(file.size).fill(99));
    expect((await adult.client.get(`/api/media/items/${id}/content`)).status).toBe(404);
  });

  test("storage caps reject a known enclosure before GET and a header before reading its body", async () => {
    const { subscribe, poll, idOf } = await setup();
    const { feedId } = await subscribe();
    await poll(feedId);
    const id = await idOf("Question 3");
    const atlas = db.select().from(people).all().find((row) => row.role === "owner")!;
    setHouseholdSettingValue("storage.person.default_cap_bytes", 1000);
    let fetched = 0;
    let cancelled = false;
    const fake: PollDeps = { ...deps, fetch: (async () => {
      fetched++;
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-length": "4096", "content-type": "audio/mpeg" } });
    }) as unknown as typeof fetch };
    expect((await saveEpisode(atlas, id, { deps: fake })).ok).toBe(false);
    expect(fetched).toBe(0);
    db.update(mediaItems).set({ size: null }).where(eq(mediaItems.id, id)).run();
    expect((await saveEpisode(atlas, id, { deps: fake })).ok).toBe(false);
    expect(fetched).toBe(1);
    expect(cancelled).toBe(true);
    expect(db.select().from(attachments).all().filter((row) => row.provenance === "podcast:manual")).toEqual([]);
  });

  test("an unknown-length download stops at the cap and leaves no file record", async () => {
    const { subscribe, poll, idOf } = await setup();
    const { feedId } = await subscribe();
    await poll(feedId);
    const id = await idOf("Question 3");
    db.update(mediaItems).set({ size: null }).where(eq(mediaItems.id, id)).run();
    const atlas = db.select().from(people).all().find((row) => row.role === "owner")!;
    setHouseholdSettingValue("storage.person.default_cap_bytes", 1000);
    let cancelled = false;
    let pulls = 0;
    const fake: PollDeps = { ...deps, fetch: (async () => new Response(new ReadableStream({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(600)); },
      cancel() { cancelled = true; },
    }), { headers: { "content-type": "audio/mpeg" } })) as unknown as typeof fetch };
    const result = await saveEpisode(atlas, id, { deps: fake });
    expect(result.ok).toBe(false);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(3);
    const directory = join(attachmentFilePath(db.select().from(attachments).all()[0]!.storagePath), "..");
    expect(readdirSync(directory).some((name) => name.endsWith(".download"))).toBe(false);
    expect(db.select().from(attachments).all().filter((row) => row.provenance === "podcast:manual")).toEqual([]);
  });

  test("news skips a podcast address and a sync failure cannot stop due podcast polling", async () => {
    const { subscribe } = await setup();
    const { feedId } = await subscribe();
    setHouseholdSettingValue("news.feeds.adult", `${HOST}/feed.xml`);
    expect(() => syncShelfFeeds({ store: null })).not.toThrow();
    expect(getFeed(feedId)!.purpose).toBe("podcast");
    const failingStore = { forgetFeed() { throw new Error("fixture failure"); } } as unknown as NonNullable<PollDeps["store"]>;
    const { createFeed } = await import("@/lib/shelf/feedStore");
    createFeed({ url: "https://unused.example.com/feed.xml", title: "Nova", publisher: "Nova", band: "adult", pollIntervalS: 3600, nowIso: new Date(clock).toISOString(), provenance: "fixture" });
    later();
    updateFeed(feedId, { nextPollAt: new Date(clock).toISOString(), quietUntil: null }, new Date(clock).toISOString());
    await runShelfTick({ ...deps, busy: () => false, store: failingStore });
    expect(db.select().from(mediaItems).all().filter((row) => row.kind === "podcast_episode")).toHaveLength(3);
  });

  test("only a copy owner or admin may unsave; the copy goes to restorable household Trash", async () => {
    const { owner, adult, child, subscribe, poll, idOf } = await setup();
    const { feedId } = await subscribe();
    await poll(feedId);
    const id = await idOf("Question 2");
    await owner.post("/api/plugins/podcasts/save", { media_id: id });
    const file = db.select().from(attachments).all().find((row) => row.provenance === "podcast:manual")!;
    expect((await adult.client.post("/api/plugins/podcasts/save", { media_id: id, on: false })).status).toBe(403);
    expect((await owner.post("/api/plugins/podcasts/save", { media_id: id, on: false })).status).toBe(200);
    expect(existsSync(attachmentFilePath(file.storagePath))).toBe(true);
    const trash = await (await owner.get("/api/trash")).json() as { rows: Array<{ id: string; kind: string }> };
    expect(trash.rows).toHaveLength(1);
    const copy = trash.rows[0]!;
    expect((await (await child.client.get("/api/trash")).json() as { rows: unknown[] }).rows).toEqual([]);
    expect((await adult.client.post(`/api/trash/${copy.kind}/${copy.id}/restore`)).status).toBe(404);
    expect((await owner.post(`/api/trash/${copy.kind}/${copy.id}/restore`)).status).toBe(200);
    expect(db.select().from(mediaItems).where(eq(mediaItems.id, id)).get()!.locFileId).toBe(file.id);
    // An admin can also remove a copy owned by an adult.
    db.update(attachments).set({ ownerPersonId: adult.id }).where(eq(attachments.id, file.id)).run();
    expect((await owner.post("/api/plugins/podcasts/save", { media_id: id, on: false })).status).toBe(200);
    const secondTrash = ((await (await owner.get("/api/trash")).json()) as { rows: Array<{ id: string; kind: string }> }).rows[0]!;
    expect((await owner.post(`/api/trash/media_item/${secondTrash.id}/restore`)).status).toBe(404);
    expect((await adult.client.request(`/api/trash/${secondTrash.kind}/${secondTrash.id}`, { method: "DELETE" })).status).toBe(200);
    expect(existsSync(attachmentFilePath(file.storagePath))).toBe(false);
    expect(db.select().from(mediaItems).where(eq(mediaItems.id, id)).get()!.deletedAt).toBeNull();
    expect(JSON.parse(db.select().from(mediaSources).where(eq(mediaSources.id, file.mediaSourceId!)).get()!.archive)).toEqual([]);
  });

  test("copy expiry uses the copy provider and leaves the streaming episode and its guid alone", async () => {
    const { owner, subscribe, poll, idOf } = await setup();
    const { sourceId, feedId } = await subscribe();
    await poll(feedId);
    const id = await idOf("Question 3");
    await owner.post("/api/plugins/podcasts/save", { media_id: id });
    const file = db.select().from(attachments).all().find((row) => row.provenance === "podcast:manual")!;
    await owner.post("/api/plugins/podcasts/save", { media_id: id, on: false });
    purgeExpired(new Date(Date.now() + 31 * 86_400_000));
    expect(existsSync(attachmentFilePath(file.storagePath))).toBe(false);
    expect(db.select().from(mediaItems).where(eq(mediaItems.id, id)).get()!.deletedAt).toBeNull();
    expect(JSON.parse(db.select().from(mediaSources).where(eq(mediaSources.id, sourceId)).get()!.archive)).toEqual([]);
  });

  test("http enclosures use https for stream and save; five redirects work and a sixth explains the next step", async () => {
    const { adult, data, subscribe, poll, idOf } = await setup();
    const { feedId } = await subscribe();
    feedXml = feedXml.replaceAll(`${HOST}/sprout-ep`, "http://pod.example.com/sprout-ep");
    await poll(feedId);
    const id = await idOf("Question 3");
    expect((await data<{ src: string }>(adult.client, "item", { id })).src).toBe(`${HOST}/sprout-ep3.mp3`);
    const atlas = db.select().from(people).all().find((row) => row.role === "owner")!;
    let hops = 0;
    const redirecting: PollDeps = { ...deps, fetch: (async (input: URL | string) => {
      expect(String(input).startsWith("https://")).toBe(true);
      return hops++ < 5 ? new Response(null, { status: 302, headers: { location: `${HOST}/hop${hops}` } }) : new Response(EPISODE_BYTES, { headers: { "content-type": "audio/mpeg" } });
    }) as unknown as typeof fetch };
    expect((await saveEpisode(atlas, id, { deps: redirecting })).ok).toBe(true);
    db.update(mediaItems).set({ locFileId: null }).where(eq(mediaItems.id, id)).run();
    later();
    const looping: PollDeps = { ...deps, fetch: (async () => new Response(null, { status: 302, headers: { location: `${HOST}/loop` } })) as unknown as typeof fetch };
    const failed = await saveEpisode(atlas, id, { deps: looping });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toMatch(/redirect.*[Tt]ry|redirect.*[Aa]sk/);
  });

  test("legacy shared art survives the first unsubscribe and is removed after the last show stops using it", async () => {
    const { owner, subscribe, poll } = await setup();
    const { sourceId, feedId } = await subscribe();
    await poll(feedId);
    const episode = db.select().from(mediaItems).all()[0]!;
    const art = db.select().from(attachments).all().find((row) => row.provenance === "podcast:art")!;
    const secondId = await subscribeAgainHidden(owner);
    db.insert(mediaItems).values({ ...episode, id: newMediaItemId(), sourceId: secondId }).run();
    await owner.post("/api/plugins/podcasts/unsubscribe", { source_id: sourceId });
    expect(existsSync(attachmentFilePath(art.storagePath))).toBe(true);
    await owner.post("/api/plugins/podcasts/unsubscribe", { source_id: secondId });
    expect(existsSync(attachmentFilePath(art.storagePath))).toBe(false);
    expect(db.select().from(attachments).where(eq(attachments.id, art.id)).get()).toBeUndefined();
  });

  test("unsubscribe removes the show's fetched art but keeps its saved episodes private", async () => {
    const { owner, child, subscribe, poll, idOf } = await setup();
    const { sourceId, feedId } = await subscribe();
    await poll(feedId);
    await owner.post("/api/plugins/podcasts/save", { media_id: await idOf("Question 2") });
    const art = db.select().from(attachments).all().find((row) => row.provenance === "podcast:art")!;
    const copy = db.select().from(attachments).all().find((row) => row.provenance === "podcast:manual")!;
    await owner.post("/api/plugins/podcasts/unsubscribe", { source_id: sourceId });
    expect(db.select().from(attachments).where(eq(attachments.id, art.id)).get()).toBeUndefined();
    expect(existsSync(attachmentFilePath(art.storagePath))).toBe(false);
    expect(db.select().from(attachments).where(eq(attachments.id, copy.id)).get()).toBeDefined();
    const sprout = db.select().from(people).where(eq(people.id, child.id)).get()!;
    expect(readAttachment(sprout, copy.id).ok).toBe(false);
  });
});

// PODCAST-PORT-03: saved episode filters (media-collection kind filter, rules from spec-v0.1.261).
describe("smart filters", () => {
  const ep = (id: string, over: Partial<{ duration_s: number | null; url: boolean; at: string; source: string }> = {}) => ({
    id, source_id: over.source ?? "msrc-aaaaaa", duration_s: over.duration_s === undefined ? 600 : over.duration_s, added_at: "2026-10-01T00:00:00Z",
    location: over.url === false ? { path: "x" } : { url: "https://pod.example.com/x.mp3" }, external: { published_at: over.at ?? "2026-10-10T00:00:00Z" },
  }) as unknown as import("@/lib/media/model").MediaItem;
  const prog = (id: string, seconds: number, completed = false) => ({ media_id: id, position: { seconds }, completed }) as unknown as import("@/lib/media/model").MediaProgress;
  const NOW = Date.parse("2026-10-20T00:00:00Z");
  const run = (rules: import("@/lib/media/podcastFilters").FilterRules, items: ReturnType<typeof ep>[], progress: ReturnType<typeof prog>[] = []) =>
    evaluateFilter(rules, items, progress, NOW).map((item) => item.id);

  test("unplayed, in progress and saved read the person's own progress and the copy on the hub", () => {
    const items = [ep("media-new"), ep("media-half"), ep("media-done"), ep("media-kept", { url: false })];
    const progress = [prog("media-half", 30), prog("media-done", 600, true)];
    expect(run({ unplayed: true }, items, progress).sort()).toEqual(["media-kept", "media-new"]);
    expect(run({ in_progress: true }, items, progress)).toEqual(["media-half"]);
    expect(run({ saved: true }, items, progress)).toEqual(["media-kept"]);
    expect(run({}, items, progress)).toHaveLength(4);
  });
  test("length edges are inclusive and an episode with no length never matches a length rule", () => {
    const items = [ep("media-a", { duration_s: 600 }), ep("media-b", { duration_s: 601 }), ep("media-c", { duration_s: null })];
    expect(run({ max_minutes: 10 }, items)).toEqual(["media-a"]);
    expect(run({ min_minutes: 10 }, items).sort()).toEqual(["media-a", "media-b"]);
    expect(run({ min_minutes: 10, max_minutes: 10 }, items)).toEqual(["media-a"]);
  });
  test("released within N days counts back from now, and a show rule keeps only those shows", () => {
    const items = [ep("media-a", { at: "2026-10-13T00:00:00Z", source: "msrc-aaaaaa" }), ep("media-b", { at: "2026-10-12T23:59:59Z", source: "msrc-bbbbbb" })];
    expect(run({ released_within_days: 7 }, items)).toEqual(["media-a"]);
    expect(run({ source_ids: ["msrc-bbbbbb"] }, items)).toEqual(["media-b"]);
    expect(run({ source_ids: ["msrc-bbbbbb"], released_within_days: 7 }, items)).toEqual([]);
  });
  test("a summary says what the filter does", () => {
    expect(filterSummary({ unplayed: true, max_minutes: 30, released_within_days: 14 })).toBe("Unplayed · Under 30 min · Last 14 days");
    expect(filterSummary(null)).toBe("Every episode");
  });

  test("make, apply, list, survive a restart, and delete a filter by the routes", async () => {
    const { adult, owner, data, subscribe, poll, idOf } = await setup();
    const { sourceId, feedId } = await subscribe();
    await poll(feedId);
    const made = await adult.client.post("/api/plugins/podcasts/filters", { title: "Short and new", unplayed: "true", max_minutes: "1", released_within_days: "3650", show: "sprout" });
    expect(made.status).toBe(200);
    const filter = ((await made.json()) as { filter: { id: string; rules: Record<string, unknown> } }).filter;
    expect(filter.rules).toEqual({ unplayed: true, max_minutes: 1, source_ids: [sourceId], released_within_days: 3650 });
    expect((await data<{ id: string; title: string; summary: string }[]>(adult.client, "filters")).map((r) => [r.id, r.title, r.summary])).toEqual([[filter.id, "Short and new", "Unplayed · Under 1 min · Sprout Science · Last 3650 days"]]);
    expect((await data(adult.client, "filter-episodes", { filter: filter.id })).map((r) => r.title)).toEqual(["Question 3", "Question 2", "Question 1"]);
    // Playing one finishes it: it leaves an unplayed filter.
    await adult.client.post("/api/plugins/podcasts/progress", { media_id: await idOf("Question 3"), position_s: "12", duration_s: "12", reason: "ended" });
    flushProgress(adult.id);
    expect((await data(adult.client, "filter-episodes", { filter: filter.id })).map((r) => r.title)).toEqual(["Question 2", "Question 1"]);
    // The rules are stored on the collection row, so a restart (a fresh process reading the same database) finds them.
    const row = db.select().from(mediaCollections).where(eq(mediaCollections.id, filter.id)).get()!;
    expect(row).toMatchObject({ kind: "filter", personId: adult.id, items: "[]" });
    expect(JSON.parse(row.rules!)).toEqual(filter.rules);
    __resetProgressForTests();
    expect((await data(adult.client, "filter-episodes", { filter: filter.id })).map((r) => r.title)).toEqual(["Question 2", "Question 1"]);
    // Edit in place, keep the id.
    const edited = await adult.client.post("/api/plugins/podcasts/filters", { id: filter.id, title: "Anything", max_minutes: "0" });
    expect(((await edited.json()) as { filter: { id: string } }).filter.id).toBe(filter.id);
    expect(await data<unknown[]>(adult.client, "filter-episodes", { filter: filter.id })).toEqual([]);
    // Private: another person sees none of it and cannot delete or read it.
    expect(await data<unknown[]>(owner, "filters")).toEqual([]);
    expect(await data<unknown[]>(owner, "filter-episodes", { filter: filter.id })).toEqual([]);
    expect((await owner.request(`/api/plugins/podcasts/filters/${filter.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await adult.client.request(`/api/plugins/podcasts/filters/${filter.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await data<unknown[]>(adult.client, "filters")).toEqual([]);
  });

  test("the new-filter pickers give one Save row that posts the chosen rules, and none when nothing is chosen", async () => {
    const { adult, data, subscribe, poll } = await setup();
    const { sourceId, feedId } = await subscribe();
    await poll(feedId);
    expect(await data<unknown[]>(adult.client, "filter-draft", {})).toEqual([]);
    const [row] = await data<Array<Record<string, string>>>(adult.client, "filter-draft", { status: "unplayed", length: "u30", within: "7", show: sourceId });
    expect(row).toMatchObject({ title: "Save this filter", summary: "Unplayed · Under 30 min · Sprout Science · Last 7 days", unplayed: "true", in_progress: "", max_minutes: "30", released_within_days: "7", source_id: sourceId });
    const { id: _id, title: _title, summary: _summary, ...fields } = row!;
    const saved = await adult.client.post("/api/plugins/podcasts/filters", fields);
    expect(((await saved.json()) as { filter: { rules: unknown } }).filter.rules).toEqual({ unplayed: true, max_minutes: 30, source_ids: [sourceId], released_within_days: 7 });
    // An option that is not one of the offered values means nothing.
    expect(await data<unknown[]>(adult.client, "filter-draft", { length: "u999", within: "1", status: "x" })).toEqual([]);
  });

  test("bad rules say what to fix; a filter is never a standing or shared collection", async () => {
    const { adult, subscribe } = await setup();
    await subscribe();
    const post = async (body: Record<string, unknown>) => { const res = await adult.client.post("/api/plugins/podcasts/filters", body); return { status: res.status, body: (await res.json()) as { error?: string } }; };
    expect((await post({ unplayed: true, in_progress: true })).status).toBe(400);
    expect((await post({ min_minutes: "abc" })).status).toBe(400);
    expect((await post({ min_minutes: 30, max_minutes: 5 })).body.error).toMatch(/Swap them/);
    expect((await post({ show: "no such show" })).body.error).toMatch(/No show of yours/);
    expect((await post({ source_ids: ["msrc-zzzzzz"] })).status).toBe(400);
    expect((await post({ id: "mcol-nothere", unplayed: true })).status).toBe(404);
    for (let i = 0; i < 20; i++) expect((await post({ unplayed: true, title: `F${i}` })).status).toBe(200);
    expect((await post({ unplayed: true })).status).toBe(409);
    // Not offered as shared playlists, whatever shared_to holds.
    db.update(mediaCollections).set({ sharedTo: JSON.stringify("household") }).where(eq(mediaCollections.kind, "filter")).run();
    expect(sharedWith("person-someoneelse").filter((c) => c.kind === "filter")).toEqual([]);
  });

  test("child gates: a child's filter sees only the child-cleared episodes of shows named for them, and cannot reach another person's filter", async () => {
    const { adult, child, data, subscribe, poll } = await setup();
    const { feedId } = await subscribe([child.id, adult.id]);
    await poll(feedId);
    // The adult's all-episodes filter includes the explicit episode; the child's identical filter does not.
    const adultFilter = ((await (await adult.client.post("/api/plugins/podcasts/filters", { title: "All" })).json()) as { filter: { id: string } }).filter.id;
    const childFilter = ((await (await child.client.post("/api/plugins/podcasts/filters", { title: "All" })).json()) as { filter: { id: string } }).filter.id;
    expect((await data(adult.client, "filter-episodes", { filter: adultFilter })).map((r) => r.title)).toEqual(["Question 3", "Question 2", "Question 1"]);
    expect((await data(child.client, "filter-episodes", { filter: childFilter })).map((r) => r.title)).toEqual(["Question 3", "Question 1"]);
    // The child cannot evaluate, list or delete the adult's filter.
    expect(await data<unknown[]>(child.client, "filter-episodes", { filter: adultFilter })).toEqual([]);
    expect((await data<{ id: string }[]>(child.client, "filters")).map((r) => r.id)).toEqual([childFilter]);
    expect((await child.client.request(`/api/plugins/podcasts/filters/${adultFilter}`, { method: "DELETE" })).status).toBe(404);
    // A child cannot name a show nobody cleared for them, and a name that trips the word floor is refused.
    expect((await child.client.post("/api/plugins/podcasts/filters", { show: "nothing" })).status).toBe(400);
    expect((await child.client.post("/api/plugins/podcasts/filters", { title: "hardcore porn" })).status).toBe(400);
  });
});
