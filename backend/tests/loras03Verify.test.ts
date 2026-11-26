// VIDEO-LORA-03 verification pass (docs/dev/loras.md "Verified"): regression tests for what the review of commit 44a0d967c found. Each fails without its fix.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { videoJobs } from "@/db/schema";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { clipsUsingStyle } from "@/lib/loras/usage";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { clipMarkOf } from "@/lib/videos/editGate";
import { setHouseholdSettingValue } from "@/lib/settings";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { household, textOf } from "./fixtures/adultLock";
import { putLora } from "./fixtures/lora";
import type { VideoJob } from "@/lib/videos/jobs";

setDefaultTimeout(30_000);
let fake: FakeVideoStack;
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); __resetAdultLockForTests(); __resetThrottleForTests();
  fake = installFakeVideoStack();
  fake.loras = [];
});
afterEach(() => { fake.restore(); setHouseholdSettingValue("generation.video.adult_adapters", "allowed"); });

const PAST = { removed_at: "2026-09-01T00:00:00.000Z", trash_until: "2026-10-01T00:00:00.000Z" };

function insertJob(personId: string, id: string, state: string, loras: string[]): void {
  const t = new Date().toISOString();
  db.insert(videoJobs).values({ id, personId, kind: "generate", state, prompt: "p", request: JSON.stringify({ loras }), files: "[]", createdAt: t, updatedAt: t, hlc: "0:0:testaa" }).run();
}

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
