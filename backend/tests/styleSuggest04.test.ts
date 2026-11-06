import { afterEach, beforeEach, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { household, unlock, unlockHeader } from "./fixtures/adultLock";
import { putLora } from "./fixtures/lora";
import { suggestStyles } from "@/lib/loras/suggest";
import { getLoraRecord } from "@/lib/loras/store";
import { __resetAdultLockForTests, issueProof, type AdultProof } from "@/lib/adultLock";
import { __resetLoraSyncForTests } from "@/lib/loras/sync";
import { installFakeVideoStack } from "./videoFixture";
import type { PersonRow } from "@/types";
import { TestClient } from "./client";
import { sessionKeyOf } from "@/lib/adultLock";
import { adminLoraView } from "@/routes/loras";

let fake: ReturnType<typeof installFakeVideoStack>;
beforeEach(() => { resetDb(); __resetAdultLockForTests(); __resetLoraSyncForTests(); fake = installFakeVideoStack(); fake.loras = []; });
afterEach(() => fake.restore());
const proofFor = (p: PersonRow): AdultProof => ({ token: issueProof(p.id, "test-session", "t").proof, sessionKey: "test-session" });

test("matches in either media; ranks matches and caps two total with at most one character", async () => {
  const { owner, row } = await household(); const admin = row("Sage");
  const records = [
    putLora(admin.id, { name: "Blue watercolour", description: "soft brush", availability: { who: "adults", people: [] } }),
    putLora(admin.id, { name: "Watercolour character one", kind: "character", availability: { who: "adults", people: [] } }),
    putLora(admin.id, { name: "Watercolour character two", kind: "character", availability: { who: "adults", people: [] } }),
    putLora(admin.id, { name: "Watercolour picture", media: "picture", base_model: "wan2.2-ti2v-5b", compatible_with: ["wan2.2-ti2v-5b"], availability: { who: "adults", people: [] } }),
  ];
  const result = suggestStyles({ person: admin, media: "video", text: "watercolour blue brush" }).items;
  expect(result).toHaveLength(2);
  expect(result.filter((l) => l.kind === "character")).toHaveLength(1);
  expect(suggestStyles({ person: admin, media: "picture", text: "watercolour" }).items.map((l) => l.id)).toEqual([records[3]!.id]);
  expect(suggestStyles({ person: admin, media: "video", text: "   " }).items).toEqual([]);
  expect((await owner.get("/api/loras/available")).status).toBe(200);
});

test("switch off, defaults, locked adult-only, minor, guest and spoken surface gates", async () => {
  const { owner, row } = await household(); const admin = row("Sage"); const teen = row("Nova"); const child = row("Sprout");
  const allAges = putLora(admin.id, { name: "Amber silk", availability: { who: "adults", people: [] } });
  const disabled = putLora(admin.id, { name: "Amber velvet", allow_suggesting: false, availability: { who: "adults", people: [] } });
  const adultOnly = putLora(admin.id, { name: "Amber lace", audience: "adult-only", audience_set_by: null, audience_set_at: null, availability: { who: "adults", people: [] } });
  const promptMatches = suggestStyles({ person: admin, media: "video", text: "amber" }).items.map((l) => l.id);
  expect(promptMatches).toContain(allAges.id);
  expect(promptMatches).not.toContain(disabled.id);
  expect(promptMatches).not.toContain(adultOnly.id);
  const signedProof = proofFor(admin);
  expect(suggestStyles({ person: admin, media: "video", text: "amber", proof: signedProof }).items.map((l) => l.id)).not.toContain(adultOnly.id);
  expect(suggestStyles({ person: teen, media: "video", text: "amber", proof: proofFor(teen) }).items).toEqual([]);
  expect(suggestStyles({ person: child, media: "video", text: "amber", proof: proofFor(child) }).items).toEqual([]);
  expect(suggestStyles({ person: { ...row("Marlow"), role: "guest" } as PersonRow, media: "video", text: "amber" }).items).toEqual([]);
  expect(suggestStyles({ person: admin, media: "video", text: "amber", surface: "spoken", proof: proofFor(admin) }).items).toEqual([]);
});

test("admin availability, removed and unusable styles are excluded", async () => {
  const { row } = await household(); const admin = row("Sage"); const adult = row("Marlow");
  const hidden = putLora(admin.id, { name: "Copper leaf", availability: { who: "admins", people: [] } });
  const removed = putLora(admin.id, { name: "Copper leaf removed", removed_at: "2026-11-05T00:00:00.000Z", trash_until: "2026-12-05T00:00:00.000Z", availability: { who: "adults", people: [] } });
  const unusable = putLora(admin.id, { name: "Copper leaf unknown", base_model: "unknown", compatible_with: [], availability: { who: "adults", people: [] } });
  expect(suggestStyles({ person: adult, media: "video", text: "copper leaf" }).items).toEqual([]);
  expect(suggestStyles({ person: admin, media: "video", text: "copper leaf" }).items.map((l) => l.id)).not.toContain(removed.id);
  expect(suggestStyles({ person: admin, media: "video", text: "copper leaf" }).items.map((l) => l.id)).not.toContain(unusable.id);
  expect(getLoraRecord(hidden.id)).not.toBeNull();
});

test("suggest route redacts fields, handles auth and teen; patch flag is admin only", async () => {
  const { owner, adult, teen, row } = await household(); const admin = row("Sage");
  const lora = putLora(admin.id, { name: "Silver moon", trigger_words: ["moonbeam"], availability: { who: "adults", people: [] } });
  expect((await new TestClient().request("/api/loras/suggest", { method: "POST", body: { media: "video", text: "moonbeam" } })).status).toBe(401);
  const response = await adult.client.request("/api/loras/suggest", { method: "POST", body: { media: "video", text: "moonbeam" } });
  expect(await response.json()).toEqual({ items: [{ id: lora.id, name: lora.name, kind: lora.kind }] });
  expect(await (await teen.client.request("/api/loras/suggest", { method: "POST", body: { media: "video", text: "moonbeam" } })).json()).toEqual({ items: [] });
  const patched = await owner.request(`/api/loras/${lora.id}`, { method: "PATCH", body: { allow_suggesting: false } });
  expect(patched.status).toBe(200);
  expect(await patched.json()).toMatchObject({ allow_suggesting: false });
  expect(getLoraRecord(lora.id)?.allow_suggesting).toBe(false);
  const defaultAllAges = adminLoraView(getLoraRecord(lora.id)!);
  expect(defaultAllAges.allow_suggesting).toBe(false);
  const defaultAdult = putLora(admin.id, { name: "Default adult", audience: "adult-only", audience_set_by: null, audience_set_at: null });
  expect(adminLoraView(defaultAdult).allow_suggesting).toBe(false);
  const defaultOn = putLora(admin.id, { name: "Default all ages" });
  expect(adminLoraView(defaultOn).allow_suggesting).toBe(true);
  expect((await adult.client.request(`/api/loras/${lora.id}`, { method: "PATCH", body: { allow_suggesting: true } })).status).toBe(403);
  const proof = (await unlock(owner, "correcthorse"));
  const adminLora = putLora(admin.id, { name: "Private velvet", audience: "adult-only", audience_set_by: null, audience_set_at: null, allow_suggesting: true, availability: { who: "adults", people: [] } });
  const lockedRoute = await owner.request("/api/loras/suggest", { method: "POST", body: { media: "video", text: "private velvet" } });
  expect(((await lockedRoute.json()) as { items: unknown[] }).items).toEqual([]);
  const unlockedRoute = await owner.request("/api/loras/suggest", { method: "POST", body: { media: "video", text: "private velvet" }, headers: unlockHeader(proof) });
  expect(((await unlockedRoute.json()) as { items: Array<{ id: string }> }).items.map((i) => i.id)).toContain(adminLora.id);
  expect((await owner.post("/api/loras/suggest", { media: "video", text: "silver" })).status).toBe(200);
});
