// ADULT-LOCK-05 (docs/design/video-loras-2026-11-02.md section 3.9, test 9, server half): an open adult-only clip's rows say `adult_only` so the kit keeps
// it out of the host's player, nothing about its playback is kept (no resume place, no history), the All tab leads with the one tile while locked, and
// an all-ages clip is unchanged.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { mediaProgress } from "@/db/schema";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __setVideoStatusForTests } from "@/lib/videos/ready";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetAdultLockForTests, fileIsAdultOnly } from "@/lib/adultLock";
import { PLAIN_PROMPT, adultClip, household, makeClip, unlock, unlockHeader } from "./fixtures/adultLock";
import type { TestClient } from "./client";

let fake: FakeVideoStack;
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); __resetAdultLockForTests(); __resetThrottleForTests();
  fake = installFakeVideoStack();
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
});
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); });

type Row = Record<string, any>;
const data = (client: TestClient, id: string, body: Record<string, unknown>, headers?: Record<string, string>) => client.post(`/api/plugins/videos/data/${id}`, body, headers);

describe("adult_only on the rows an unlocked page reads", () => {
  test("feed, My clips and the watch item mark the adult-only clip and only it", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const plain = await makeClip(adult.client, me, PLAIN_PROMPT);
    const locked = await adultClip(adult.client, me);
    const h = unlockHeader(await unlock(adult.client));
    const feed = await (await data(adult.client, "recipes", { scope: "feed" }, h)).json() as Row[];
    expect(feed.find((r) => r.id === locked.jobId)?.adult_only).toBe(true);
    expect(feed.find((r) => r.id === plain.jobId)).not.toHaveProperty("adult_only");
    const clips = await (await data(adult.client, "recipes", { scope: "clips" }, h)).json() as Row[];
    expect(clips.find((r) => r.id === locked.fileId)?.adult_only).toBe(true);
    expect(clips.find((r) => r.id === plain.fileId)).not.toHaveProperty("adult_only");
    const item = await (await data(adult.client, "item", { id: locked.fileId }, h)).json() as Row | Row[];
    const view = Array.isArray(item) ? item[0] : item;
    expect(view?.adult_only).toBe(true);
    const plainItem = await (await data(adult.client, "item", { id: plain.fileId }, h)).json() as Row | Row[];
    expect((Array.isArray(plainItem) ? plainItem[0] : plainItem)).not.toHaveProperty("adult_only");
  });

  test("the All tab of My clips leads with the one tile while locked; Favorites and Uploaded never carry it", async () => {
    const { adult, row } = await household();
    await adultClip(adult.client, row("Marlow"));
    for (const view of [undefined, "all"]) {
      const clips = await (await data(adult.client, "recipes", { scope: "clips", ...(view ? { view } : {}) })).json() as Row[];
      expect(clips[0]).toEqual({ locked: true, making: false });
    }
    for (const view of ["favorites", "uploaded"]) {
      const clips = await (await data(adult.client, "recipes", { scope: "clips", view })).json() as Row[];
      expect(clips.some((r) => r.locked === true)).toBe(false);
    }
  });
});

describe("nothing about playback of an adult-only clip is kept", () => {
  test("saving a place for it writes no progress row, for the app route and the media route", async () => {
    const { adult, row } = await household();
    const clip = await adultClip(adult.client, row("Marlow"));
    expect(fileIsAdultOnly(clip.fileId)).toBe(true);
    const h = unlockHeader(await unlock(adult.client));
    const app = await adult.client.post("/api/plugins/videos/progress", { media_id: clip.fileId, position_s: 12, duration_s: 60, reason: "pause" }, h);
    expect([200, 404]).toContain(app.status);
    const media = await adult.client.put(`/api/media/progress/${clip.fileId}`, { position: { seconds: 12 }, duration_s: 60 }, h);
    expect(media.status).toBe(404);
    expect(db.select().from(mediaProgress).where(eq(mediaProgress.mediaId, clip.fileId)).all()).toEqual([]);
  });

  test("a person who cannot read the file gets the same answer for it as for an id that is not there", async () => {
    const { adult, other, row } = await household();
    const clip = await adultClip(adult.client, row("Marlow"));
    const body = (id: string) => ({ media_id: id, position_s: 5, duration_s: 60, reason: "pause" });
    const theirs = await other.client.post("/api/plugins/videos/progress", body(clip.fileId));
    const missing = await other.client.post("/api/plugins/videos/progress", body("file-doesnotexist"));
    expect(theirs.status).toBe(missing.status);
    expect(await theirs.json()).toEqual(await missing.json());
  });

  test("an all-ages clip is not an adult-only file", async () => {
    const { adult, row } = await household();
    const plain = await makeClip(adult.client, row("Marlow"), PLAIN_PROMPT);
    expect(fileIsAdultOnly(plain.fileId)).toBe(false);
  });
});
