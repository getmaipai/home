// MUSIC-GEN-21: Quick sings the hook, Full every part, and the length follows the words.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { resetDb } from "./reset-db";
import { createBenchPeople, addBenchTeen } from "../scripts/bench/conversationRunner";
import { TestClient } from "./client";
import { installFakeMusicStack, musicState, LYRICS, waitForMusic } from "./musicFixture";
import { runGenerateMusic, runEditMusic, songSecondsFor, FULL_SONG, QUICK_SONG } from "@/lib/music/tool";
import { getMusicJobFor, musicVersions, slotBodyFor } from "@/lib/music/jobs";
import { musicForOutcomes } from "@/lib/composer";
import { __setMusicStatusForTests, readyMusicStatusForTests } from "@/lib/music/ready";
import { setHouseholdSettingValue } from "@/lib/settings";
import { householdSongLength } from "@/lib/music/policy";

let people: ReturnType<typeof createBenchPeople>;
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeMusicStack(); });
afterEach(() => fake.restore());

const reply = (o: { result?: { reply?: { text?: string } } }) => o.result?.reply?.text ?? "";

describe("the typed tier of a new song (TIER-HOME-03)", () => {
  const ask = (tier: string) => runGenerateMusic({ state: musicState(people.owner), args: { description: "a folk song", lyrics: LYRICS, tier }, callId: tier, spoken: false });
  test("Boost asks the engine for its Detailed maker", async () => {
    expect((await ask("boost")).status).toBe("succeeded");
    expect((fake.submitted.at(-1) as { quality?: string }).quality).toBe("detailed");
  });
  test("Standard asks for Quick", async () => {
    await ask("standard");
    expect((fake.submitted.at(-1) as { quality?: string }).quality).toBe("quick");
  });
  test("Max is made at Boost and says Max is not on this computer yet", async () => {
    const out = await ask("max");
    expect(reply(out)).toContain("Max is not available on this computer yet");
    expect((fake.submitted.at(-1) as { quality?: string }).quality).toBe("detailed");
  });
});

describe("Max music (MUSIC-MAX-01)", () => {
  const MAX_ENGINE = { quality: ["quick", "detailed", "max"], max_model: { id: "ace-step-1-5-xl-sft-bf16", installed: true, models: [], remaining_bytes: 0 } };
  const ask = (actor: typeof people.owner, tier: string) => runGenerateMusic({ state: musicState(actor), args: { description: "a folk song", lyrics: LYRICS, tier }, callId: tier, spoken: false });
  const lastQuality = () => (fake.submitted.at(-1) as { quality?: string }).quality;
  test("Max asks the Stack for its Max maker when it is offered and installed, and the queue records Max", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests(MAX_ENGINE));
    const out = await ask(people.owner, "max");
    expect(out.status).toBe("succeeded");
    expect(reply(out)).not.toContain("Boost");
    expect(lastQuality()).toBe("max");
    const job = getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!;
    expect(job.request).toMatchObject({ quality: "max", tier: "max" });
  });
  test("Max offered but not installed runs as Boost and says so, in the request too", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests({ ...MAX_ENGINE, max_model: { id: "ace-step-1-5-xl-sft-bf16", installed: false, models: [], remaining_bytes: 18_000_000_000 } }));
    const out = await ask(people.owner, "max");
    expect(reply(out)).toContain("not installed on this computer yet, so this one is made at Boost");
    expect(lastQuality()).toBe("detailed");
    expect(getMusicJobFor(people.owner, musicForOutcomes([out])!.id)!.request).toMatchObject({ quality: "detailed", tier: "boost" });
  });
  test("an engine that does not list Max makes a Max request at Boost, as before", async () => {
    const out = await ask(people.owner, "max");
    expect(reply(out)).toContain("Max is not available on this computer yet");
    expect(lastQuality()).toBe("detailed");
  });
  test("the Max level switched off makes a Max request at Boost without the Max maker", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests(MAX_ENGINE));
    setHouseholdSettingValue("engines.music.tier.max", { model: "off", options: {}, who: "admins" });
    await ask(people.owner, "max");
    expect(lastQuality()).not.toBe("max");
  });
  test("a teen's Max request never reaches the Max maker", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests(MAX_ENGINE));
    const teen = addBenchTeen(people);
    const out = await ask(teen, "max");
    // Whether the teen's song is made or refused at the door, the Max maker is never asked for.
    const made = musicForOutcomes([out]);
    if (made) { expect(getMusicJobFor(teen, made.id)!.request).toMatchObject({ quality: "quick", tier: "standard" }); await waitForMusic(() => getMusicJobFor(teen, made.id)?.state === "done"); }
    expect(fake.submitted.some((body) => (body as { quality?: string }).quality === "max")).toBe(false);
  });
  test("a Max job whose level was switched off before it was sent goes to the Stack as Boost", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests(MAX_ENGINE));
    const owner = people.owner;
    const job = { personId: owner.id, request: { quality: "max", tier: "max" } } as never;
    expect(slotBodyFor(job, { task: "text2music", caption: "x", duration_s: 30, quality: "max" } as never).quality).toBe("max");
    setHouseholdSettingValue("engines.music.tier.max", { model: "off", options: {}, who: "admins" });
    expect(slotBodyFor(job, { task: "text2music", caption: "x", duration_s: 30, quality: "max" } as never)).toMatchObject({ quality: "detailed", tier: "boost" });
  });
});

describe("the card's Make it Max route (MUSIC-MAX-01)", () => {
  async function aSong(engine: Parameters<typeof readyMusicStatusForTests>[0]) {
    resetDb();
    __setMusicStatusForTests(readyMusicStatusForTests(engine));
    const client = new TestClient();
    expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
    const actor = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()!;
    const out = await runGenerateMusic({ state: musicState(actor), args: { description: "an original folk song", lyrics: LYRICS, tier: "standard" }, callId: "g", spoken: false });
    const id = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
    return { client, actor, id };
  }
  const card = async (client: TestClient, id: string) => await (await client.get(`/api/music/jobs/${id}`)).json() as { quality: string; max_offered: boolean; max_installed: boolean };
  const INSTALLED = { quality: ["quick", "detailed", "max"], max_model: { id: "ace-step-1-5-xl-sft-bf16", installed: true } };
  test("an installed Max maker is offered, and Make it Max sends quality max and records Max", async () => {
    const { client, actor, id } = await aSong(INSTALLED);
    expect(await card(client, id)).toMatchObject({ quality: "quick", max_offered: true, max_installed: true });
    expect((await client.post(`/api/music/jobs/${id}/quality`, { tier: "max" })).status).toBe(200);
    expect(fake.submitted.at(-1)).toMatchObject({ quality: "max" });
    await waitForMusic(() => musicVersions(actor, getMusicJobFor(actor, id)!).filter((j) => j.state === "done").length >= 2);
    expect(musicVersions(actor, getMusicJobFor(actor, id)!).filter((j) => j.state === "done").at(-1)!.request).toMatchObject({ quality: "max", tier: "max" });
    expect((await card(client, id)).quality).toBe("max");
  });
  test("offered but not installed: the card shows Max as not installed and the route refuses rather than running Boost under the Max name", async () => {
    const { client, id } = await aSong({ quality: ["quick", "detailed", "max"], max_model: { id: "ace-step-1-5-xl-sft-bf16", installed: false } });
    expect(await card(client, id)).toMatchObject({ max_offered: true, max_installed: false });
    const res = await client.post(`/api/music/jobs/${id}/quality`, { tier: "max" });
    expect(res.status).toBe(422);
    expect((await res.json() as { error: string }).error).toContain("not installed");
  });
  test("an engine that does not list Max shows no Max, and the route refuses it", async () => {
    const { client, id } = await aSong({});
    expect(await card(client, id)).toMatchObject({ max_offered: false, max_installed: false });
    expect((await client.post(`/api/music/jobs/${id}/quality`, { tier: "max" })).status).toBe(422);
  });
  test("the Max level switched off hides Max and refuses it", async () => {
    const { client, id } = await aSong(INSTALLED);
    setHouseholdSettingValue("engines.music.tier.max", { model: "off", options: {}, who: "admins" });
    expect((await card(client, id)).max_offered).toBe(false);
    expect((await client.post(`/api/music/jobs/${id}/quality`, { tier: "max" })).status).toBe(422);
  });
});

describe("song lengths", () => {
  test("seconds per kind stay inside their ranges", () => {
    expect(songSecondsFor("quick", undefined, undefined, 240)).toBe(QUICK_SONG.default);
    expect(songSecondsFor("quick", 200, undefined, 240)).toBe(FULL_SONG.min - 1);
    expect(songSecondsFor("quick", 90, undefined, 240)).toBe(90);
    expect(songSecondsFor("full", undefined, undefined, 240)).toBe(FULL_SONG.default);
    expect(songSecondsFor("full", 30, undefined, 240)).toBe(FULL_SONG.min);
    expect(songSecondsFor("full", 600, undefined, 240)).toBe(240);
  });

  test("a song with no kind asked is full by default, and the household default can be quick", async () => {
    const state = musicState(people.owner, true);
    const quick = await runGenerateMusic({ state, args: { description: "a folk song", lyrics: LYRICS }, callId: "a", spoken: false });
    expect(reply(quick)).toContain("full");
    expect(fake.submitted.at(-1)!.duration_s).toBe(52);
    expect(householdSongLength()).toBe("full");
    setHouseholdSettingValue("generation.music.length", "quick");
    expect(householdSongLength()).toBe("quick");
  });

  test("a full song follows its words and says its kind", async () => {
    const state = musicState(people.owner);
    const out = await runGenerateMusic({ state, args: { description: "a folk song", lyrics: LYRICS, length: "full" }, callId: "f", spoken: false });
    expect(out.status).toBe("succeeded");
    expect(fake.submitted.at(-1)!.duration_s).toBe(52);
    expect(reply(out)).toContain("full song");
  });

  test("a smaller computer can make a full song", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests({ limits: { min_seconds: 10, max_seconds: 120 }, quality: ["quick"] }));
    const state = musicState(people.owner);
    const out = await runGenerateMusic({ state, args: { description: "a folk song", lyrics: LYRICS, length: "full" }, callId: "d", spoken: false });
    expect(out.status).toBe("succeeded");
    expect(fake.submitted.at(-1)!.duration_s).toBe(52);
    expect(reply(out)).toContain("full song");
  });

  test("make it full and make it quick keep the words and the seed", async () => {
    const state = musicState(people.owner);
    const first = await runGenerateMusic({ state, args: { description: "a folk song", lyrics: LYRICS }, callId: "g", spoken: false });
    const id = musicForOutcomes([first])!.id;
    await waitForMusic(() => getMusicJobFor(people.owner, id)?.state === "done");
    const seed = fake.submitted.at(-1)!.seed;
    const full = await runEditMusic({ state, args: { track: "latest", change: "make_full" }, callId: "m", spoken: false });
    expect(full.status).toBe("succeeded");
    const body = fake.submitted.at(-1)!;
    expect(body).toMatchObject({ task: "text2music", duration_s: 52, seed, lyrics: LYRICS });
  });
});

describe("the card's Make it full route", () => {
  test("starts a full version of the shown song for its owner", async () => {
    resetDb();
    const client = new TestClient();
    expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
    const actor = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()!;
    const state = musicState(actor);
    const out = await runGenerateMusic({ state, args: { description: "an original folk song", lyrics: LYRICS }, callId: "g", spoken: false });
    const id = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
    const card = await (await client.get(`/api/music/jobs/${id}`)).json() as { length: string };
    expect(card.length).toBe("full");
    const res = await client.post(`/api/music/jobs/${id}/length`, { length: "full" });
    expect(res.status).toBe(200);
    expect(fake.submitted.at(-1)!.duration_s).toBe(52);
    __setMusicStatusForTests(readyMusicStatusForTests({ limits: { min_seconds: 10, max_seconds: 120 } }));
    await waitForMusic(() => fake.deleted.length >= 2);
    expect((await client.post(`/api/music/jobs/${id}/length`, { length: "full" })).status).toBe(200);
  });
});

describe("the card's Make it Boost route (TIER-HOME-03)", () => {
  async function aSong() {
    resetDb();
    const client = new TestClient();
    expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
    const actor = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()!;
    const out = await runGenerateMusic({ state: musicState(actor), args: { description: "an original folk song", lyrics: LYRICS, tier: "standard" }, callId: "g", spoken: false });
    const id = musicForOutcomes([out])!.id;
    await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
    return { client, actor, id };
  }
  test("a Standard song offers Boost, and Boost makes it again with the Detailed maker, recorded as Boost for the queue", async () => {
    const { client, actor, id } = await aSong();
    const card = await (await client.get(`/api/music/jobs/${id}`)).json() as { quality: string; boost_offered: boolean };
    expect(card).toMatchObject({ quality: "quick", boost_offered: true });
    const res = await client.post(`/api/music/jobs/${id}/quality`, { tier: "boost" });
    expect(res.status).toBe(200);
    expect(fake.submitted.at(-1)).toMatchObject({ quality: "detailed", lyrics: LYRICS });
    await waitForMusic(() => musicVersions(actor, getMusicJobFor(actor, id)!).filter((j) => j.state === "done").length >= 2);
    const newest = musicVersions(actor, getMusicJobFor(actor, id)!).filter((j) => j.state === "done").at(-1)!;
    expect(newest.request).toMatchObject({ quality: "detailed", tier: "boost" });
  });
  test("a Boost song asked again at Standard uses the Quick maker", async () => {
    const { client, id } = await aSong();
    expect((await client.post(`/api/music/jobs/${id}/quality`, { tier: "standard" })).status).toBe(200);
    expect(fake.submitted.at(-1)).toMatchObject({ quality: "quick" });
  });
  test("the card does not offer Boost when the engine has no Detailed maker, and the route refuses it", async () => {
    const { client, id } = await aSong();
    __setMusicStatusForTests(readyMusicStatusForTests({ quality: ["quick"] }));
    expect((await (await client.get(`/api/music/jobs/${id}`)).json() as { boost_offered: boolean }).boost_offered).toBe(false);
    expect((await client.post(`/api/music/jobs/${id}/quality`, { tier: "boost" })).status).toBe(422);
  });
});
