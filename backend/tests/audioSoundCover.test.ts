// AUDIO-SOUNDCOVER-01: a sound effect made in Audio gets a cover like a song does (a square picture of what it sounds like).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeMusicStack, musicState, waitForMusic } from "./musicFixture";
import { installFakeImageStack, until } from "./pictureFixture";
import { runMakeSound } from "@/lib/music/soundMaker";
import { musicForOutcomes } from "@/lib/composer";
import { getMusicJobFor } from "@/lib/music/jobs";
import { coverPromptFor } from "@/lib/music/cover";

describe("cover prompt for a sound effect", () => {
  test("describes the sound, drops the model wording, and asks for no text", () => {
    const prompt = coverPromptFor({ description: "sound effect, no melody, no singing: rain on a window, seamless loop", instrumental: true, lyrics: "[Instrumental]", seconds: 10, quality: "quick", sound: { loop: true, surprise: false } });
    expect(prompt).toStartWith("Cover art for a sound effect");
    expect(prompt).toContain("rain on a window");
    expect(prompt).not.toContain("no melody");
    expect(prompt).not.toContain("seamless loop");
    expect(prompt).not.toContain("song");
    expect(prompt).toEndWith("No text, no letters.");
    expect(prompt.length).toBeLessThanOrEqual(600);
  });
  test("a song's prompt is unchanged", () => {
    expect(coverPromptFor({ description: "folk", title: "Pancakes", instrumental: true, seconds: 30, quality: "quick" })).toBe("Album cover art for a song called Pancakes: folk. No text, no letters.");
  });
});

describe("a made sound effect", () => {
  let music: ReturnType<typeof installFakeMusicStack>;
  let pictures: ReturnType<typeof installFakeImageStack>;
  beforeEach(() => { resetDb(); music = installFakeMusicStack(); pictures = installFakeImageStack(); });
  afterEach(() => { music.restore(); pictures.restore(); });

  test("starts one cover picture and stores it on the sound", async () => {
    const client = new TestClient();
    expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const outcome = await runMakeSound({ state: musicState(actor), args: { description: "rain on a window", seconds: 10 }, callId: "s", spoken: false });
    const id = musicForOutcomes([outcome])!.id;
    await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
    await until(() => Boolean(getMusicJobFor(actor, id)?.coverFileId));
    expect(pictures.submitted).toHaveLength(1);
    expect(String(pictures.submitted[0]!.prompt)).toContain("rain on a window");
    expect(String(pictures.submitted[0]!.prompt)).toContain("sound effect");
  });
});
