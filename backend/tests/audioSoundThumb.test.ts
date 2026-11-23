// AUDIO-SOUNDCOVER-02: the Sounds library row shows the sound's cover as its thumbnail once it has one, and none before.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { musicJobs, people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeMusicStack, musicState, waitForMusic } from "./musicFixture";
import { testPng } from "./pictureFixture";
import { runMakeSound } from "@/lib/music/soundMaker";
import { musicForOutcomes } from "@/lib/composer";
import { getMusicJobFor } from "@/lib/music/jobs";
import { storeFile } from "@/lib/attachments";
import { mediaAppData } from "@/lib/media/appHost";

let music: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); music = installFakeMusicStack(); });
afterEach(() => { music.restore(); });

type SoundRow = { id: string; title: string; thumbnail: string | null; backdrop: string | null };
test("a sound with no cover has no thumbnail; with a cover its row points at the file's thumb route", async () => {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const outcome = await runMakeSound({ state: musicState(actor), args: { description: "rain on a window", seconds: 10 }, callId: "s", spoken: false });
  const id = musicForOutcomes([outcome])!.id;
  await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
  const job = getMusicJobFor(actor, id)!;
  const rows = () => mediaAppData(actor, "audio", "sounds", { scope: "library" }) as SoundRow[];
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.thumbnail).toBeNull();
  const cover = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: await testPng(), provenance: "picture-gen", deduplicate: false });
  if (!cover.ok) throw new Error(cover.error);
  db.update(musicJobs).set({ coverFileId: cover.value.id }).where(eq(musicJobs.id, id)).run();
  expect(rows()[0]!.thumbnail).toBe(`/api/files/${job.fileId}/thumb?w=320`);
  expect(rows()[0]!.backdrop).toBe(`/api/files/${job.fileId}/thumb?w=320`);
});
