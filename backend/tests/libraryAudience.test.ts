import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people, conversationTurns } from "@/db/schema";
import { createAttachment, getAttachment, readAttachment } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { nextHlc } from "@/lib/hlc";
import { newConversationTurnId } from "@/lib/id";
import { startPictureJob, getPictureJob } from "@/lib/pictures/jobs";
import { __resetAgeCheckForTests } from "@/lib/pictures/ageCheck";
import { listFilesVisibleToActor } from "@/lib/shares";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { startVideoJob, getVideoJobFor } from "@/lib/videos/jobs";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { installFakeVideoStack } from "./videoFixture";
import { installFakeImageStack, testPng, until } from "./pictureFixture";

beforeEach(() => resetDb());
afterEach(() => { __resetAgeCheckForTests(); __setKeyframesForTests(null); });

for (const role of ["child", "teen"] as const) {
  test(`${role} cannot discover or read adult-only and unclassified household files`, async () => {
    const owner = new TestClient();
    const setup = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const ownerId = ((await setup.json()) as { person: { id: string } }).person.id;
    const actor = db.select().from(people).where(eq(people.id, ownerId)).get()!;
    const readers: TestClient[] = [];
    for (const [displayName, readerRole] of [["Bramble", role], ["Lucia", "adult"]] as const) {
      const made = await owner.post("/api/people", { displayName, role: readerRole, secret: "0000" });
      const id = ((await made.json()) as { id: string }).id;
      const client = new TestClient();
      expect((await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" })).status).toBe(200);
      readers.push(client);
    }
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error(conversation.error);
    const conversationId = conversation.value.id;
    const turnId = newConversationTurnId();
    db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId, userText: "a boat", replyText: "saved", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
    __resetAgeCheckForTests(async images => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
    const fake = installFakeImageStack({ pollsToFinish: 1 });
    const video = installFakeVideoStack({ pollsToFinish: 1 });
    __setKeyframesForTests(async () => [await testPng()]);
    try {
      const ids: string[] = [];
      for (const adult of [true, false]) {
        const job = await startPictureJob({ actor, conversationId, turnId, temporary: false, kind: "generate", prompt: "a boat", body: { prompt: "a boat", audience: adult ? "adult" : "all-ages", ...(adult ? { loras: [{ id: "lora-bbbbbbbbbbbbbbbb", scale: 0.9 }] } : {}) } });
        await until(() => getPictureJob(actor, job.id)?.state === "done");
        ids.push(getPictureJob(actor, job.id)!.files[0]!.id);
      }
      const clip = await startVideoJob({ actor, conversationId, turnId, temporary: false, kind: "generate", prompt: "a nude adult", body: { prompt: "a nude adult", audience: "adult" } });
      await until(() => getVideoJobFor(actor, clip.id)?.state === "done");
      const output = getVideoJobFor(actor, clip.id)!.files[0]!;
      const derivedIds = [output.id, output.poster_id];
      const unknown = createAttachment(actor, { conversationId, turnId, mediaType: "image/jpeg", bytes: new TextEncoder().encode("unclassified"), deduplicate: false });
      if (!unknown.ok) throw new Error(unknown.error);
      ids.push(unknown.value.id);
      const shareIds = new Map<string, string>();
      for (const id of [...ids, ...derivedIds]) {
        const shared = await owner.post(`/api/files/${id}/shares`, { to: "household" });
        expect(shared.status).toBe(201);
        shareIds.set(id, ((await shared.json()) as { id: string }).id);
      }
      const [adultId, safeId, unknownId] = ids as [string, string, string];
      const minor = readers[0]!;
      for (const path of ["/api/files", `/api/files?owner=${ownerId}`]) {
        const rows = await (await minor.get(path)).json() as { file: { id: string } }[];
        expect(rows.map(row => row.file.id)).toEqual([safeId]);
      }
      for (const id of [adultId, unknownId, ...derivedIds]) {
        expect((await minor.request(`/api/shares/${shareIds.get(id)}`, { method: "DELETE" })).status).toBe(404);
        for (const suffix of ["", "/content", "/shares"]) expect((await minor.get(`/api/files/${id}${suffix}`)).status).toBe(404);
        expect((await minor.post(`/api/files/${id}/shares`, { to: "household" })).status).toBe(404);
        expect((await minor.get(`/api/videos/jobs/${clip.id}/files/${id}`)).status).toBe(404);
        expect((await minor.get(`/api/image-edit/pictures/${id}?conversation_id=${conversationId}`)).status).toBe(404);
        for (const v of ["thumb", "full"]) expect((await minor.get(`/api/attachments/${id}?v=${v}&conversation_id=${conversationId}`)).status).toBe(404);
      }
      expect((await minor.get(`/api/files/${safeId}/content`)).status).toBe(200);
      for (const reader of [owner, readers[1]!]) {
        const rows = await (await reader.get("/api/files")).json() as { file: { id: string } }[];
        expect(rows.map(row => row.file.id).sort()).toEqual([...ids, ...derivedIds].sort());
        for (const id of [...ids, ...derivedIds]) expect((await reader.get(`/api/files/${id}/content`)).status).toBe(200);
      }
      // Owners retain access even after their role changes to a minor band.
      db.update(people).set({ role }).where(eq(people.id, ownerId)).run();
      const minorOwner = db.select().from(people).where(eq(people.id, ownerId)).get()!;
      expect(listFilesVisibleToActor(minorOwner).map(row => row.file.id).sort()).toEqual([...ids, ...derivedIds].sort());
      for (const id of ids) {
        expect(getAttachment(minorOwner, id).ok).toBe(true);
        expect(readAttachment(minorOwner, id).ok).toBe(true);
      }
      for (const id of [adultId, ...derivedIds]) {
        const note = db.select().from(attachments).where(eq(attachments.id, id)).get()!.provenance;
        expect(JSON.parse(note.slice(note.indexOf(":") + 1)).audience).toBe("adult-only");
      }
    } finally { fake.restore(); video.restore(); }
  });
}
