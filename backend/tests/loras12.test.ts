// VIDEO-LORA-12 (docs/design/video-loras-2026-11-02.md 4.1): the picture styles live on the `Lora` record (media "picture"), not in `picture_adapter_prefs`.
// The Stack still owns the file and its facts (base model); Home owns the household record: availability, confirmation and the age setting.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, pictureAdapterPrefs } from "@/db/schema";
import { allAdapters, adaptersFor, dropAdapterCache, forgetAdapterPref, setAdapterEnabled } from "@/lib/pictures/adapters";
import { readLoras } from "@/lib/loras/access";
import { getLoraRecord, listLoraRecords } from "@/lib/loras/store";
import { __resetLoraSyncForTests, adoptPictureLoras } from "@/lib/loras/sync";
import { TestClient } from "./client";
import { unlock, unlockHeader } from "./fixtures/adultLock";
import { resetDb } from "./reset-db";
import { installFakeImageStack, type FakeImageStack } from "./pictureFixture";
import type { PersonRow } from "@/types";

const PIXEL = "lora-aaaaaaaaaaaaaaaa";
const BOUDOIR = "lora-bbbbbbbbbbbbbbbb";
let fake: FakeImageStack;
beforeEach(() => { resetDb(); __resetLoraSyncForTests(); fake = installFakeImageStack(); });
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
    const { actor } = await owner();
    await allAdapters();
    const [pixel, boudoir] = [getLoraRecord(PIXEL)!, getLoraRecord(BOUDOIR)!];
    expect(pictureRecords().map((l) => l.id).sort()).toEqual([PIXEL, BOUDOIR]);
    expect(pixel).toMatchObject({ media: "picture", kind: "style", audience: "all-ages", audience_set_by: actor.id, availability: { who: "adults", people: [] }, trigger_words: ["pixelart"] });
    expect(boudoir).toMatchObject({ media: "picture", audience: "adult-only", audience_set_by: null });
    expect(pixel.file.sha256).toBe("a".repeat(64));
    // The Stack's own facts still decide the model family (Quick or Detailed); the record does not copy them.
    expect((await allAdapters()).find((a) => a.id === PIXEL)!.base_model).toBe("flux2-klein-4b");
  });

  test("old preference rows are folded into the records and deleted; a style added but not confirmed stays unconfirmed", async () => {
    const { actor } = await owner();
    const now = new Date().toISOString();
    db.insert(pictureAdapterPrefs).values([
      { adapterId: PIXEL, enabled: false, updatedAt: now, updatedBy: `added:${actor.id}` },
      { adapterId: BOUDOIR, enabled: false, updatedAt: now, updatedBy: actor.id },
    ]).run();
    const list = await allAdapters();
    expect(db.select().from(pictureAdapterPrefs).all()).toEqual([]);
    expect(list.find((a) => a.id === PIXEL)).toMatchObject({ enabled: false, needs_confirmation: true });
    expect(list.find((a) => a.id === BOUDOIR)).toMatchObject({ enabled: false, needs_confirmation: false });
    expect(getLoraRecord(PIXEL)!.availability.who).toBe("admins");
    expect(getLoraRecord(PIXEL)!.licence.acknowledged_by).toBeNull();
  });

  test("a style just added starts off and unconfirmed even when another adoption call is already running", async () => {
    const { actor } = await owner();
    const stack = await (await import("@/lib/pictures/stack")).listLoras();
    const pixel = stack.find((l) => l.id === PIXEL)!;
    // An earlier call that does not list the new style is in flight when the add route names who added it.
    const early = adoptPictureLoras([], null);
    const added = adoptPictureLoras([pixel], actor.id);
    await Promise.all([early, added]);
    expect(getLoraRecord(PIXEL)!.availability.who).toBe("admins");
    expect(getLoraRecord(PIXEL)!.licence.acknowledged_by).toBeNull();
  });

  test("turning a style on or off writes the record, and nothing is written to picture_adapter_prefs", async () => {
    const { actor } = await owner();
    await allAdapters();
    setAdapterEnabled(PIXEL, false, actor.id);
    expect(getLoraRecord(PIXEL)!.availability.who).toBe("admins");
    expect((await adaptersFor(["all-ages", "adult-only"])).map((a) => a.id)).toEqual([BOUDOIR]);
    setAdapterEnabled(PIXEL, true, actor.id);
    expect(getLoraRecord(PIXEL)).toMatchObject({ availability: { who: "adults" }, licence: { acknowledged_by: actor.id } });
    expect((await adaptersFor(["all-ages"])).map((a) => a.id)).toEqual([PIXEL]);
    expect(db.select().from(pictureAdapterPrefs).all()).toEqual([]);
  });

  test("the admin routes keep the record in step: add, confirm, change the age setting and name, remove", async () => {
    const { client, actor } = await owner();
    const f = new FormData();
    for (const [k, v] of Object.entries({ name: "Ink Wash", licence: "apache-2.0", all_ages: "yes", trigger_words: "inkwash" })) f.append(k, v);
    f.append("file", new File([new Uint8Array([1, 2, 3, 4])], "style.safetensors"));
    const added = ((await (await client.postForm("/api/pictures/admin/adapters", f)).json()) as { adapter: { id: string } }).adapter;
    expect(getLoraRecord(added.id)).toMatchObject({ media: "picture", availability: { who: "admins" }, added_by: actor.id, licence: { acknowledged_by: null } });
    await client.request(`/api/pictures/admin/adapters/${added.id}`, { method: "PATCH", body: { enabled: true, classification: "adult-only", name: "Ink Wash 2" } });
    expect(getLoraRecord(added.id)).toMatchObject({ name: "Ink Wash 2", audience: "adult-only", audience_set_by: null, availability: { who: "adults" } });
    await client.request(`/api/pictures/admin/adapters/${added.id}`, { method: "PATCH", body: { classification: "all-ages" }, headers: unlockHeader(await unlock(client, "correcthorse")) });
    expect(getLoraRecord(added.id)).toMatchObject({ audience: "all-ages", audience_set_by: actor.id });
    expect((await client.request(`/api/pictures/admin/adapters/${added.id}`, { method: "DELETE" })).status).toBe(200);
    expect(getLoraRecord(added.id)).toBeNull();
    expect(db.select().from(pictureAdapterPrefs).all()).toEqual([]);
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
    __resetLoraSyncForTests();
    expect(await allAdapters()).toEqual([]);
    expect(pictureRecords()).toEqual([]);
  });
});
