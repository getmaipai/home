// RADIO-02 / RADIO-04: the Radio routes, with a fake directory and no UI. Adult and teen use it while the household switch is on,
// a child never reaches the directory and plays what a parent saved, a teen never sees an adult-tagged station.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetRadioDirectoryForTests } from "@/lib/media/radioDirectory";
import { setHouseholdSettingValue } from "@/lib/settings";
import { child, owner, teen } from "./support/testAuth";
import { resetDb } from "./reset-db";

const ROWS = [
  { stationuuid: "s-1", name: "Cabin FM", url_resolved: "https://stream.example.com/cabin.mp3", tags: "jazz,blues", countrycode: "US", codec: "MP3", bitrate: 128 },
  { stationuuid: "s-2", name: "Night Heat", url_resolved: "https://stream.example.com/heat.mp3", tags: "talk,Adult Content", countrycode: "US", codec: "MP3", bitrate: 64 },
  { stationuuid: "s-3", name: "Hill HLS", url_resolved: "https://stream.example.com/hill.m3u8", tags: "pop", countrycode: "DE", codec: "AAC", bitrate: 96, hls: 1 },
];
const realFetch = globalThis.fetch;
let urls: string[];
beforeEach(() => {
  resetDb();
  __resetRateLimiterForTests();
  __resetRadioDirectoryForTests();
  urls = [];
  globalThis.fetch = (async (input: URL | string | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("radio-browser.info")) return realFetch(input as never, init);
    urls.push(url);
    return new Response(JSON.stringify(ROWS), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; setHouseholdSettingValue("radio.directory.enabled", false); });

const on = () => setHouseholdSettingValue("radio.directory.enabled", true);
type Row = { id: string; name: string; added?: boolean; hls: boolean; tags: string[] };
const names = async (response: Response) => ((await response.json()) as { stations: Row[] }).stations.map((station) => station.name);
const BASE = "/api/plugins/music/radio";

describe("the radio directory routes", () => {
  test("switch off: every band is refused and nothing leaves the home", async () => {
    const { client } = await owner();
    expect((await client.get(`${BASE}/popular`)).status).toBe(403);
    expect((await client.get(`${BASE}/search?q=cabin`)).status).toBe(403);
    expect(urls).toEqual([]);
  });

  test("an adult sees popular and search rows, adult-tagged ones included", async () => {
    on();
    const { client } = await owner();
    const popular = await client.get(`${BASE}/popular`);
    expect(popular.status).toBe(200);
    expect(await names(popular)).toEqual(["Cabin FM", "Night Heat", "Hill HLS"]);
    expect(await names(await client.get(`${BASE}/search?q=cabin&country=us&tag=jazz`))).toContain("Cabin FM");
    expect(urls.some((url) => url.includes("countrycode=US") && url.includes("tag=jazz"))).toBe(true);
  });

  test("a teen uses the directory but never gets an adult-tagged station", async () => {
    on();
    const { client } = await owner();
    const teenClient = await teen(client);
    const response = await teenClient.get(`${BASE}/popular`);
    expect(response.status).toBe(200);
    expect(await names(response)).toEqual(["Cabin FM", "Hill HLS"]);
    expect(await names(await teenClient.get(`${BASE}/search?q=heat`))).not.toContain("Night Heat");
  });

  test("a teen's search words are checked before they leave the home", async () => {
    on();
    const { client } = await owner();
    const teenClient = await teen(client);
    const response = await teenClient.get(`${BASE}/search?q=Sage`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { stations: unknown[]; note?: string };
    expect(body.stations).toEqual([]);
    expect(body.note).toBeTruthy();
    expect(urls).toEqual([]);
  });

  test("a child never reaches the directory", async () => {
    on();
    const { client } = await owner();
    const { client: childClient } = await child(client);
    expect((await childClient.get(`${BASE}/popular`)).status).toBe(403);
    expect((await childClient.get(`${BASE}/search?q=cabin`)).status).toBe(403);
    expect((await childClient.post(`${BASE}/stations`, { from: "directory", name: "Cabin FM", url: ROWS[0]!.url_resolved })).status).toBe(403);
    expect(urls).toEqual([]);
  });
});

describe("saved stations", () => {
  test("add, list, flag as added, duplicate refused, remove", async () => {
    on();
    const { client } = await owner();
    const added = await client.post(`${BASE}/stations`, { from: "directory", name: "Cabin FM", url: ROWS[0]!.url_resolved, tags: ["jazz", "blues"], country_code: "US", codec: "MP3", bitrate_kbps: 128 });
    expect(added.status).toBe(200);
    const { station } = (await added.json()) as { station: { id: string; name: string } };
    const list = (await (await client.get(`${BASE}/stations`)).json()) as { stations: Row[] };
    expect(list.stations.map((row) => row.name)).toEqual(["Cabin FM"]);
    const popular = ((await (await client.get(`${BASE}/popular`)).json()) as { stations: Row[] }).stations;
    expect(popular.find((row) => row.name === "Cabin FM")?.added).toBe(true);
    expect(popular.find((row) => row.name === "Hill HLS")?.added).toBe(false);
    expect((await client.post(`${BASE}/stations`, { name: "Again", url: ROWS[0]!.url_resolved })).status).toBe(409);
    expect((await client.request(`${BASE}/stations/${station.id}`, { method: "DELETE" })).status).toBe(200);
    expect(((await (await client.get(`${BASE}/stations`)).json()) as { stations: Row[] }).stations).toEqual([]);
    expect((await client.request(`${BASE}/stations/${station.id}`, { method: "DELETE" })).status).toBe(404);
  });

  test("by name and address: https only, nothing inside the home network", async () => {
    const { client } = await owner();
    expect((await client.post(`${BASE}/stations`, { name: "Plain", url: "http://stream.example.com/a.mp3" })).status).toBe(400);
    expect((await client.post(`${BASE}/stations`, { name: "Home", url: "https://192.168.1.20/stream" })).status).toBe(400);
    expect((await client.post(`${BASE}/stations`, { name: "Box", url: "https://nas.local/stream" })).status).toBe(400);
    expect((await client.post(`${BASE}/stations`, { name: "", url: "https://stream.example.com/a.mp3" })).status).toBe(400);
    expect((await client.post(`${BASE}/stations`, { name: "Mine", url: "https://stream.example.com/a.mp3" })).status).toBe(200);
  });

  test("an HLS station is stored but flagged", async () => {
    on();
    const { client } = await owner();
    expect((await client.post(`${BASE}/stations`, { from: "directory", name: "Hill HLS", url: ROWS[2]!.url_resolved })).status).toBe(200);
    const list = ((await (await client.get(`${BASE}/stations`)).json()) as { stations: Row[] }).stations;
    expect(list).toHaveLength(1);
    expect(list[0]!.hls).toBe(true);
  });

  test("a stored station reads back as a spec media-source of kind station", async () => {
    const { db } = await import("@/db");
    const { mediaSources } = await import("@/db/schema");
    const { sourceFromRow } = await import("@/lib/media/model");
    const { client } = await owner();
    await client.post(`${BASE}/stations`, { name: "Cabin FM", url: "https://stream.example.com/cabin.mp3", tags: ["Jazz"], country_code: "US", codec: "MP3", bitrate_kbps: 128 });
    const source = sourceFromRow(db.select().from(mediaSources).all().find((row) => row.kind === "station")!);
    expect(source.kind).toBe("station");
    expect(source.station).toEqual({ live: true, favicon_url: null, tags: ["jazz"], country_code: "US", codec: "MP3", bitrate_kbps: 128 });
    expect(source.provenance).toStartWith("person:");
  });

  test("a teen cannot save an adult-tagged station and never lists one", async () => {
    on();
    const { client } = await owner();
    const teenClient = await teen(client);
    expect((await teenClient.post(`${BASE}/stations`, { from: "directory", name: "Night Heat", url: ROWS[1]!.url_resolved, tags: ["talk", "adult content"] })).status).toBe(403);
    expect((await teenClient.post(`${BASE}/stations`, { from: "directory", name: "Cabin FM", url: ROWS[0]!.url_resolved, tags: ["jazz"] })).status).toBe(200);
    expect(await names(await teenClient.get(`${BASE}/stations`))).toEqual(["Cabin FM"]);
  });

  test("a parent saves for a child; the child lists it, cannot add or remove, and a sibling does not see it", async () => {
    on();
    const { client } = await owner();
    const { client: childClient, row } = await child(client);
    const added = await client.post(`${BASE}/stations`, { name: "Kids Tunes", url: "https://stream.example.com/kids.mp3", tags: ["kids"], for_person_id: row.id });
    expect(added.status).toBe(200);
    const { station } = (await added.json()) as { station: { id: string } };
    expect(await names(await childClient.get(`${BASE}/stations`))).toEqual(["Kids Tunes"]);
    expect(await names(await client.get(`${BASE}/stations`))).toEqual([]);
    expect((await childClient.post(`${BASE}/stations`, { name: "Mine", url: "https://stream.example.com/mine.mp3" })).status).toBe(403);
    expect((await childClient.post(`${BASE}/stations`, { name: "Mine", url: "https://stream.example.com/mine.mp3", for_person_id: row.id })).status).toBe(403);
    expect((await childClient.request(`${BASE}/stations/${station.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await client.post(`${BASE}/stations`, { name: "Adult", url: "https://stream.example.com/x.mp3", tags: ["xxx"], for_person_id: row.id })).status).toBe(403);
    expect((await client.request(`${BASE}/stations/${station.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await names(await childClient.get(`${BASE}/stations`))).toEqual([]);
  });

  test("a parent names a child only: not another adult, and a teen cannot name anyone", async () => {
    const { client, row } = await owner();
    const teenClient = await teen(client);
    const { row: kid } = await child(client);
    expect((await client.post(`${BASE}/stations`, { name: "A", url: "https://stream.example.com/a.mp3", for_person_id: "person-nobody1" })).status).toBe(403);
    expect((await teenClient.post(`${BASE}/stations`, { name: "A", url: "https://stream.example.com/a.mp3", for_person_id: kid.id })).status).toBe(403);
    expect((await teenClient.post(`${BASE}/stations`, { name: "A", url: "https://stream.example.com/a.mp3", for_person_id: row.id })).status).toBe(403);
  });
});
