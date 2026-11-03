// VIDEO-LORA-08: the two small backend pieces the Styles tab needs. The admin list carries the source's adult check (evidence, never the decision), and making a style
// all ages when its source said adult needs a fresh single-use passcode ticket bound to that style (design 15.1); from unknown the unlock the admin holds is enough.
import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { getLoraRecord } from "@/lib/loras/store";
import { __resetLoraSyncForTests } from "@/lib/loras/sync";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { household, unlock, unlockHeader } from "./fixtures/adultLock";
import { putLora } from "./fixtures/lora";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";

setDefaultTimeout(30_000);
let fake: FakeVideoStack;
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); __resetLoraSyncForTests(); __resetAdultLockForTests(); __resetThrottleForTests();
  fake = installFakeVideoStack();
  fake.loras = [];
});

const check = (state: "normal" | "unknown" | "adult") => (state === "normal"
  ? { state, basis: "source_levels" as const, flag: false, levels_seen: 3, adult_levels: 0, checked_at: "2026-11-02T00:00:00.000Z" }
  : { state, basis: state === "adult" ? "source_flag" as const : "none" as const, flag: state === "adult" ? true : null, levels_seen: 0, adult_levels: 0, checked_at: "2026-11-02T00:00:00.000Z" });

describe("the Styles tab's backend", () => {
  test("the admin list says what the source's check was, and an absent check reads unknown", async () => {
    const { owner, row } = await household();
    const admin = row("Sage");
    putLora(admin.id, { name: "Safe one", adult_check: check("normal") });
    putLora(admin.id, { name: "Plain one" });
    const body = (await (await owner.request("/api/loras", {})).json()) as { items: Array<{ name: string; adult_check: string }> };
    expect(Object.fromEntries(body.items.map((i) => [i.name, i.adult_check]))).toEqual({ "Safe one": "normal", "Plain one": "unknown" });
    fake.restore();
  });

  test("all ages from an adult check needs a fresh ticket for that style; a wrong style, a reused or missing ticket is refused", async () => {
    const { owner, row } = await household();
    const admin = row("Sage");
    const style = putLora(admin.id, { audience: "adult-only", audience_set_by: null, audience_set_at: null, adult_check: check("adult") });
    const other = putLora(admin.id, { audience: "adult-only", audience_set_by: null, audience_set_at: null, adult_check: check("adult") });
    const proof = unlockHeader(await unlock(owner, "correcthorse"));
    const refused = await owner.post(`/api/loras/${style.id}/all-ages`, { confirm: true }, proof);
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toContain("Enter your passcode again");
    expect(getLoraRecord(style.id)?.audience).toBe("adult-only");
    const ticketFor = async (item: string) => ((await (await owner.post("/api/adult-lock/confirm", { secret: "correcthorse", action: "unmark", item })).json()) as { ticket: string }).ticket;
    // A ticket for another style does not work, and is spent by the attempt only when it could succeed.
    expect((await owner.post(`/api/loras/${style.id}/all-ages`, { confirm: true, ticket: await ticketFor(other.id) }, proof)).status).toBe(422);
    const good = await ticketFor(style.id);
    const done = await owner.post(`/api/loras/${style.id}/all-ages`, { confirm: true, ticket: good }, proof);
    expect(done.status).toBe(200);
    expect(getLoraRecord(style.id)).toMatchObject({ audience: "all-ages", audience_set_by: admin.id, adult_check: { state: "adult" } });
    // The check stays as evidence; the same ticket does not open the other style.
    expect((await owner.post(`/api/loras/${other.id}/all-ages`, { confirm: true, ticket: good }, proof)).status).toBe(422);
    fake.restore();
  });

  test("all ages from unknown needs only the unlock the admin already holds", async () => {
    const { owner, row } = await household();
    const style = putLora(row("Sage").id, { audience: "adult-only", audience_set_by: null, audience_set_at: null, adult_check: check("unknown") });
    const proof = unlockHeader(await unlock(owner, "correcthorse"));
    expect((await owner.post(`/api/loras/${style.id}/all-ages`, { confirm: true }, proof)).status).toBe(200);
    expect(getLoraRecord(style.id)?.audience).toBe("all-ages");
    fake.restore();
  });
});
