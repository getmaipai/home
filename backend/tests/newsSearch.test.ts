// NEWS-LOOK-02 and News search (news note sections 6 and 15): the date line, the kicker, the day headings and the topic chips on Today,
// My Mix and Channel, and the Search page's data (`search`, `search-recents`) and actions (`search_recent`, `search_recent_clear`).
// The promises: every result comes from the band's release path (a teen never meets an adult-only story, a child searches the Kids'
// lists only); a child's search has no chips, no Saved group and no recents; a person's recents are theirs alone and go with them;
// a guest gets a 404; and no log line carries the query. Feeds and pictures are localhost fixtures, never a real address.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { newsSearchRecents, people } from "@/db/schema";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetShelfCountersForTests } from "@/lib/shelf/shelfCounters";
import { __resetNewsCountersForTests } from "@/lib/news/newsCounters";
import { datelineOf, dayGroupOf, localDayKey } from "@/lib/news/dayParts";
import { listRecents, recordRecent, addSave } from "@/lib/news/records";
import { storyIdOf } from "@/lib/news/cards";
import { TestClient } from "./client";
import { child, owner, teen } from "./support/testAuth";
import { ADULT_HOST, KIDS_HOST, installNewsApp, putItem, removeNewsApp, resetNewsState, seedFeeds, startPublisher, type Publisher } from "./support/newsFixture";
import { resetDb } from "./reset-db";

let publisher: Publisher;
let feeds: { kids: string; household: string };

beforeAll(async () => { publisher = await startPublisher(); });
afterAll(() => publisher.stop());

// The hub's clock is UTC here, and "Today" is the hub's calendar day: an item a few minutes old falls on yesterday for the first
// minutes after 00:00 UTC (8 PM in New York), which turned the watcher red every night. A fixed midday instant makes every age below
// mean the same thing whenever the suite runs.
const MIDDAY = new Date("2026-10-17T16:00:00.000Z");

beforeEach(() => {
  setSystemTime(MIDDAY);
  resetDb();
  resetNewsState();
  __resetRateLimiterForTests();
  __resetShelfCountersForTests();
  __resetNewsCountersForTests();
  feeds = seedFeeds();
  publisher.attach();
});
afterEach(() => { publisher.detach(); removeNewsApp(); setSystemTime(); });

interface Who { adult: TestClient; teen: TestClient; child: TestClient; guest: TestClient; childId: string; teenId: string; adultId: string }
async function household(): Promise<Who> {
  const { client: adult, row } = await owner();
  const t = await teen(adult);
  const { client: c, row: childRow } = await child(adult);
  const created = await adult.post("/api/people", { displayName: "Visitor", role: "guest", guestExpiresAt: new Date(Date.now() + 86_400_000).toISOString() });
  const guestId = ((await created.json()) as { id: string }).id;
  const guest = new TestClient();
  await guest.post("/api/auth/select", { personId: guestId });
  const teenRow = db.select().from(people).where(eq(people.displayName, "Bramble")).get()!;
  return { adult, teen: t, child: c, guest, childId: childRow.id, teenId: teenRow.id, adultId: row.id };
}

const post = (client: TestClient, path: string, body: unknown = {}) => client.post(`/api/plugins/news/${path}`, body);

interface Card { item_id: string; title: string; kicker?: string; group?: string; publisher: string; topics: string[] }
interface Feed {
  header: { title: string; dateline?: string };
  filters?: Array<{ id: string; label: string; selected?: boolean }>;
  hero?: Card; featured: Card[]; rows: Card[];
  shelves: Array<{ title: string; channels?: Array<{ kind: string; key: string; label: string }> }>;
}
async function feedOf(client: TestClient, id: string, body: unknown = {}): Promise<Feed | null> {
  const response = await post(client, `data/${id}`, body);
  expect(response.status).toBe(200);
  const json = (await response.json()) as { blocks: Array<{ props: Feed }> };
  return json.blocks[0]?.props ?? null;
}
const everyCard = (feed: Feed): Card[] => [...(feed.hero ? [feed.hero] : []), ...feed.featured, ...feed.rows];
const titlesOf = (feed: Feed | null): string[] => (feed ? [...feed.rows.map((r) => r.title)] : []);

describe("the hub's words for time", () => {
  const tz = "America/New_York";
  test("the date line reads the day and the time in the hub's time zone", () => {
    expect(datelineOf(new Date("2026-10-17T11:40:00.000Z"), tz)).toBe("Sat, Oct 17 · Updated 7:40");
    expect(datelineOf(new Date("2026-10-17T04:05:00.000Z"), tz)).toBe("Sat, Oct 17 · Updated 12:05");
  });

  test("a row sits under this morning, this afternoon, last night, yesterday, or its weekday and date", () => {
    const now = new Date("2026-10-17T16:00:00.000Z"); // 12:00 in New York
    const at = (iso: string) => dayGroupOf(new Date(iso), now, tz);
    expect(at("2026-10-17T13:00:00.000Z")).toBe("This morning");
    expect(at("2026-10-17T15:59:00.000Z")).toBe("This morning");
    expect(dayGroupOf(new Date("2026-10-17T17:00:00.000Z"), new Date("2026-10-17T21:00:00.000Z"), tz)).toBe("This afternoon");
    expect(at("2026-10-17T00:00:00.000Z")).toBe("Last night"); // 8 pm the evening before
    expect(at("2026-10-16T20:00:00.000Z")).toBe("Yesterday");
    expect(at("2026-10-14T16:00:00.000Z")).toBe("Wed, Oct 14");
  });

  test("two instants are on the same day by the hub's calendar, not by UTC", () => {
    expect(localDayKey(new Date("2026-10-18T01:00:00.000Z"), tz)).toBe("2026-10-17");
    expect(localDayKey(new Date("2026-10-17T12:00:00.000Z"), tz)).toBe("2026-10-17");
  });
});

describe("the date line, kicker, day headings and topic chips on the feeds", () => {
  test("Today, My Mix and a channel carry the date line; rows carry a group by the hub's clock", async () => {
    installNewsApp();
    const who = await household();
    putItem(feeds.household, ADULT_HOST, { title: "Harbor vote", topics: ["local"], ageHours: 1 });
    putItem(feeds.household, ADULT_HOST, { title: "Seal census", topics: ["science"], ageHours: 3 });
    putItem(feeds.household, ADULT_HOST, { title: "Tide tables", topics: ["science"], ageHours: 5 });
    const now = new Date();
    for (const id of ["today", "mix"]) {
      const feed = (await feedOf(who.adult, id))!;
      expect(feed.header.dateline).toMatch(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · Updated \d{1,2}:\d{2}$/);
      for (const row of feed.rows) expect(row.group).toBe(dayGroupOf(new Date(Date.parse((row as unknown as { published_at: string }).published_at)), now));
      expect(feed.rows.every((row) => typeof row.group === "string" && row.group.length > 0)).toBe(true);
    }
    const channel = (await feedOf(who.adult, "channel", { kind: "topic", key: "science" }))!;
    expect(channel.header.dateline).toBeTruthy();
    expect(channel.filters).toBeUndefined();
  });

  test("an adult's kicker is the topic, else the publisher; a child's is the topic only and never carries an outlet count, a time or a publisher", async () => {
    installNewsApp();
    const who = await household();
    putItem(feeds.household, ADULT_HOST, { title: "Tagged story", topics: ["science"], ageHours: 1 });
    putItem(feeds.household, ADULT_HOST, { title: "Untagged story", ageHours: 2 });
    putItem(feeds.kids, KIDS_HOST, { title: "Otter tagged", topics: ["kids"], ageHours: 1 });
    putItem(feeds.kids, KIDS_HOST, { title: "Otter untagged", ageHours: 2 });
    const adult = everyCard((await feedOf(who.adult, "today"))!);
    expect(adult.find((c) => c.title === "Tagged story")!.kicker).toBe("Science");
    expect(adult.find((c) => c.title === "Untagged story")!.kicker).toBe("Example Wire");
    const kid = everyCard((await feedOf(who.child, "today"))!);
    expect(kid.find((c) => c.title === "Otter tagged")!.kicker).toBe("Kids");
    expect(kid.find((c) => c.title === "Otter untagged")!.kicker).toBeUndefined();
    for (const card of kid) expect(card.kicker ?? "").not.toMatch(/Top story|outlet|Kids Daily|\d:\d|ago/);
  });

  test("the hero says Top story with the outlet count at two outlets or more, and a child's never does", async () => {
    const { withKicker } = await import("@/lib/news/data");
    const card = { story_id: "story-abcdef", item_id: "news-abcdef", title: "T", publisher: "Example Wire", site: "x", published_at: new Date().toISOString(), outlets: 3, topics: ["science"], saved: false, opened: false };
    expect(withKicker(card, "adult", true).kicker).toBe("Top story · 3 outlets");
    expect(withKicker({ ...card, outlets: 1 }, "adult", true).kicker).toBe("Science");
    expect(withKicker(card, "adult", false).kicker).toBe("Science");
    expect(withKicker({ ...card, topics: ["kids"] }, "child", true).kicker).toBe("Kids");
    expect(withKicker({ ...card, topics: [] }, "child", true).kicker).toBeUndefined();
  });

  test("the chips list All and the topics that have stories, and the chosen topic narrows the page", async () => {
    installNewsApp();
    const who = await household();
    putItem(feeds.household, ADULT_HOST, { title: "Science one", topics: ["science"], ageHours: 1 });
    putItem(feeds.household, ADULT_HOST, { title: "Science two", topics: ["science"], ageHours: 2 });
    putItem(feeds.household, ADULT_HOST, { title: "Local one", topics: ["local"], ageHours: 3 });
    const all = (await feedOf(who.adult, "today"))!;
    expect(all.filters).toEqual([{ id: "", label: "All", selected: true }, { id: "local", label: "Local", selected: false }, { id: "science", label: "Science", selected: false }]);
    const science = (await feedOf(who.adult, "today", { topic: "science" }))!;
    expect(everyCard(science).map((c) => c.title).sort()).toEqual(["Science one", "Science two"]);
    expect(science.filters!.find((f) => f.id === "science")!.selected).toBe(true);
    expect(science.filters!.find((f) => f.id === "")!.selected).toBe(false);
    expect(science.shelves).toEqual([]);
    const mix = (await feedOf(who.adult, "mix", { topic: "local" }))!;
    expect(everyCard(mix).map((c) => c.title)).toEqual(["Local one"]);
  });

  test("a topic the band is not offered is treated as All, never an error and never a leak", async () => {
    installNewsApp();
    const who = await household();
    putItem(feeds.household, ADULT_HOST, { title: "Science one", topics: ["science"], ageHours: 1 });
    putItem(feeds.household, ADULT_HOST, { title: "Local one", topics: ["local"], ageHours: 2 });
    for (const topic of ["kids", "no-such-topic", "__saved"]) {
      const feed = (await feedOf(who.adult, "today", { topic }))!;
      expect(everyCard(feed)).toHaveLength(2);
      expect(feed.filters![0]).toEqual({ id: "", label: "All", selected: true });
    }
  });

  test("a child has no chips, and the Kids topic does not narrow into an empty page", async () => {
    installNewsApp();
    const who = await household();
    putItem(feeds.kids, KIDS_HOST, { title: "Otter news", topics: ["kids"], ageHours: 1 });
    const feed = (await feedOf(who.child, "today"))!;
    expect(feed.filters).toBeUndefined();
    expect((await feedOf(who.child, "today", { topic: "science" }))!.filters).toBeUndefined();
    expect(everyCard((await feedOf(who.child, "today", { topic: "science" }))!)).toHaveLength(1);
  });
});

describe("the Search page's data", () => {
  async function seed() {
    installNewsApp();
    const who = await household();
    // Items that must count as "Today" are minutes old, so the test does not depend on the time of day (an hour-old item falls on yesterday just after local midnight).
    const a = putItem(feeds.household, ADULT_HOST, { title: "Harbor council votes", summary: "The council met on Tuesday.", topics: ["local"], ageHours: 0.1 });
    const b = putItem(feeds.household, ADULT_HOST, { title: "Science of harbor seals", topics: ["science"], ageHours: 30 });
    const c = putItem(feeds.household, ADULT_HOST, { title: "Stock markets close", topics: ["business"], ageHours: 0.2 });
    const adultOnly = putItem(feeds.household, ADULT_HOST, { title: "Harbor adult only", bandOk: "adult", ageHours: 0.2 });
    const kid = putItem(feeds.kids, KIDS_HOST, { title: "Otters tour the harbor", topics: ["kids"], ageHours: 0.3 });
    return { who, a, b, c, adultOnly, kid };
  }

  test("all words must match the title, dek, publisher or topic name, case-insensitively", async () => {
    const { who } = await seed();
    expect(titlesOf(await feedOf(who.adult, "search", { q: "HARBOR" })).sort()).toEqual(["Harbor adult only", "Harbor council votes", "Science of harbor seals"]);
    expect(titlesOf(await feedOf(who.adult, "search", { q: "harbor seals" }))).toEqual(["Science of harbor seals"]);
    expect(titlesOf(await feedOf(who.adult, "search", { q: "council tuesday" }))).toEqual(["Harbor council votes"]); // title and dek
    expect(titlesOf(await feedOf(who.adult, "search", { q: "wire business" }))).toEqual(["Stock markets close"]); // publisher and topic
    expect(await feedOf(who.adult, "search", { q: "harbor zebra" })).toBeNull();
  });

  test("the header counts the results, singular for one, and an empty search with no chip returns no block", async () => {
    const { who } = await seed();
    expect((await feedOf(who.adult, "search", { q: "seals" }))!.header.title).toBe("1 result for “seals”");
    expect((await feedOf(who.adult, "search", { q: "harbor" }))!.header.title).toMatch(/^\d+ results for “harbor”$/);
    for (const body of [{}, { q: "" }, { q: "   " }]) expect(await feedOf(who.adult, "search", body)).toBeNull();
  });

  test("matching topics and sources come first as the channels shelf, then Saved, then stories by day", async () => {
    const { who, b } = await seed();
    addSave(who.adultId, { itemId: b.id, storyId: storyIdOf(b), canonicalUrl: b.canonical_url, title: b.title, publisher: b.publisher, offline: false });
    const feed = (await feedOf(who.adult, "search", { q: "science" }))!;
    expect(feed.shelves[0]!.title).toBe("Topics and sources");
    expect(feed.shelves[0]!.channels).toEqual([{ kind: "topic", key: "science", label: "Science" }]);
    const wire = (await feedOf(who.adult, "search", { q: "example wire" }))!;
    expect(wire.shelves[0]!.channels).toEqual([{ kind: "source", key: feeds.household, label: "Example Wire" }]);
    const harbor = (await feedOf(who.adult, "search", { q: "harbor" }))!;
    expect(harbor.rows[0]).toMatchObject({ title: "Science of harbor seals", group: "Saved" });
    expect(harbor.rows.slice(1).every((row) => row.group !== "Saved")).toBe(true);
    expect(harbor.rows.filter((row) => row.title === "Science of harbor seals")).toHaveLength(1);
    expect(harbor.rows.slice(1).map((r) => r.title)).toEqual(["Harbor council votes", "Harbor adult only"]);
  });

  test("a matching topic has a channel button action in the served Search page", async () => {
    const { who } = await seed();
    const feed = (await feedOf(who.adult, "search", { q: "Science" }))!;
    expect(feed.shelves[0]!.channels).toContainEqual({ kind: "topic", key: "science", label: "Science" });
    const response = await who.adult.get("/api/plugins/news/pages/search");
    expect(response.status).toBe(200);
    const page = await response.json() as { body: Array<{ type: string; actions?: Record<string, unknown> }> };
    expect(page.body.find((node) => node.type === "answer_blocks")!.actions!.open_channel).toEqual({
      navigate: { to: "/apps/news/channel", state: { kind: "{channel_kind}", key: "{channel_key}" } },
    });
  });

  test("a child's search channels offer only Kids' sources and child topics, with no http in the body", async () => {
    const { who } = await seed();
    for (const [q, channels] of [
      ["kids", [{ kind: "topic", key: "kids", label: "Kids" }, { kind: "source", key: feeds.kids, label: "Kids Daily" }]],
      ["science", []],
      ["example wire", []],
    ] as const) {
      const response = await post(who.child, "data/search", { q });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain("http");
      const data = JSON.parse(body) as { blocks: Array<{ props: Feed }> };
      expect(data.blocks[0]?.props.shelves[0]?.channels ?? []).toEqual([...channels]);
      for (const channel of data.blocks.flatMap((block) => block.props.shelves.flatMap((shelf) => shelf.channels ?? []))) {
        expect(channel.kind === "source" ? channel.key === feeds.kids : channel.key === "kids").toBe(true);
      }
    }
  });

  test("the one chip row is All, Saved only, Today, then the matching topics, and each chip narrows", async () => {
    const { who, b } = await seed();
    addSave(who.adultId, { itemId: b.id, storyId: storyIdOf(b), canonicalUrl: b.canonical_url, title: b.title, publisher: b.publisher, offline: false });
    const base = (await feedOf(who.adult, "search", { q: "harbor" }))!;
    expect(base.filters!.slice(0, 3)).toEqual([{ id: "", label: "All", selected: true }, { id: "__saved", label: "Saved only", selected: false }, { id: "__today", label: "Today", selected: false }]);
    expect(base.filters!.slice(3).map((f) => f.id)).toEqual(["local", "science"]);
    expect(titlesOf(await feedOf(who.adult, "search", { q: "harbor", topic: "__saved" }))).toEqual(["Science of harbor seals"]);
    const today = titlesOf(await feedOf(who.adult, "search", { q: "harbor", topic: "__today" }));
    expect(today).not.toContain("Science of harbor seals");
    expect(today).toContain("Harbor council votes");
    expect(titlesOf(await feedOf(who.adult, "search", { q: "harbor", topic: "local" }))).toEqual(["Harbor council votes"]);
    const chosen = (await feedOf(who.adult, "search", { q: "harbor", topic: "local" }))!;
    expect(chosen.filters!.find((f) => f.id === "local")!.selected).toBe(true);
  });

  test("a chip with nothing behind it keeps the block so the chips can be changed back; an unoffered topic is All", async () => {
    const { who } = await seed();
    const none = (await feedOf(who.adult, "search", { q: "harbor", topic: "__saved" }))!;
    expect(none.header.title).toBe("0 results for “harbor”");
    expect(none.rows).toEqual([]);
    expect(none.filters!.find((f) => f.id === "__saved")!.selected).toBe(true);
    expect(titlesOf(await feedOf(who.adult, "search", { q: "harbor", topic: "kids" }))).toHaveLength(3);
    // Saved only alone browses Saved.
    expect((await feedOf(who.adult, "search", { topic: "__saved" }))!.rows).toEqual([]);
  });

  test("a teen never meets an adult-only story, and a child searches the Kids' lists only", async () => {
    const { who, adultOnly, kid } = await seed();
    const teenTitles = titlesOf(await feedOf(who.teen, "search", { q: "harbor" }));
    expect(teenTitles).not.toContain(adultOnly.title);
    expect(teenTitles).not.toContain(kid.title);
    expect(teenTitles).toContain("Harbor council votes");
    expect(titlesOf(await feedOf(who.adult, "search", { q: "harbor" }))).toContain(adultOnly.title);
    const childFeed = (await feedOf(who.child, "search", { q: "harbor" }))!;
    expect(titlesOf(childFeed)).toEqual([kid.title]);
    expect(JSON.stringify(childFeed)).not.toMatch(/Example Wire|open_url|https?:\/\//);
    // The Kids' publisher is not offered as a source to anyone else.
    expect((await feedOf(who.adult, "search", { q: "kids daily" })) ?? { shelves: [] }).toMatchObject({ shelves: [] });
  });

  test("a child ignores the reserved chip ids, has no chips and no Saved group, and a saved story is just a result", async () => {
    const { who, kid } = await seed();
    addSave(who.childId, { itemId: kid.id, storyId: storyIdOf(kid), canonicalUrl: kid.canonical_url, title: kid.title, publisher: kid.publisher, offline: false });
    for (const topic of ["__saved", "__today", "science"]) {
      const feed = (await feedOf(who.child, "search", { q: "otters", topic }))!;
      expect(feed.filters).toBeUndefined();
      expect(feed.rows.map((r) => r.group)).not.toContain("Saved");
      expect(titlesOf(feed)).toEqual([kid.title]);
    }
    const open = (await feedOf(who.child, "search", {}))!;
    expect(open.header.title).toBe("Find a story");
    expect(open.rows).toEqual([]);
    expect(open.filters).toBeUndefined();
  });

  test("a child's kicker and rows carry no time, outlet count or publisher", async () => {
    const { who } = await seed();
    const feed = (await feedOf(who.child, "search", { q: "otters" }))!;
    expect(feed.rows[0]!.kicker).toBe("Kids");
    expect(JSON.stringify(feed.rows[0]!.kicker)).not.toMatch(/Top story|outlet|Kids Daily/);
  });

  test("a guest gets a 404 on the search ids and actions", async () => {
    const { who } = await seed();
    for (const path of ["data/search", "data/search-recents", "actions/search_recent", "actions/search_recent_clear"]) {
      expect({ path, status: (await post(who.guest, path, { q: "harbor" })).status }).toEqual({ path, status: 404 });
    }
  });

  test("the query reaches only the hub: no log line carries it", async () => {
    const { who } = await seed();
    const lines: string[] = [];
    const originals = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    for (const key of Object.keys(originals) as Array<keyof typeof originals>) console[key] = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    try {
      for (const client of [who.adult, who.teen, who.child]) {
        await post(client, "data/search", { q: "zebrawordquery harbor" });
        await post(client, "actions/search_recent", { q: "zebrawordquery harbor" });
        await post(client, "data/search-recents");
      }
      expect(lines.join("\n")).not.toContain("zebrawordquery");
    } finally {
      Object.assign(console, originals);
    }
  });
});

describe("recent searches", () => {
  const iso = (n: number) => new Date(Date.UTC(2026, 9, 17, 12, 0, n)).toISOString();

  test("a search is recorded, a repeat in any case bumps it to the top, the text is trimmed to 120, and an empty one keeps nothing", async () => {
    installNewsApp();
    const who = await household();
    expect(recordRecent(who.adultId, "adult", "  harbor   seals ", iso(1))).toBe(true);
    expect(recordRecent(who.adultId, "adult", "science", iso(2))).toBe(true);
    expect(recordRecent(who.adultId, "adult", "HARBOR SEALS", iso(3))).toBe(true);
    expect(listRecents(who.adultId).map((r) => r.q)).toEqual(["HARBOR SEALS", "science"]);
    expect(recordRecent(who.adultId, "adult", "   ", iso(4))).toBe(false);
    expect(recordRecent(who.adultId, "adult", "x".repeat(300), iso(5))).toBe(true);
    expect(listRecents(who.adultId)[0]!.q).toHaveLength(120);
    expect(db.select().from(newsSearchRecents).where(eq(newsSearchRecents.personId, who.adultId)).all()).toHaveLength(3);
  });

  test("at most 20 are kept, the oldest go, and the page shows the last five newest first", async () => {
    installNewsApp();
    const who = await household();
    for (let i = 1; i <= 25; i += 1) recordRecent(who.adultId, "adult", `query ${i}`, iso(i));
    const rows = db.select().from(newsSearchRecents).where(eq(newsSearchRecents.personId, who.adultId)).all();
    expect(rows).toHaveLength(20);
    expect(rows.map((r) => r.q)).not.toContain("query 5");
    expect(rows.map((r) => r.q)).toContain("query 6");
    const shown = (await (await post(who.adult, "data/search-recents")).json()) as Array<{ key: string; label: string }>;
    expect(shown.map((r) => r.label)).toEqual(["query 25", "query 24", "query 23", "query 22", "query 21"]);
    for (const row of shown) expect(row.key).toMatch(/^recent-[a-z0-9]{6,}$/);
  });

  test("through the route: record, list, then clear", async () => {
    installNewsApp();
    const who = await household();
    expect((await post(who.adult, "actions/search_recent", { q: "harbor" })).status).toBe(200);
    expect((await post(who.adult, "actions/search_recent", { q: "" })).status).toBe(200);
    expect((await post(who.adult, "actions/search_recent", {})).status).toBe(200);
    expect(((await (await post(who.adult, "data/search-recents")).json()) as Array<{ label: string }>).map((r) => r.label)).toEqual(["harbor"]);
    const cleared = await post(who.adult, "actions/search_recent_clear");
    expect(cleared.status).toBe(200);
    expect(await (await post(who.adult, "data/search-recents")).json()).toEqual([]);
  });

  test("recents are the person's own: another person and an admin never read them, through the data id or the table", async () => {
    installNewsApp();
    const who = await household();
    await post(who.teen, "actions/search_recent", { q: "teen private query" });
    await post(who.adult, "actions/search_recent", { q: "adult query" });
    const asAdult = JSON.stringify(await (await post(who.adult, "data/search-recents", { person_id: who.teenId })).json());
    expect(asAdult).toContain("adult query");
    expect(asAdult).not.toContain("teen private query");
    const asTeen = JSON.stringify(await (await post(who.teen, "data/search-recents")).json());
    expect(asTeen).toContain("teen private query");
    expect(asTeen).not.toContain("adult query");
    // Clearing is the caller's own too.
    await post(who.adult, "actions/search_recent_clear", { person_id: who.teenId });
    expect(listRecents(who.teenId).map((r) => r.q)).toEqual(["teen private query"]);
    expect(listRecents(who.adultId)).toEqual([]);
  });

  test("a child keeps no recents, through the action, the library and the data id", async () => {
    installNewsApp();
    const who = await household();
    expect((await post(who.child, "actions/search_recent", { q: "otters" })).status).toBe(200);
    expect(recordRecent(who.childId, "child", "otters")).toBe(false);
    expect(db.select().from(newsSearchRecents).where(eq(newsSearchRecents.personId, who.childId)).all()).toEqual([]);
    expect(await (await post(who.child, "data/search-recents")).json()).toEqual([]);
  });

  test("deleting a person removes their recents", async () => {
    installNewsApp();
    const who = await household();
    await post(who.teen, "actions/search_recent", { q: "teen query" });
    expect(listRecents(who.teenId)).toHaveLength(1);
    expect((await who.adult.request(`/api/people/${who.teenId}`, { method: "DELETE" })).status).toBe(200);
    expect(db.select().from(newsSearchRecents).where(eq(newsSearchRecents.personId, who.teenId)).all()).toEqual([]);
  });
});

describe("the Search page in the app list", () => {
  test("it is reachable by every role that opens News but is not a tab", async () => {
    installNewsApp();
    const who = await household();
    for (const client of [who.adult, who.teen, who.child]) {
      const apps = (await (await client.get("/api/apps")).json()) as Array<{ package: string; sections: Array<{ page: string }> }>;
      expect(apps.find((row) => row.package === "news")!.sections.map((s) => s.page)).not.toContain("search");
      expect((await client.get("/api/plugins/news/pages/search")).status).toBe(200);
    }
    expect((await who.guest.get("/api/plugins/news/pages/search")).status).toBe(404);
  });
});
