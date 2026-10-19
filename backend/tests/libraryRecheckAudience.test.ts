import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people, shares } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { fileAudience } from "@/lib/access";
import { logsDir } from "@/lib/paths";
import { __resetAgeCheckForTests, type ImageCheck } from "@/lib/pictures/ageCheck";
import { nextHlc } from "@/lib/hlc";
import { newShareId } from "@/lib/id";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { testPng } from "./pictureFixture";

beforeEach(resetDb);
afterEach(() => __resetAgeCheckForTests());
const benign = { ok: true, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none", is_nude_or_sexual: false, confidence: 1 } } satisfies ImageCheck;
async function fixture() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).get()!;
  const clients: Record<string, TestClient> = {};
  for (const [role, displayName] of [["adult", "Lucia"], ["teen", "Riff"], ["child", "Bramble"]]) {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000" });
    const { id } = await made.json() as { id: string };
    const client = new TestClient(); await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" }); clients[role!] = client;
  }
  const file = storeFile(actor, { conversationId: null, turnId: null, bytes: await testPng(), mediaType: "image/png", provenance: 'picture-gen:{"v":1,"audience":"adult-only","prompt":"a nude adult"}', retention: "kept" });
  if (!file.ok) throw new Error(file.error);
  const id = file.value.id;
  // An older household share must become readable only after a successful check.
  db.insert(shares).values({ id: newShareId(), fileId: id, fromPersonId: actor.id, to: "household", provenance: "files-page:share", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
  return { owner, actor, clients, id, audience: () => fileAudience(db.select().from(attachments).where(eq(attachments.id, id)).get()!.provenance) };
}
test("adult owner rechecks stored pixels despite sexual prompt words; child then lists and fetches; audit is written", async () => {
  const f = await fixture(); let checked = 0;
  __resetAgeCheckForTests(async images => { checked += images.length; return [benign]; });
  expect((await f.clients.child!.get(`/api/files/${f.id}/content`)).status).toBe(404);
  db.update(people).set({ birthdate: "2020-01-01" }).where(eq(people.id, f.actor.id)).run();
  expect((await f.owner.post(`/api/files/${f.id}/recheck-audience`)).status).toBe(200);
  expect(checked).toBe(1); expect(f.audience()).toBe("all-ages");
  expect((await f.clients.child!.get(`/api/files/${f.id}/content`)).status).toBe(200);
  const list = await (await f.clients.child!.get("/api/library")).json() as { items: { id: string }[] };
  expect(list.items.map(item => item.id)).toContain(f.id);
  const log = readFileSync(join(logsDir, "hub.log"), "utf8");
  expect(log).toContain('"event":"library.recheck-audience"'); expect(log).toContain(f.id); expect(log).toContain(f.actor.id);
  expect(log).toContain('"after":"all-ages"'); expect(log).not.toContain("a nude adult");
});
for (const scenario of ["sexual", "doubt", "failure", "empty", "error"] as const) test(`${scenario} leaves adult-only`, async () => {
  const f = await fixture();
  __resetAgeCheckForTests(async () => {
    if (scenario === "error") throw new Error("unavailable");
    if (scenario === "empty") return [];
    if (scenario === "failure") return [{ ok: false, why: "timeout" }];
    return [{ ok: true, verdict: { ...benign.verdict, is_nude_or_sexual: scenario === "sexual", confidence: scenario === "doubt" ? 0.1 : 1 } }];
  });
  expect((await f.owner.post(`/api/files/${f.id}/recheck-audience`)).status).toBe(400);
  expect(f.audience()).toBe("adult-only");
});
test("non-owner adults and minors receive 404, including minor owners; the role decides", async () => {
  const f = await fixture(); let checked = 0;
  __resetAgeCheckForTests(async () => { checked++; return [benign]; });
  for (const client of Object.values(f.clients)) expect((await client.post(`/api/files/${f.id}/recheck-audience`)).status).toBe(404);
  for (const role of ["child", "teen"]) {
    db.update(people).set({ role, birthdate: "1980-01-01" }).where(eq(people.id, f.actor.id)).run();
    expect((await f.owner.post(`/api/files/${f.id}/recheck-audience`)).status).toBe(404);
  }
  expect(checked).toBe(0);
});
test("rechecks are rate limited per person", async () => {
  const f = await fixture(); __resetAgeCheckForTests(async () => [{ ok: false, why: "unavailable" }]);
  for (let i = 0; i < 20; i++) expect((await f.owner.post(`/api/files/${f.id}/recheck-audience`)).status).toBe(400);
  expect((await f.owner.post(`/api/files/${f.id}/recheck-audience`)).status).toBe(429);
});

import { recheckFileAudience } from "@/lib/libraryAudience";
for (const change of ["provenance", "ownership", "role", "disabled", "deleted", "trash"] as const) test(`recheck fails closed after concurrent ${change} change`, async () => {
  const f = await fixture();
  __resetAgeCheckForTests(async () => {
    if (change === "provenance") db.update(attachments).set({ provenance: 'picture-gen:{"v":1,"audience":"adult-only","newer":true}' }).where(eq(attachments.id, f.id)).run();
    if (change === "ownership") db.update(attachments).set({ ownerPersonId: db.select().from(people).all().find(p => p.role === "adult")!.id }).where(eq(attachments.id, f.id)).run();
    if (change === "role") db.update(people).set({ role: "teen" }).where(eq(people.id, f.actor.id)).run();
    if (change === "disabled") db.update(people).set({ enabled: false }).where(eq(people.id, f.actor.id)).run();
    if (change === "deleted") db.update(people).set({ deletedAt: new Date().toISOString() }).where(eq(people.id, f.actor.id)).run();
    if (change === "trash") db.update(attachments).set({ deletedAt: new Date().toISOString() }).where(eq(attachments.id, f.id)).run();
    return [benign];
  });
  expect((await recheckFileAudience(f.actor, f.id)).ok).toBe(false);
  expect(f.audience()).toBe("adult-only");
  if (change === "provenance") expect(db.select().from(attachments).where(eq(attachments.id, f.id)).get()!.provenance).toContain('"newer":true');
});
for (const scenario of ["disabled", "deleted", "malformed", "array", "non-image", "all-ages"] as const) test(`ineligible ${scenario} target has missing-id parity without running vision`, async () => {
  const f = await fixture(); let checked = 0;
  __resetAgeCheckForTests(async () => { checked++; return [benign]; });
  if (scenario === "disabled") db.update(people).set({ enabled: false }).where(eq(people.id, f.actor.id)).run();
  if (scenario === "deleted") db.update(people).set({ deletedAt: new Date().toISOString() }).where(eq(people.id, f.actor.id)).run();
  if (scenario === "malformed" || scenario === "array" || scenario === "all-ages") db.update(attachments).set({ provenance: scenario === "malformed" ? 'picture-gen:{"audience":"adult-only"' : scenario === "array" ? 'picture-gen:["adult-only"]' : 'picture-gen:{"v":1,"audience":"all-ages"}' }).where(eq(attachments.id, f.id)).run();
  if (scenario === "non-image") db.update(attachments).set({ mediaType: "video/mp4" }).where(eq(attachments.id, f.id)).run();
  expect(await recheckFileAudience(f.actor, f.id)).toEqual(await recheckFileAudience(f.actor, "missing"));
  expect(checked).toBe(0);
});
test("each adult has an independent recheck limiter", async () => {
  const f = await fixture();
  __resetAgeCheckForTests(async () => [{ ok: false, why: "unavailable" }]);
  for (let i = 0; i < 20; i++) expect((await recheckFileAudience(f.actor, f.id))).toMatchObject({ status: 400 });
  expect(await recheckFileAudience(f.actor, f.id)).toMatchObject({ status: 429 });
  const other = db.select().from(people).all().find(p => p.role === "adult")!;
  const file = storeFile(other, { conversationId: null, turnId: null, bytes: await testPng(), mediaType: "image/png", provenance: 'picture-gen:{"v":1,"audience":"adult-only"}', retention: "kept" });
  if (!file.ok) throw new Error(file.error);
  expect(await recheckFileAudience(other, file.value.id)).toMatchObject({ status: 400 });
});
