// Podcasts parity with Apple Podcasts (2026-11-09): show page order and seasons, Following and unfollow, the Library follow filters,
// Listen Now rows with queue and played actions, the played badge, and the empty-state actions. Local data only; nothing here is a new spec field.
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaSources, people } from "@/db/schema";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetProgressForTests } from "@/lib/media/progress";
import { __setPodcastFetchDepsForTests } from "@/lib/media/podcasts";
import { insertTranscript } from "@/lib/transcripts/store";
import { getFeed } from "@/lib/shelf/feedStore";
import { pollFeed, type PollDeps } from "@/lib/shelf/shelfPoller";
import { __resetShelfCountersForTests } from "@/lib/shelf/shelfCounters";
import { checkAppPackage } from "@maipai/spec/ui/app-check.js";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import UI_SCHEMA from "@maipai/spec/ui/schema.json" with { type: "json" };
import Ajv2020 from "ajv/dist/2020.js";
import { child, owner } from "./support/testAuth";
import { resetDb } from "./reset-db";

const HOST = "https://seasons.example.com";
const item = (n: number, season: number | null, episode: number | null, date: string) =>
  `<item><title>Ep ${n}</title><guid isPermaLink="false">urn:s:${n}</guid><pubDate>${date}</pubDate><description>Notes ${n}</description><enclosure url="${HOST}/e${n}.mp3" length="10" type="audio/mpeg"/><itunes:duration>00:10:00</itunes:duration>${season ? `<itunes:season>${season}</itunes:season>` : ""}${episode ? `<itunes:episode>${episode}</itunes:episode>` : ""}</item>`;
const FEED = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Seasons Show</title><itunes:author>Marlow</itunes:author><description>A show with seasons.</description>${[
  item(1, 1, 1, "Mon, 05 Oct 2026 06:00:00 GMT"), item(2, 1, 2, "Mon, 12 Oct 2026 06:00:00 GMT"), item(3, 2, 1, "Mon, 19 Oct 2026 06:00:00 GMT"), item(4, 2, 2, "Mon, 26 Oct 2026 06:00:00 GMT"),
].join("")}</channel></rss>`;

let clock = Date.parse("2026-10-30T12:00:00Z");
const deps: PollDeps = {
  dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }),
  now: () => clock,
  fetch: (async (input: URL | string) => new Response(String(input).endsWith("feed.xml") ? FEED : "no", { status: String(input).endsWith("feed.xml") ? 200 : 404, headers: { "content-type": "application/rss+xml" } })) as unknown as typeof fetch,
};

beforeEach(() => {
  clock = Date.parse("2026-10-30T12:00:00Z");
  resetDb();
  __resetRateLimiterForTests();
  __resetShelfCountersForTests();
  __resetProgressForTests();
  __setPodcastFetchDepsForTests(deps);
});

type Rows = Array<Record<string, any>>;

async function setup() {
  const { client } = await owner();
  __setPodcastFetchDepsForTests({ ...deps, fetch: (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch });
  const res = await client.post("/api/plugins/podcasts/subscribe", { url: `${HOST}/feed.xml` });
  await new Promise((resolve) => setTimeout(resolve, 20));
  __setPodcastFetchDepsForTests(deps);
  const { source_id } = (await res.json()) as { source_id: string };
  const feedId = db.select().from(mediaSources).where(eq(mediaSources.id, source_id)).get()!.feedId!;
  clock += 3_600_000;
  await pollFeed(getFeed(feedId)!, deps);
  const directory = async (body: Record<string, unknown>) => (await (await client.post("/api/plugins/podcasts/data/directory", body)).json()) as Rows;
  const data = async (id: string, body: Record<string, unknown> = {}) => (await (await client.post(`/api/plugins/podcasts/data/${id}`, body)).json()) as Rows;
  return { client, sourceId: source_id, directory, data };
}

describe("show page order and seasons", () => {
  test("Latest is newest first; Seasons lists the seasons and shows one season oldest first", async () => {
    const { sourceId, directory } = await setup();
    const latest = await directory({ scope: "show-episodes", id: sourceId, sort: "latest" });
    expect(latest.map((row) => row.title)).toEqual(["Ep 4", "Ep 3", "Ep 2", "Ep 1"]);
    expect((await directory({ scope: "show-episodes", id: sourceId })).map((row) => row.title)).toEqual(["Ep 4", "Ep 3", "Ep 2", "Ep 1"]);
    expect(await directory({ scope: "show-seasons", id: sourceId })).toEqual([{ id: "2", label: "Season 2" }, { id: "1", label: "Season 1" }]);
    const one = await directory({ scope: "show-episodes", id: sourceId, sort: "seasons", season: "1" });
    expect(one.map((row) => row.title)).toEqual(["Ep 1", "Ep 2"]);
    // No season chosen yet: the newest season.
    expect((await directory({ scope: "show-episodes", id: sourceId, sort: "seasons" })).map((row) => row.title)).toEqual(["Ep 3", "Ep 4"]);
  });

  test("Top puts the episodes this person listened to first, then the newest", async () => {
    const { client, sourceId, directory } = await setup();
    const rows = await directory({ scope: "show-episodes", id: sourceId });
    const ep1 = rows.find((row) => row.title === "Ep 1")!.id as string;
    await client.post("/api/plugins/podcasts/progress", { media_id: ep1, position_s: 30, duration_s: 600, reason: "pause" });
    const top = await directory({ scope: "show-episodes", id: sourceId, sort: "top" });
    expect(top.map((row) => row.title)).toEqual(["Ep 1", "Ep 4", "Ep 3", "Ep 2"]);
  });

  test("a show with no seasons has no season rows", async () => {
    const { directory } = await setup();
    expect(await directory({ scope: "show-seasons", id: "https://unknown.example.com/feed.xml" })).toEqual([]);
  });
});

describe("Following and unfollowing", () => {
  test("unfollow keeps the show as Unfollowed, follow again brings it back, and the Library filters agree", async () => {
    const { client, sourceId, directory, data } = await setup();
    expect((await directory({ scope: "show", id: sourceId, follow: "yes" })).map((row) => row.id)).toEqual([sourceId]);
    expect(await directory({ scope: "show", id: sourceId, follow: "no" })).toEqual([]);
    const gone = await client.post("/api/plugins/podcasts/directory/remove", { source_id: sourceId });
    expect(gone.status).toBe(200);
    expect(await directory({ scope: "show", id: sourceId, follow: "yes" })).toEqual([]);
    expect((await directory({ scope: "show", id: sourceId, follow: "no" })).map((row) => row.followed)).toEqual([false]);
    expect((await data("shows", { scope: "unfollowed" })).map((row) => row.id)).toEqual([sourceId]);
    expect(await data("shows", { scope: "followed" })).toEqual([]);
    expect(await data("shows")).toEqual([]);
    const again = await client.post("/api/plugins/podcasts/directory/add", { url: `${HOST}/feed.xml` });
    expect(again.status).toBe(200);
    expect((await data("shows", { scope: "followed" })).map((row) => row.id)).toEqual([sourceId]);
    expect(await data("shows", { scope: "unfollowed" })).toEqual([]);
  });

  test("only an adult admin may unfollow, and an unknown show says what to do", async () => {
    const { client, sourceId } = await setup();
    const kid = await child(client);
    expect((await kid.client.post("/api/plugins/podcasts/directory/remove", { source_id: sourceId })).status).toBe(403);
    const missing = await client.post("/api/plugins/podcasts/directory/remove", { source_id: "msrc-nothing01" });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toContain("Open Shows");
  });

  test("Downloaded lists only shows with a saved copy", async () => {
    const { data } = await setup();
    expect(await data("shows", { scope: "downloaded" })).toEqual([]);
  });
});

describe("Listen Now rows, queue and played", () => {
  test("latest rows carry the date, length, queue and played fields the actions read", async () => {
    const { client, data } = await setup();
    const rows = await data("latest");
    expect(rows.map((row) => row.title)).toEqual(["Ep 4", "Ep 3", "Ep 2", "Ep 1"]);
    expect(rows[0]).toMatchObject({ date: "Oct 26, 2026", duration_s: 600, queue_label: "Add to queue", queue_next: true, played_label: "Mark played", played_next: true, badge: "New" });
    const id = rows[0]!.id as string;
    await client.post("/api/plugins/podcasts/queue", { media_id: id, on: true });
    expect((await data("latest"))[0]).toMatchObject({ queue_label: "Remove from queue", queue_next: false });
  });

  test("Mark played finishes an episode, clears the New badge, and Mark unplayed undoes it", async () => {
    const { client, data } = await setup();
    const id = (await data("latest"))[0]!.id as string;
    const done = await client.post("/api/plugins/podcasts/played", { media_id: id, on: true });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ ok: true, on: true, label: "Marked played" });
    // A played episode leaves Latest episodes; the Episodes list keeps it, marked.
    expect((await data("latest")).map((row) => row.id)).not.toContain(id);
    expect((await data("episodes")).find((row) => row.id === id)).toMatchObject({ played: true, played_label: "Mark unplayed", played_next: false, badge: "Played" });
    await client.post("/api/plugins/podcasts/played", { media_id: id, on: false });
    expect((await data("latest"))[0]).toMatchObject({ id, played_label: "Mark played", badge: "New" });
  });

  test("an episode that is not in the person's podcasts is refused with a next step", async () => {
    const { client } = await setup();
    const refused = await client.post("/api/plugins/podcasts/played", { media_id: "mitem-nothing0001", on: true });
    expect(refused.status).toBe(404);
    expect(((await refused.json()) as { error: string }).error).toContain("not in your podcasts");
  });
});

describe("the pages", () => {
  const dir = join(import.meta.dir, "../packages/podcasts");
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const read = (module: string) => JSON.parse(readFileSync(join(dir, "pages", `${module}.json`), "utf8"));

  test("the manifest and every page validate against the pinned spec", () => {
    expect(PackageManifest.safeParse(manifest).success).toBe(true);
    expect(checkAppPackage("podcasts", manifest.contributes, read, manifest.min_role)).toEqual([]);
    const ajv = new Ajv2020({ strict: false });
    for (const entry of manifest.contributes.pages) expect(ajv.validate(UI_SCHEMA, read(entry.module))).toBe(true);
    expect(manifest.contributes.data.map((entry: { id: string }) => entry.id)).toContain("latest");
  });

  test("the show page has Latest, Top and Seasons, and Follow or Following by state", () => {
    const body = read("show").body as Array<Record<string, any>>;
    const order = body.find((node) => node.type === "picker" && node.state === "order")!;
    expect(order.variant).toBe("pill");
    expect(order.leading.map((option: { value: string }) => option.value)).toEqual(["latest", "top", "seasons"]);
    const seasons = body.find((node) => node.type === "section" && node.condition === "order == 'seasons'")!;
    expect(seasons.children[0]).toMatchObject({ type: "picker", state: "season", variant: "pill" });
    const boards = body.filter((node) => node.type === "billboard");
    expect(boards.map((node) => node.primary.label)).toEqual(["Follow", "Following"]);
    expect(boards[1]!.primary.action.confirm.on_confirm.call.target).toBe("/api/plugins/podcasts/directory/remove");
    expect(boards.every((node) => node.hide_when_empty === true)).toBe(true);
  });

  test("Library filters the shows, and Listen Now's Latest episodes are rows with three actions at most", () => {
    const shows = read("shows").body as Array<Record<string, any>>;
    expect(shows[0]!.leading.map((option: { value: string }) => option.value)).toEqual(["followed", "unfollowed", "downloaded"]);
    const latest = (read("index").body as Array<Record<string, any>>).find((node) => node.heading === "Latest episodes")!;
    expect(latest).toMatchObject({ orientation: "vertical", item_badge_field: "badge" });
    expect(latest.row_actions.length).toBeLessThanOrEqual(3);
    expect(latest.row_actions.map((action: { label: string }) => action.label)).toEqual(["Play", "Add to queue", "Save"]);
  });

  test("every empty state names a next step", () => {
    for (const module of ["episodes", "saved", "queue", "show", "shows", "search"]) {
      const empties: Array<Record<string, any>> = [];
      const walk = (node: any): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== "object") return;
        if (node.type === "empty_state") empties.push(node);
        Object.values(node).forEach(walk);
      };
      walk(read(module));
      expect(empties.length).toBeGreaterThan(0);
      for (const empty of empties) expect(empty.action, `${module}: ${empty.text}`).toBeDefined();
    }
  });
});

describe("apps parity: transcript, Save, episode page, search types", () => {
  const dir = join(import.meta.dir, "../packages/podcasts");
  const read = (module: string) => JSON.parse(readFileSync(join(dir, "pages", `${module}.json`), "utf8"));

  test("the directory transcript scope answers {start_s, text} rows for a stored transcript, and a child gets none", async () => {
    const { client, data, directory } = await setup();
    const id = (await data("episodes"))[0]!.id as string;
    const data_transcript = (body: Record<string, unknown>) => directory({ scope: "transcript", ...body });
    expect(await data_transcript({ id })).toEqual([]);
    const adult = db.select().from(people).where(eq(people.role, "owner")).get() as never;
    insertTranscript(adult, { itemId: id, language: "en", segments: [{ id: "s1", start: 3, end: 8, text: "Hello there." }, { id: "s2", start: 8, end: 13, text: "Second line." }], provenance: { engine: "podcast-import", model_id: "publisher", source_kind: "imported" } });
    expect(await data_transcript({ id })).toEqual([{ start_s: 3, text: "Hello there." }, { start_s: 8, text: "Second line." }]);
    const kid = await child(client);
    expect(await (await kid.client.post("/api/plugins/podcasts/data/directory", { scope: "transcript", id })).json()).toEqual([]);
    expect(await data_transcript({ id: "mitem-nothing0001" })).toEqual([]);
  });

  test("Listen Now rows carry the Save label and next value", async () => {
    const { data } = await setup();
    expect((await data("latest"))[0]).toMatchObject({ save_label: "Save", save_next: true });
  });

  test("search keeps shows and episodes apart, and the chip picks which shelf answers", async () => {
    const { client, directory } = await setup();
    const shows = await directory({ scope: "search", q: "Seasons", shelf: "shows", kind: "all" });
    expect(shows.every((row) => row.feed_url !== "")).toBe(true);
    const episodes = await directory({ scope: "search", q: "Ep 1", shelf: "episodes", kind: "all" });
    expect(episodes.map((row) => row.title)).toEqual(["Ep 1"]);
    expect(episodes[0]!.feed_url).toBe("");
    expect(await directory({ scope: "search", q: "Ep 1", shelf: "episodes", kind: "shows" })).toEqual([]);
    expect(await directory({ scope: "search", q: "Ep 1", shelf: "shows", kind: "episodes" })).toEqual([]);
    expect((await client.post("/api/plugins/podcasts/data/directory", { scope: "search", q: "Ep 1" })).status).toBe(200);
  });

  test("the play page has the sleep timer, 15 and 30 second skips and a transcript; an episode page exists", () => {
    for (const module of ["play", "episode"]) {
      const body = JSON.stringify(read(module));
      const player = (function find(node: any): any { if (Array.isArray(node)) { for (const n of node) { const f = find(n); if (f) return f; } return null; } if (node && typeof node === "object") { if (node.type === "player") return node; for (const v of Object.values(node)) { const f = find(v); if (f) return f; } } return null; })(read(module));
      expect(body).toContain("transcript");
      expect(player).toMatchObject({ sleep_timer: true, skip: { back: 15, forward: 30 }, transcript_bind: { source: "package", path: "directory", params: { scope: "transcript", id: "$state.id" } } });
      expect(player.details_show).toContain("transcript");
    }
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.contributes.pages.map((entry: { id: string }) => entry.id)).toContain("episode");
  });

  test("lists open the episode page and search has Shows and Episodes chips", () => {
    const body = (module: string) => read(module).body as Array<Record<string, any>>;
    const search = body("search");
    expect(search[0]!.type_chips).toMatchObject({ state: "kind" });
    expect(search[0]!.type_chips.options.map((option: { label: string }) => option.label)).toEqual(["All", "Shows", "Episodes"]);
    const episodes = search.flatMap((node) => node.children ?? [node]).find((node) => node.heading === "Episodes")!;
    expect(episodes.on_select.navigate.to).toBe("/apps/podcasts/episode");
    expect(body("episodes").find((node) => node.heading === "Episodes")!.on_select.navigate.to).toBe("/apps/podcasts/episode");
    expect(body("index").find((node) => node.heading === "Latest episodes")!.on_select.navigate.to).toBe("/apps/podcasts/episode");
  });
});
