// VIDEO-LORA-03 verification pass (docs/dev/loras.md "Verified"): regression tests for what the review of commit 44a0d967c found. Each fails without its fix.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db, sqlite } from "@/db";
import { videoJobs } from "@/db/schema";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { markAdultOnly, patchLora, removeLora, confirmLora, restoreLora } from "@/lib/loras/admin";
import { getLoraRecord } from "@/lib/loras/store";
import { __resetLoraSyncForTests, syncLoras } from "@/lib/loras/sync";
import { clipsUsingStyle } from "@/lib/loras/usage";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { clipMarkOf } from "@/lib/videos/editGate";
import { __setVideosFetchForTests } from "@/lib/videos/stack";
import { setHouseholdSettingValue } from "@/lib/settings";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { household, textOf } from "./fixtures/adultLock";
import { putLora } from "./fixtures/lora";
import type { VideoJob } from "@/lib/videos/jobs";

setDefaultTimeout(30_000);
let fake: FakeVideoStack;
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); __resetLoraSyncForTests(); __resetAdultLockForTests(); __resetThrottleForTests();
  fake = installFakeVideoStack();
  fake.loras = [];
});
afterEach(() => { fake.restore(); setHouseholdSettingValue("generation.video.adult_adapters", "allowed"); });

const PAST = { removed_at: "2026-09-01T00:00:00.000Z", trash_until: "2026-10-01T00:00:00.000Z" };

function insertJob(personId: string, id: string, state: string, loras: string[]): void {
  const t = new Date().toISOString();
  db.insert(videoJobs).values({ id, personId, kind: "generate", state, prompt: "p", request: JSON.stringify({ loras }), files: "[]", createdAt: t, updatedAt: t, hlc: "0:0:testaa" }).run();
}

describe("the 30-day purge", () => {
  test("a style restored while an earlier file is being removed is not deleted", async () => {
    const { row } = await household();
    const admin = row("Sage");
    const a = putLora(admin.id, PAST);
    const b = putLora(admin.id, PAST);
    // The Stack's answer for the first file arrives while an admin restores the second.
    const inner = fake.handler;
    __setVideosFetchForTests((async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if ((init?.method ?? "GET") === "DELETE" && String(input).includes(a.id)) restoreLora(admin, b.id);
      return inner(input, init);
    }) as typeof fetch);
    await syncLoras(true);
    expect(getLoraRecord(a.id)).toBeNull();
    expect(getLoraRecord(b.id)).toMatchObject({ removed_at: null, trash_until: null });
  });

  test("a style a clip is being made with is kept until that clip is done", async () => {
    const { row } = await household();
    const admin = row("Sage");
    const style = putLora(admin.id, PAST);
    insertJob(admin.id, "vjob-running01", "running", [style.id]);
    await syncLoras(true);
    expect(getLoraRecord(style.id)).not.toBeNull();
    sqlite.query("UPDATE video_jobs SET state = 'done' WHERE id = 'vjob-running01'").run();
    await syncLoras(true);
    expect(getLoraRecord(style.id)).toBeNull();
  });
});

describe("the writer", () => {
  test("a listed person who is later made a guest, or is gone, does not block removing, marking or confirming the style", async () => {
    const { row } = await household();
    const admin = row("Sage");
    const marlow = row("Marlow");
    const style = putLora(admin.id, { availability: { who: "people", people: [marlow.id] } });
    // Marlow is later made a guest (and another listed id no longer exists at all): neither may block the admin.
    sqlite.query("UPDATE people SET role = 'guest' WHERE id = ?").run(marlow.id);
    const gone = "person-gone000000";
    sqlite.query("UPDATE loras SET record = json_set(record, '$.availability.people', json(?)) WHERE id = ?").run(JSON.stringify([marlow.id, gone]), style.id);
    expect(() => removeLora(admin, style.id)).not.toThrow();
    expect(getLoraRecord(style.id)?.removed_at).not.toBeNull();
    await markAdultOnly(admin, style.id);
    expect(getLoraRecord(style.id)?.audience).toBe("adult-only");
    // A person newly added who is not an adult is still refused.
    expect(() => patchLora(admin, style.id, { availability: { who: "people", people: [marlow.id, row("Nova").id] } })).toThrow();
  });
});

describe("the licence", () => {
  test("an unconfirmed style cannot be opened to other adults until an admin has confirmed it", async () => {
    const { row } = await household();
    const admin = row("Sage");
    const style = putLora(admin.id, { licence: { id: "unknown", text: null, commercial_use: "unknown", acknowledged_by: null, acknowledged_at: null } });
    expect(() => patchLora(admin, style.id, { availability: { who: "adults" } })).toThrow("Read the licence and confirm it first, then choose who can use this style.");
    expect(getLoraRecord(style.id)?.availability.who).toBe("admins");
    expect(() => patchLora(admin, style.id, { name: "Renamed" })).not.toThrow();
    confirmLora(admin, style.id);
    expect(patchLora(admin, style.id, { availability: { who: "adults" } }).availability.who).toBe("adults");
  });
});

describe("clips and removed styles", () => {
  test("an all-ages style that is later removed keeps its audience for a clip made with it (not fail-closed to adult-only)", async () => {
    const { row } = await household();
    const admin = row("Sage");
    const style = putLora(admin.id, PAST);
    const job = { files: [], temporary: true, prompt: "a paper boat", request: { loras: [style.id] } } as unknown as VideoJob;
    expect(await clipMarkOf(job)).toEqual({ madeAudience: "all-ages", lock: "off" });
    // A style that never existed is still adult-only.
    expect(await clipMarkOf({ ...job, request: { loras: ["lora-nothere00000"] } } as unknown as VideoJob)).toEqual({ madeAudience: "adult-only", lock: "off" });
  });

  test("clipsUsingStyle matches only that exact id (no LIKE wildcards in an id)", async () => {
    const { row } = await household();
    const admin = row("Sage");
    insertJob(admin.id, "vjob-exact00001", "done", ["lora-a_bcdefgh0000"]);
    insertJob(admin.id, "vjob-other00001", "done", ["lora-aXbcdefgh0000"]);
    insertJob(admin.id, "vjob-pct0000001", "done", ["lora-a%"]);
    expect(clipsUsingStyle("lora-a_bcdefgh0000").map((r) => r.id)).toEqual(["vjob-exact00001"]);
    expect(clipsUsingStyle("lora-a%").map((r) => r.id)).toEqual(["vjob-pct0000001"]);
    expect(clipsUsingStyle("lora-a_bcdefgh0000", ["running"])).toEqual([]);
  });
});

describe("the legacy add route", () => {
  test("an adult-only style just added is not described back without the unlock proof", async () => {
    const { owner } = await household();
    const form = new FormData();
    form.set("file", new File([new Uint8Array(16)], "x.safetensors"));
    form.set("name", "Zebraquill Cabaret Lace");
    form.set("licence", "apache-2.0");
    form.set("classification", "adult-only");
    const res = await owner.postForm("/api/videos/adapters", form);
    expect(res.status).toBe(200);
    const text = await textOf(res);
    for (const s of ["Zebraquill", "Cabaret", "3".repeat(64)]) expect(text).not.toContain(s);
    expect(JSON.parse(text.slice(0, text.indexOf("[[")))).toMatchObject({ name: "Locked style", trigger_words: [], source_url: null });
  });
});
