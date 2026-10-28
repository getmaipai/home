// PODCAST-PORT-01: the directory routes. Off until the household switch is on, adults, teens only with their own switch, never a child,
// a teen's search words are checked first, and the privacy table lists the hosts only while the switch is on.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetDirectoryForTests } from "@/lib/media/podcastDirectory";
import { checkAppPackage } from "@maipai/spec/ui/app-check.js";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import UI_SCHEMA from "@maipai/spec/ui/schema.json" with { type: "json" };
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { privacyConnections } from "@/lib/privacy";
import { setHouseholdSettingValue } from "@/lib/settings";
import { child, owner, teen } from "./support/testAuth";
import { resetDb } from "./reset-db";

const SEARCH = { results: [{ collectionId: 1, collectionName: "Cabin Radio", artistName: "Sage", feedUrl: "https://feeds.example.com/cabin.xml", artworkUrl600: "https://is1-ssl.mzstatic.com/image/x/600x600bb.jpg", primaryGenreName: "Home", collectionExplicitness: "notExplicit" }] };
const realFetch = globalThis.fetch;
let urls: string[];
beforeEach(() => {
  resetDb();
  // The switch defaults to on (spec 0.1.267); each test starts from off and turns it on itself.
  setHouseholdSettingValue("podcasts.directory.enabled", false);
  setHouseholdSettingValue("podcasts.directory.teens", false);
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
  test("switch off: nobody may search and nothing leaves the home", async () => {
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

describe("podcast dashboard directory rows", () => {
  test("an adult gets artwork, description and author; top shelf uses one cached request pair", async () => {
    on();
    const { client } = await owner();
    const search = await client.post("/api/plugins/podcasts/data/directory", { q: "cabin" });
    expect(search.status).toBe(200);
    const rows = await search.json() as Array<{ title: string; author: string; summary: string; thumbnail: string; feed_url: string }>;
    expect(rows[0]).toMatchObject({ title: "Cabin Radio", author: "Sage", summary: "Home", feed_url: "https://feeds.example.com/cabin.xml" });
    expect(rows[0]?.thumbnail).toStartWith("/api/plugins/podcasts/directory/art?u=");
    expect(urls.some((url) => url.includes("itunes.apple.com/search"))).toBe(true);
    const top1 = await client.post("/api/plugins/podcasts/data/directory", { scope: "top" });
    const afterFirst = urls.length;
    expect(afterFirst).toBeLessThanOrEqual(4);
    const top2 = await client.post("/api/plugins/podcasts/data/directory", { scope: "top" });
    expect(urls.length).toBe(afterFirst);
    expect(top1.status).toBe(200);
    expect(top2.status).toBe(200);
  });
  test("off, or a child: an empty list and no request", async () => {
    const { client } = await owner();
    expect(await (await client.post("/api/plugins/podcasts/data/directory", { q: "cabin" })).json()).toEqual([]);
    on(true);
    const { client: childClient } = await child(client);
    expect(await (await childClient.post("/api/plugins/podcasts/data/directory", { q: "cabin" })).json()).toEqual([]);
    expect(urls).toEqual([]);
  });
  test("only adult admins receive the Follow action, and only adult admins can add", async () => {
    on(true);
    const { client } = await owner();
    const teenClient = await teen(client);
    const adultRows = await (await client.post("/api/plugins/podcasts/data/directory", { q: "cabin" })).json() as Array<{ action_label?: string }>;
    const teenRows = await (await teenClient.post("/api/plugins/podcasts/data/directory", { q: "cabin" })).json() as Array<{ action_label?: string }>;
    expect(adultRows[0]?.action_label).toBe("Follow");
    expect(teenRows[0]?.action_label).toBeUndefined();
    expect((await teenClient.post("/api/plugins/podcasts/directory/add", { url: "https://feeds.example.com/cabin.xml" })).status).toBe(403);
  });
});

describe("the cover art route", () => {
  test("off, or a child: refused (403); an off-host address is not found", async () => {
    const { client } = await owner();
    expect((await client.get("/api/plugins/podcasts/directory/art?u=https%3A%2F%2Fis1-ssl.mzstatic.com%2Fa.png")).status).toBe(403);
    on(true);
    const { client: childClient } = await child(client);
    expect((await childClient.get("/api/plugins/podcasts/directory/art?u=https%3A%2F%2Fis1-ssl.mzstatic.com%2Fa.png")).status).toBe(403);
    expect((await client.get("/api/plugins/podcasts/directory/art?u=https%3A%2F%2Fevil.example.com%2Fa.png")).status).toBe(404);
  });
  test("directory rows point covers at Home, never at Apple's image host", async () => {
    on();
    const { client } = await owner();
    const body = { results: [{ collectionId: 1, collectionName: "Cabin Radio", artistName: "Sage", feedUrl: "https://feeds.example.com/cabin.xml", artworkUrl600: "https://is1-ssl.mzstatic.com/image/x/600x600bb.jpg" }] };
    globalThis.fetch = (async (input: URL | string | Request) => { urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); return new Response(JSON.stringify(body), { status: 200 }); }) as typeof fetch;
    const rows = (await (await client.post("/api/plugins/podcasts/data/directory", { q: "cabin" })).json()) as Array<{ thumbnail: string }>;
    expect(rows[0]!.thumbnail).toStartWith("/api/plugins/podcasts/directory/art?u=");
  });
});

test("podcast manifest and all referenced schema pages validate at boot", () => {
  const dir = join(import.meta.dir, "../packages/podcasts");
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const read = (module: string) => JSON.parse(readFileSync(join(dir, "pages", `${module}.json`), "utf8"));
  expect(PackageManifest.safeParse(manifest).success).toBe(true);
  expect(checkAppPackage("podcasts", manifest.contributes, read, manifest.min_role)).toEqual([]);
  const ajv = new Ajv2020({ strict: false });
  for (const entry of manifest.contributes.pages) expect(ajv.validate(UI_SCHEMA, read(entry.module))).toBe(true);
  expect(manifest.contributes.pages.some((page: { id: string }) => page.id === "find")).toBe(false);
});
