// AUDIO-TITLE-01: a new song the model gave no title still gets a real one, so its card, its library row and its cover prompt never say "Song".
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeMusicStack, musicState, waitForMusic, LYRICS } from "./musicFixture";
import { installFakeImageStack, until } from "./pictureFixture";
import { runGenerateMusic } from "@/lib/music/tool";
import { musicForOutcomes } from "@/lib/composer";
import { getMusicJobFor } from "@/lib/music/jobs";
import { fallbackSongTitle } from "@/lib/music/songTitle";

describe("fallbackSongTitle", () => {
  test("keeps a title that was given", () => {
    expect(fallbackSongTitle({ description: "folk", title: "  Pancakes " })).toBe("Pancakes");
  });
  test("uses the first sung line, never a section tag, in Title Case, at most six words", () => {
    expect(fallbackSongTitle({ description: "folk", lyrics: "[Verse]\nMorning light\nWarm and bright" })).toBe("Morning Light");
    expect(fallbackSongTitle({ description: "folk", lyrics: "one two three four five six seven eight" })).toBe("One Two Three Four Five Six");
    expect(fallbackSongTitle({ description: "folk", lyrics: "[Chorus]\nHello, world!" })).toBe("Hello, World");
  });
  test("with no words to sing, takes the subject of the description", () => {
    expect(fallbackSongTitle({ description: "a calm piano piece about rain", lyrics: "[Instrumental]", instrumental: true })).toBe("Rain");
    expect(fallbackSongTitle({ description: "an upbeat folk song", instrumental: true })).toBe("Upbeat Folk Song");
  });
  test("falls back to a plain name when there is nothing to use, and never returns an empty or tagged title", () => {
    expect(fallbackSongTitle({ description: "   ", lyrics: "[Verse]\n[Chorus]" })).toBe("New Song");
    for (const request of [{ description: "x" }, { description: "", lyrics: "[Intro]" }, { description: "a song about  " }]) {
      const title = fallbackSongTitle(request);
      expect(title.trim()).not.toBe("");
      expect(title).not.toContain("[");
      expect(title.length).toBeLessThanOrEqual(60);
    }
  });
});

describe("an untitled new song", () => {
  let music: ReturnType<typeof installFakeMusicStack>;
  let pictures: ReturnType<typeof installFakeImageStack>;
  beforeEach(() => { resetDb(); music = installFakeMusicStack(); pictures = installFakeImageStack(); });
  afterEach(() => { music.restore(); pictures.restore(); });

  test("is stored with a real title, and its cover is made and names that title", async () => {
    const client = new TestClient();
    expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const outcome = await runGenerateMusic({ state: musicState(actor), args: { description: "an original folk song", lyrics: LYRICS }, callId: "g", spoken: false });
    const id = musicForOutcomes([outcome])!.id;
    await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
    const job = getMusicJobFor(actor, id)!;
    expect(job.request.title).toBe("Morning Light");
    await until(() => Boolean(getMusicJobFor(actor, id)?.coverFileId));
    expect(pictures.submitted).toHaveLength(1);
    expect(String(pictures.submitted[0]!.prompt)).toContain("Morning Light");
  });
});
