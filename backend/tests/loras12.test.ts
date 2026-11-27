// VIDEO-LORA-12 (docs/design/video-loras-2026-11-02.md 4.1): the picture styles live on the `Lora` record (media "picture"), not in `picture_adapter_prefs`.
// The Stack still owns the file and its facts (base model); Home owns the household record: availability, confirmation and the age setting.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { allAdapters, adaptersFor, dropAdapterCache, forgetAdapterPref, setAdapterEnabled } from "@/lib/pictures/adapters";
import { readLoras } from "@/lib/loras/access";
import { getLoraRecord, listLoraRecords } from "@/lib/loras/stackLibrary";
import { TestClient } from "./client";
import { unlock, unlockHeader } from "./fixtures/adultLock";
import { resetDb } from "./reset-db";
import { installFakeImageStack, type FakeImageStack } from "./pictureFixture";
import type { PersonRow } from "@/types";

const PIXEL = "lora-aaaaaaaaaaaaaaaa";
const BOUDOIR = "lora-bbbbbbbbbbbbbbbb";
let fake: FakeImageStack;
beforeEach(() => { resetDb(); fake = installFakeImageStack(); });
afterEach(() => fake.restore());

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  return { client, actor };
}
const pictureRecords = () => listLoraRecords().filter((l) => l.media === "picture");

describe("pictures on the Lora record", () => {
  test("every Stack picture style gets a record: kept on for adults as it was, adult-only stays adult-only", async () => {
    await owner();
    await allAdapters();
    const [pixel, boudoir] = [getLoraRecord(PIXEL)!, getLoraRecord(BOUDOIR)!];
    expect(pictureRecords().map((l) => l.id).sort()).toEqual([PIXEL, BOUDOIR]);
    expect(pixel).toMatchObject({ media: "picture", kind: "style", audience: "all-ages", availability: { who: "adults", people: [] }, trigger_words: ["pixelart"] });
    expect(pixel.strength).toEqual({ default: 0.8, min: 0, max: 2 });
    expect(boudoir).toMatchObject({ media: "picture", audience: "adult-only", audience_set_by: null });
    expect(pixel.file.sha256).toBe("a".repeat(64));
    // The Stack's own facts still decide the model family (Quick or Detailed); the record does not copy them.
    expect((await allAdapters()).find((a) => a.id === PIXEL)!.base_model).toBe("minimax-h3-image");
  });




  test("turning a style on or off changes who may use it at the Stack", async () => {
    const { actor } = await owner();
    await allAdapters();
    await setAdapterEnabled(PIXEL, false, actor.id);
    expect(getLoraRecord(PIXEL)!.availability.who).toBe("admins");
    expect((await adaptersFor(["all-ages", "adult-only"])).map((a) => a.id)).toEqual([BOUDOIR]);
    await setAdapterEnabled(PIXEL, true, actor.id);
    expect(getLoraRecord(PIXEL)).toMatchObject({ availability: { who: "adults" } });
    expect((await adaptersFor(["all-ages"])).map((a) => a.id)).toEqual([PIXEL]);
  });


  test("forgetting a style drops its record; the single read path lists picture records for the owner", async () => {
    const { actor } = await owner();
    await allAdapters();
    expect(readLoras(actor, "own_written", { media: "picture" }).items.map((l) => l.id)).toContain(PIXEL);
    forgetAdapterPref(PIXEL);
    dropAdapterCache();
    expect(getLoraRecord(PIXEL)).toBeNull();
  });

  test("a Stack that does not answer lists nothing and invents no record", async () => {
    await owner();
    fake.restore();
    expect(await allAdapters()).toEqual([]);
    expect(pictureRecords()).toEqual([]);
  });
});
