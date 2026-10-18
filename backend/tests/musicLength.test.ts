// Quick and Full songs (owner, 2026-10-17: "quick songs and full songs like videos"; "forty seconds is not full").
// Quick is about 45 s (10 to 60 s); Full is about 3 minutes (150 to 240 s) and is made only where the Stack allows it.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { TestClient } from "./client";
import { installFakeMusicStack, musicState, LYRICS, waitForMusic } from "./musicFixture";
import { runGenerateMusic, runEditMusic, songSecondsFor, FULL_SONG, QUICK_SONG } from "@/lib/music/tool";
import { getMusicJobFor } from "@/lib/music/jobs";
import { musicForOutcomes } from "@/lib/composer";
import { __setMusicStatusForTests, readyMusicStatusForTests } from "@/lib/music/ready";
import { setHouseholdSettingValue } from "@/lib/settings";
import { householdSongLength } from "@/lib/music/policy";

let people: ReturnType<typeof createBenchPeople>;
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeMusicStack(); });
afterEach(() => fake.restore());

const reply = (o: { result?: { reply?: { text?: string } } }) => o.result?.reply?.text ?? "";

describe("song lengths", () => {
  test("seconds per kind stay inside their ranges", () => {
    expect(songSecondsFor("quick", undefined, undefined, 240)).toBe(QUICK_SONG.default);
    expect(songSecondsFor("quick", 200, undefined, 240)).toBe(FULL_SONG.min - 1);
    expect(songSecondsFor("quick", 90, undefined, 240)).toBe(90);
    expect(songSecondsFor("full", undefined, undefined, 240)).toBe(FULL_SONG.default);
    expect(songSecondsFor("full", 30, undefined, 240)).toBe(FULL_SONG.min);
    expect(songSecondsFor("full", 600, undefined, 240)).toBe(240);
  });

  test("a song with no kind asked is quick by default, and the household default can be full", async () => {
    const state = musicState(people.owner, true);
    const quick = await runGenerateMusic({ state, args: { description: "a folk song", lyrics: LYRICS }, callId: "a", spoken: false });
    expect(reply(quick)).toContain("quick");
    expect(fake.submitted.at(-1)!.duration_s).toBeLessThanOrEqual(QUICK_SONG.max);
    expect(householdSongLength()).toBe("quick");
    setHouseholdSettingValue("generation.music.length", "full");
    expect(householdSongLength()).toBe("full");
  });

  test("a full song is about three minutes and says so", async () => {
    const state = musicState(people.owner);
    const out = await runGenerateMusic({ state, args: { description: "a folk song", lyrics: LYRICS, length: "full" }, callId: "f", spoken: false });
    expect(out.status).toBe("succeeded");
    expect(fake.submitted.at(-1)!.duration_s).toBe(FULL_SONG.default);
    expect(reply(out)).toContain("full song");
  });

  test("a computer that cannot make full songs makes a quick one and says why", async () => {
    __setMusicStatusForTests(readyMusicStatusForTests({ limits: { min_seconds: 10, max_seconds: 120 }, quality: ["quick"] }));
    const state = musicState(people.owner);
    const out = await runGenerateMusic({ state, args: { description: "a folk song", lyrics: LYRICS, length: "full" }, callId: "d", spoken: false });
    expect(out.status).toBe("succeeded");
    expect(fake.submitted.at(-1)!.duration_s).toBeLessThanOrEqual(QUICK_SONG.max);
    expect(reply(out)).toContain("128 GB");
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
    expect(body).toMatchObject({ task: "text2music", duration_s: FULL_SONG.default, seed, lyrics: LYRICS });
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
    expect(card.length).toBe("quick");
    const res = await client.post(`/api/music/jobs/${id}/length`, { length: "full" });
    expect(res.status).toBe(200);
    expect(fake.submitted.at(-1)!.duration_s).toBe(FULL_SONG.default);
    __setMusicStatusForTests(readyMusicStatusForTests({ limits: { min_seconds: 10, max_seconds: 120 } }));
    expect((await client.post(`/api/music/jobs/${id}/length`, { length: "full" })).status).toBe(422);
  });
});
