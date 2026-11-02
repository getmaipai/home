import { describe, expect, test, beforeEach } from "bun:test";
import { SongStyle } from "@maipai/spec/gen/ts/song-style.js";
import { MadeArtist } from "@maipai/spec/gen/ts/made-artist.js";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { sqlite } from "@/db";

// MUSIC-STUDIO-S2, MUSIC-LISTEN-C5: saved song styles and made bands. Every response is the spec record; ownership, sharing, the
// child rule and the reference checks live in lib/music/madeRecords.ts. Names are persona names only.

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

const STYLE = { description: "hazy lo-fi drums, tape-warped keys, close whispered vocals", genres: ["lo-fi"], instrumental: false, length_s: 150, bpm: 82, key: null, language: "en" };

async function ownerClient(): Promise<TestClient> {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return client;
}

async function addPerson(client: TestClient, displayName: string, role: string, secret?: string): Promise<string> {
  const res = await client.post("/api/people", { displayName, role, secret });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function sessionFor(personId: string, secret?: string): Promise<TestClient> {
  const client = new TestClient();
  if (secret) await client.post("/api/auth/verify-secret", { personId, secret });
  else await client.post("/api/auth/select", { personId });
  return client;
}

describe("song styles", () => {
  test("a style is saved, read, changed and deleted as the spec record", async () => {
    const sage = await ownerClient();
    const res = await sage.post("/api/music/styles", { title: "Rainy lo-fi", style: STYLE });
    expect(res.status).toBe(201);
    const made = SongStyle.parse(await res.json());
    expect(made.origin).toBe("household");
    expect(made.source).toBe("hub");
    expect(made.seed ?? null).toBeNull();
    expect(made.shared_to ?? null).toBeNull();

    const list = SongStyle.array().parse(await (await sage.get("/api/music/styles")).json());
    expect(list.map((s) => s.id)).toEqual([made.id]);

    const changed = await sage.request(`/api/music/styles/${made.id}`, { method: "PATCH", body: { title: "Rainy lo-fi 2", style: { ...STYLE, bpm: 90 } } });
    expect(changed.status).toBe(200);
    const after = SongStyle.parse(await changed.json());
    expect(after.title).toBe("Rainy lo-fi 2");
    expect(after.style.bpm).toBe(90);
    expect(after.hlc).not.toBe(made.hlc);
    expect(after.created_at).toBe(made.created_at);

    expect((await sage.request(`/api/music/styles/${made.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await sage.get(`/api/music/styles/${made.id}`)).status).toBe(404);
    expect(await (await sage.get("/api/music/styles")).json()).toEqual([]);
    const row = sqlite.query("SELECT deleted_at FROM song_styles WHERE id = ?").get(made.id) as { deleted_at: string | null };
    expect(row.deleted_at).not.toBeNull();
  });

  test("a client cannot set the id, owner, origin or clock", async () => {
    const sage = await ownerClient();
    const res = await sage.post("/api/music/styles", { title: "Mine", style: STYLE, id: "sstyle-hijack12", origin: "starter", owner_person_id: null, hlc: "1:0:abcdef" });
    expect(res.status).toBe(201);
    const made = SongStyle.parse(await res.json());
    expect(made.id).not.toBe("sstyle-hijack12");
    expect(made.origin).toBe("household");
    expect(made.owner_person_id).not.toBeNull();
  });

  test("a bad field is refused with its name and never its value", async () => {
    const sage = await ownerClient();
    const res = await sage.post("/api/music/styles", { title: "Secret words zzq", style: { description: "", bpm: 5 } });
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("style");
    expect(text).not.toContain("Secret words zzq");
    expect((await sage.post("/api/music/styles", { style: STYLE })).status).toBe(400);
    expect((await sage.post("/api/music/styles", { title: "Both", style: STYLE, seed: { file_id: "file-abcdef12", media_id: "media-abcdef12" } })).status).toBe(400);
  });

  test("a seed must point at something the person can read", async () => {
    const sage = await ownerClient();
    expect((await sage.post("/api/music/styles", { title: "Like it", style: STYLE, seed: { media_id: "media-nothere1" } })).status).toBe(400);
    expect((await sage.post("/api/music/styles", { title: "Like it", style: STYLE, seed: { file_id: "file-nothere1" } })).status).toBe(400);
    expect((await sage.post("/api/music/styles", { title: "Like it", style: STYLE, seed: null })).status).toBe(201);
  });

  test("a style is private until shared, then others read it but cannot change it", async () => {
    const sage = await ownerClient();
    const marlowId = await addPerson(sage, "Marlow", "adult", "marlowsecret1");
    const novaId = await addPerson(sage, "Nova", "child");
    const marlow = await sessionFor(marlowId, "marlowsecret1");

    const mine = SongStyle.parse(await (await sage.post("/api/music/styles", { title: "Private", style: STYLE })).json());
    expect((await marlow.get(`/api/music/styles/${mine.id}`)).status).toBe(404);
    expect((await marlow.get("/api/music/styles?scope=shared")).status).toBe(200);
    // Starter styles belong to nobody and are on everyone's shelf; nothing of Sage's is.
    const startersOnly = SongStyle.array().parse(await (await marlow.get("/api/music/styles?scope=shared")).json());
    expect(startersOnly.length).toBeGreaterThanOrEqual(5);
    expect(startersOnly.every((s) => s.origin === "starter" && s.owner_person_id === null)).toBe(true);

    const shared = SongStyle.parse(await (await sage.post("/api/music/styles", { title: "For all", style: STYLE, shared_to: "household" })).json());
    expect((await marlow.get(`/api/music/styles/${shared.id}`)).status).toBe(200);
    expect(SongStyle.array().parse(await (await marlow.get("/api/music/styles?scope=shared")).json()).filter((s) => s.origin !== "starter").map((s) => s.id)).toEqual([shared.id]);
    expect((await marlow.request(`/api/music/styles/${shared.id}`, { method: "PATCH", body: { title: "Mine now" } })).status).toBe(403);
    expect((await marlow.request(`/api/music/styles/${shared.id}`, { method: "DELETE" })).status).toBe(403);

    const toNova = SongStyle.parse(await (await sage.post("/api/music/styles", { title: "Only Marlow", style: STYLE, shared_to: [marlowId] })).json());
    expect((await marlow.get(`/api/music/styles/${toNova.id}`)).status).toBe(200);
    expect(novaId).toBeTruthy();
  });

  test("a parent makes and changes a child's style, and the child cannot", async () => {
    const sage = await ownerClient();
    const novaId = await addPerson(sage, "Nova", "child");
    const nova = await sessionFor(novaId);
    expect((await nova.post("/api/music/styles", { title: "Mine", style: STYLE })).status).toBe(403);

    const res = await sage.post("/api/music/styles", { title: "Bedtime tunes", style: STYLE, person: novaId });
    expect(res.status).toBe(201);
    const made = SongStyle.parse(await res.json());
    expect(made.owner_person_id).toBe(novaId);
    expect((await nova.get(`/api/music/styles/${made.id}`)).status).toBe(200);
    expect((await nova.request(`/api/music/styles/${made.id}`, { method: "PATCH", body: { title: "Changed" } })).status).toBe(403);
    expect((await sage.request(`/api/music/styles/${made.id}`, { method: "PATCH", body: { title: "Bedtime songs" } })).status).toBe(200);
    expect(SongStyle.array().parse(await (await sage.get(`/api/music/styles?person=${novaId}`)).json())).toHaveLength(1);
  });

  test("a teen's style stays private from a parent", async () => {
    const sage = await ownerClient();
    const riffId = await addPerson(sage, "Riff", "teen");
    const riff = await sessionFor(riffId);
    const made = SongStyle.parse(await (await riff.post("/api/music/styles", { title: "My stuff", style: STYLE })).json());
    expect((await sage.get(`/api/music/styles/${made.id}`)).status).toBe(404);
    expect((await sage.get(`/api/music/styles?person=${riffId}`)).status).toBe(404);
  });

  test("a minor's flagged text is refused without echoing it", async () => {
    const sage = await ownerClient();
    const novaId = await addPerson(sage, "Nova", "child");
    const res = await sage.post("/api/music/styles", { title: "Bad", style: { ...STYLE, description: "This is our secret, don't tell your parents" }, person: novaId });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    // Shared text is read by a child too, so the child's floor applies to it; the same text kept private is an adult's own business.
    const odd = { ...STYLE, description: "This is our secret, don't tell your parents" };
    expect((await sage.post("/api/music/styles", { title: "Odd", style: odd, shared_to: "household" })).status).toBe(400);
    expect((await sage.post("/api/music/styles", { title: "Odd", style: odd })).status).toBe(201);
  });

  test("requires sign-in", async () => {
    await ownerClient();
    expect((await new TestClient().get("/api/music/styles")).status).toBe(401);
  });
});

describe("made bands", () => {
  const BAND = { name: "Lantern Hollow", backstory: "Two friends who kept a lighthouse.", genres: ["lo-fi", "dream pop"], members: [{ name: "Marlow Ash", role: "vocals and keys", portrait_file_id: null }, { name: "Nova Reed", role: "drums", portrait_file_id: null }], style: STYLE };

  test("a band is saved with the shared style shape and read back as the spec record", async () => {
    const sage = await ownerClient();
    const res = await sage.post("/api/music/bands", BAND);
    expect(res.status).toBe(201);
    const made = MadeArtist.parse(await res.json());
    expect(made.origin).toBe("made");
    expect(made.name).toBe("Lantern Hollow");
    expect(made.members).toHaveLength(2);
    expect(made.style.description).toBe(STYLE.description);
    expect(MadeArtist.parse(await (await sage.get(`/api/music/bands/${made.id}`)).json())).toEqual(made);

    const changed = await sage.request(`/api/music/bands/${made.id}`, { method: "PATCH", body: { backstory: "Now three friends.", members: [...BAND.members, { name: "Quill Day", role: "bass", portrait_file_id: null }] } });
    expect(changed.status).toBe(200);
    const after = MadeArtist.parse(await changed.json());
    expect(after.members).toHaveLength(3);
    expect(after.name).toBe("Lantern Hollow");
    expect(after.backstory).toBe("Now three friends.");
  });

  test("a band holds at most twelve members and needs a name and a style", async () => {
    const sage = await ownerClient();
    const many = Array.from({ length: 13 }, (_, i) => ({ name: `Member ${i}`, role: "guitar", portrait_file_id: null }));
    expect((await sage.post("/api/music/bands", { ...BAND, members: many })).status).toBe(400);
    expect((await sage.post("/api/music/bands", { style: STYLE })).status).toBe(400);
    expect((await sage.post("/api/music/bands", { name: "No style" })).status).toBe(400);
  });

  test("a band cannot point at a file or library item that is not there", async () => {
    const sage = await ownerClient();
    expect((await sage.post("/api/music/bands", { ...BAND, portrait_file_id: "file-missing01" })).status).toBe(400);
    expect((await sage.post("/api/music/bands", { ...BAND, seed: { media_id: "media-missing01" } })).status).toBe(400);
  });

  test("styles and bands are separate lists", async () => {
    const sage = await ownerClient();
    await sage.post("/api/music/bands", BAND);
    expect(await (await sage.get("/api/music/styles")).json()).toEqual([]);
    expect(MadeArtist.array().parse(await (await sage.get("/api/music/bands")).json())).toHaveLength(1);
  });
});
