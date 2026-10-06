// STORE-DELETE-01, the real flow for chat pictures: a person sends
// pictures through the chat upload route (UPLOAD-IMG-01), is deleted, and
// nothing of theirs is left under the attachments directory except a
// picture they shared, which the household keeps.
import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversationTurns, people } from "@/db/schema";
import { attachmentsDir, dataDir } from "@/lib/paths";
import { createShare } from "@/lib/shares";
import { newConversationTurnId } from "@/lib/id";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

async function png(shade: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: 12, height: 8, channels: 3, background: { r: shade, g: 120, b: 200 } } }).png().toBuffer());
}

async function upload(client: TestClient, bytes: Uint8Array, conversationId: string | undefined, turnId: string) {
  const form = new FormData();
  form.append("file", new File([bytes], "photo.png", { type: "image/png" }));
  form.append("turn_id", turnId);
  if (conversationId) form.append("conversation_id", conversationId);
  const res = await client.postForm("/api/attachments/upload", form);
  expect(res.status).toBe(201);
  return (await res.json()) as { conversation_id: string; turn_id: string; image: { id: string } };
}

/** Every regular file under the attachments directory, as the
 * dataDir-relative path a File record's storage_path holds. */
function filesOnDisk(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else found.push(relative(dataDir, full).replaceAll("\\", "/"));
    }
  };
  walk(attachmentsDir);
  return found.sort();
}

describe("a deleted person's chat pictures", () => {
  test("both uploaded pictures go, records and files, and only the shared one is left on disk", async () => {
    // resetDb() clears records, not bytes another test file left behind,
    // so the sweep compares against what was on disk before this test.
    const before = new Set(filesOnDisk());
    const added = () => filesOnDisk().filter((path) => !before.has(path));
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await owner.post("/api/people", { displayName: "Bramble", role: "adult", secret: "bramblepin1" });
    const brambleId = ((await created.json()) as { id: string }).id;
    const lucia = await owner.post("/api/people", { displayName: "Lucia", role: "adult", secret: "luciapin1" });
    const luciaId = ((await lucia.json()) as { id: string }).id;
    const bramble = new TestClient();
    expect((await bramble.post("/api/auth/verify-secret", { personId: brambleId, secret: "bramblepin1" })).status).toBe(200);

    // Picture one is sent: its turn completes and carries the message.
    const sent = await upload(bramble, await png(10), undefined, newConversationTurnId());
    db.update(conversationTurns).set({ status: "completed", userText: "look at this", replyText: "lovely" }).where(eq(conversationTurns.id, sent.turn_id)).run();
    // Picture two was attached to a message never sent: its turn is still
    // the provisional one the upload made.
    const draft = await upload(bramble, await png(40), sent.conversation_id, newConversationTurnId());
    // Picture three is shared, so the household keeps it.
    const kept = await upload(bramble, await png(90), sent.conversation_id, newConversationTurnId());
    const brambleRow = db.select().from(people).where(eq(people.id, brambleId)).get()!;
    expect(createShare(brambleRow, { fileId: kept.image.id, to: luciaId }).ok).toBe(true);

    const rows = db.select().from(attachments).where(eq(attachments.ownerPersonId, brambleId)).all();
    expect(rows.map((r) => r.id).sort()).toEqual([sent.image.id, draft.image.id, kept.image.id].sort());
    expect(rows.find((r) => r.id === sent.image.id)!.turnId).toBe(sent.turn_id);
    const keptPath = rows.find((r) => r.id === kept.image.id)!.storagePath;
    expect(added()).toEqual(rows.map((r) => r.storagePath).sort());

    const deleted = await owner.request(`/api/people/${brambleId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);

    for (const gone of [sent.image.id, draft.image.id]) {
      expect(db.select().from(attachments).where(eq(attachments.id, gone)).get()).toBeUndefined();
    }
    // The sweep: the only file this test left anywhere under the
    // attachments directory is the shared picture, nothing else remains
    // in Bramble's folder, and the shared picture still has its record.
    expect(added()).toEqual([keptPath]);
    expect(filesOnDisk().filter((path) => path.startsWith(`people/${brambleId}/`))).toEqual([keptPath]);
    const remaining = db.select({ storagePath: attachments.storagePath }).from(attachments).all().map((r) => r.storagePath);
    expect(remaining).toEqual([keptPath]);
    // And the picture that was served before is not served any more.
    expect((await owner.get(`/api/attachments/${sent.image.id}?v=full`)).status).toBe(404);
  });
});
