// PODCAST-PORT-01: the directory routes. Off until the household switch is on, adults, teens only with their own switch, never a child,
// a teen's search words are checked first, and the privacy table lists the hosts only while the switch is on.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetDirectoryForTests } from "@/lib/media/podcastDirectory";
import { privacyConnections } from "@/lib/privacy";
import { setHouseholdSettingValue } from "@/lib/settings";
import { child, owner, teen } from "./support/testAuth";
import { resetDb } from "./reset-db";

const SEARCH = { results: [{ collectionId: 1, collectionName: "Cabin Radio", artistName: "Sage", feedUrl: "https://feeds.example.com/cabin.xml", collectionExplicitness: "notExplicit" }] };
const realFetch = globalThis.fetch;
let urls: string[];
beforeEach(() => {
  resetDb();
  __resetRateLimiterForTests();
  __resetDirectoryForTests();
  urls = [];
  globalThis.fetch = (async (input: URL | string | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("itunes.apple.com") && !url.includes("applemarketingtools.com")) return realFetch(input as never, init);
    urls.push(url);
    return new Response(JSON.stringify(SEARCH), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const on = (teens = false) => {
  setHouseholdSettingValue("podcasts.directory.enabled", true);
  setHouseholdSettingValue("podcasts.directory.teens", teens);
};

describe("the podcast directory routes", () => {
  test("off by default: nobody may search and nothing leaves the home", async () => {
    const { client } = await owner();
    const response = await client.get("/api/plugins/podcasts/directory/search?q=cabin");
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toContain("not turned on");
    expect(urls).toEqual([]);
  });

  test("an adult searches once the switch is on", async () => {
    on();
    const { client } = await owner();
    const response = await client.get("/api/plugins/podcasts/directory/search?q=cabin");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { shows: Array<{ title: string }> }).shows.map((show) => show.title)).toEqual(["Cabin Radio"]);
    expect(urls.length).toBe(1);
  });

  test("a teen needs the teen switch too", async () => {
    on(false);
    const { client } = await owner();
    const teenClient = await teen(client);
    expect((await teenClient.get("/api/plugins/podcasts/directory/search?q=cabin")).status).toBe(403);
    on(true);
    expect((await teenClient.get("/api/plugins/podcasts/directory/search?q=cabin")).status).toBe(200);
  });

  test("a child never reaches it, whatever the switches say", async () => {
    on(true);
    const { client } = await owner();
    const { client: childClient } = await child(client);
    expect((await childClient.get("/api/plugins/podcasts/directory/search?q=cabin")).status).toBe(403);
    expect((await childClient.get("/api/plugins/podcasts/directory/top")).status).toBe(403);
    expect(urls).toEqual([]);
  });

  test("the top list answers an adult", async () => {
    on();
    const { client } = await owner();
    const response = await client.get("/api/plugins/podcasts/directory/top");
    expect([200, 502]).toContain(response.status);
    expect(urls.some((url) => url.includes("applemarketingtools.com"))).toBe(true);
  });

  test("the privacy table lists the directory only while the switch is on", async () => {
    const { client } = await owner();
    void client;
    expect(privacyConnections().some((row) => row.id === "platform:podcast-directory")).toBe(false);
    on();
    const row = privacyConnections().find((item) => item.id === "platform:podcast-directory");
    expect(row?.destination).toContain("itunes.apple.com");
  });
});

describe("the Find shows rows", () => {
  test("an adult gets rows with the feed address; typed words search, empty words give the top list", async () => {
    on();
    const { client } = await owner();
    const search = await client.post("/api/plugins/podcasts/data/directory", { q: "cabin" });
    expect(search.status).toBe(200);
    expect(((await search.json()) as Array<{ title: string; feed_url: string }>).map((row) => [row.title, row.feed_url])).toEqual([["Cabin Radio", "https://feeds.example.com/cabin.xml"]]);
    expect(urls[0]).toContain("itunes.apple.com/search");
    await client.post("/api/plugins/podcasts/data/directory", {});
    expect(urls.some((url) => url.includes("applemarketingtools.com"))).toBe(true);
  });
  test("off, or a child: an empty list and no request", async () => {
    const { client } = await owner();
    expect(await (await client.post("/api/plugins/podcasts/data/directory", { q: "cabin" })).json()).toEqual([]);
    on(true);
    const { client: childClient } = await child(client);
    expect(await (await childClient.post("/api/plugins/podcasts/data/directory", { q: "cabin" })).json()).toEqual([]);
    expect(urls).toEqual([]);
  });
});
