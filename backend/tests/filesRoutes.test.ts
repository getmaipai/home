// STORE-SHARE-01's REST surface - lib/shares.ts and lib/attachments.ts
// hold the rules (see shares.test.ts, access.test.ts); this exercises
// the real HTTP boundary the same way lists.test.ts does for lib/lists.ts.
import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { createAttachment } from "@/lib/attachments";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { eq } from "drizzle-orm";

beforeEach(() => resetDb());

async function ownerSession(): Promise<{ client: TestClient; id: string }> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const { person } = (await res.json()) as { person: { id: string } };
  return { client, id: person.id };
}

async function signedInAdult(owner: TestClient, displayName: string): Promise<{ client: TestClient; id: string }> {
  const res = await owner.post("/api/people", { displayName, role: "adult", secret: "0000" });
  const created = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
  return { client, id: created.id };
}

function uploadFileFor(ownerId: string): string {
  const actor = db.select().from(people).where(eq(people.id, ownerId)).get()!;
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const turnId = newConversationTurnId();
  db.insert(conversationTurns)
    .values({
      id: turnId,
      personId: actor.id,
      surface: "chat",
      conversationId: conversation.value.id,
      userText: "note",
      replyText: "saved",
      source: "model",
      safetyAction: "allow",
      createdAt: new Date().toISOString(),
      hlc: nextHlc(),
    })
    .run();
  const created = createAttachment(actor, { conversationId: conversation.value.id, turnId, mediaType: "image/png", bytes: new TextEncoder().encode("bytes") });
  if (!created.ok) throw new Error(created.error);
  return created.value.id;
}

describe("GET /api/files", () => {
  test("lists my own files", async () => {
    const owner = await ownerSession();
    const fileId = uploadFileFor(owner.id);

    const res = await owner.client.get("/api/files");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { file: { id: string }; owner_person_id: string; shared: boolean }[];
    expect(body.some((row) => row.file.id === fileId && !row.shared && row.owner_person_id === owner.id)).toBe(true);
  });
});

// PEOPLE-PROFILE-02: the profile page's own scoped read of the Library
// list (lib/shares.ts's listPersonFilesVisibleToActor, exercised
// directly in shares.test.ts) - this is the HTTP boundary those cases
// go through in the real app.
describe("GET /api/files?owner=", () => {
  test("a direct recipient sees the owner's file; a third person sees nothing", async () => {
    const owner = await ownerSession();
    const lucia = await signedInAdult(owner.client, "Lucia");
    const marlow = await signedInAdult(owner.client, "Marlow");
    const fileId = uploadFileFor(owner.id);
    const shareRes = await owner.client.post(`/api/files/${fileId}/shares`, { to: lucia.id });
    expect(shareRes.status).toBe(201);

    const luciaRes = await lucia.client.get(`/api/files?owner=${owner.id}`);
    expect(luciaRes.status).toBe(200);
    const luciaBody = (await luciaRes.json()) as { file: { id: string } }[];
    expect(luciaBody.some((row) => row.file.id === fileId)).toBe(true);

    const marlowRes = await marlow.client.get(`/api/files?owner=${owner.id}`);
    expect(marlowRes.status).toBe(200);
    const marlowBody = (await marlowRes.json()) as { file: { id: string } }[];
    expect(marlowBody.some((row) => row.file.id === fileId)).toBe(false);
  });

  test("the owner viewing their own profile sees their own file with no share at all", async () => {
    const owner = await ownerSession();
    const fileId = uploadFileFor(owner.id);

    const res = await owner.client.get(`/api/files?owner=${owner.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { file: { id: string } }[];
    expect(body.some((row) => row.file.id === fileId)).toBe(true);
  });

  test("with no owner given, behaves exactly like the plain Library list", async () => {
    const owner = await ownerSession();
    const fileId = uploadFileFor(owner.id);

    const res = await owner.client.get("/api/files");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { file: { id: string } }[];
    expect(body.some((row) => row.file.id === fileId)).toBe(true);
  });
});

describe("GET /api/files/{id}/content", () => {
  test("a person with access gets the real bytes back with the right content type", async () => {
    const owner = await ownerSession();
    const fileId = uploadFileFor(owner.id);

    const res = await owner.client.get(`/api/files/${fileId}/content`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("bytes");
  });

  test("a recipient the file was shared with can fetch its bytes too", async () => {
    const owner = await ownerSession();
    const lucia = await signedInAdult(owner.client, "Lucia");
    const fileId = uploadFileFor(owner.id);
    await owner.client.post(`/api/files/${fileId}/shares`, { to: lucia.id });

    const res = await lucia.client.get(`/api/files/${fileId}/content`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("bytes");
  });

  test("someone with no access gets a 404, never the bytes", async () => {
    const owner = await ownerSession();
    const marlow = await signedInAdult(owner.client, "Marlow");
    const fileId = uploadFileFor(owner.id);

    const res = await marlow.client.get(`/api/files/${fileId}/content`);
    expect(res.status).toBe(404);
  });

  // A code review on this item caught two real defects in the first
  // cut: an `immutable, max-age=1y` header that would have let a
  // browser keep serving a revoked share's bytes forever with no
  // access check ever running again, and no Range support at all for
  // MediaGrid's video lightbox (a browser's own video element seeks by
  // sending a Range request; a route that always returns the full body
  // breaks seeking, and refuses to play at all in some browsers).
  test("never tells the browser to cache the bytes - a share can be revoked and must take effect at once", async () => {
    const owner = await ownerSession();
    const fileId = uploadFileFor(owner.id);

    const res = await owner.client.get(`/api/files/${fileId}/content`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("a Range request gets back exactly that slice, as a 206 with Content-Range", async () => {
    const owner = await ownerSession();
    const fileId = uploadFileFor(owner.id); // real bytes are the 5-byte string "bytes"

    const res = await owner.client.get(`/api/files/${fileId}/content`, { Range: "bytes=0-2" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-2/5");
    expect(await res.text()).toBe("byt");
  });

  test("an unsatisfiable Range (past the end) falls back to the full body rather than erroring", async () => {
    const owner = await ownerSession();
    const fileId = uploadFileFor(owner.id);

    const res = await owner.client.get(`/api/files/${fileId}/content`, { Range: "bytes=0-999" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("bytes");
  });

  // A code review on this item caught the first cut treating an empty
  // start as `0` unconditionally, which reads a suffix range
  // ("the LAST n bytes," RFC 7233) as if it meant "from byte 0."
  test("a suffix Range (bytes=-N, the last N bytes) is read as the end of the file, not the start", async () => {
    const owner = await ownerSession();
    const fileId = uploadFileFor(owner.id); // real bytes are the 5-byte string "bytes"

    const res = await owner.client.get(`/api/files/${fileId}/content`, { Range: "bytes=-2" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 3-4/5");
    expect(await res.text()).toBe("es");
  });

  // A code review flagged that Content-Length was never asserted for a
  // sliced (206) response, the exact case (partial video content) this
  // route was built to support - checked here rather than left assumed.
  test("a Range response's Content-Length matches the slice, not the whole file", async () => {
    const owner = await ownerSession();
    const fileId = uploadFileFor(owner.id);

    const res = await owner.client.get(`/api/files/${fileId}/content`, { Range: "bytes=0-2" });
    expect(res.headers.get("content-length")).toBe("3");
  });
});

describe("POST /api/files/{id}/shares and DELETE /api/shares/{id}", () => {
  test("sharing makes a file appear in the recipient's list, under the owner's name; unsharing removes it", async () => {
    const owner = await ownerSession();
    const lucia = await signedInAdult(owner.client, "Lucia");
    const fileId = uploadFileFor(owner.id);

    const shareRes = await owner.client.post(`/api/files/${fileId}/shares`, { to: lucia.id });
    expect(shareRes.status).toBe(201);
    const share = (await shareRes.json()) as { id: string; to: string };
    expect(share.to).toBe(lucia.id);

    const luciaList = await lucia.client.get("/api/files");
    expect(luciaList.status).toBe(200);
    const luciaBody = (await luciaList.json()) as { file: { id: string }; owner_person_id: string; shared: boolean }[];
    const entry = luciaBody.find((row) => row.file.id === fileId);
    expect(entry).toBeDefined();
    expect(entry?.owner_person_id).toBe(owner.id);
    expect(entry?.shared).toBe(true);

    const deleteRes = await owner.client.request(`/api/shares/${share.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);

    const luciaListAfter = await lucia.client.get("/api/files");
    const luciaBodyAfter = (await luciaListAfter.json()) as { file: { id: string } }[];
    expect(luciaBodyAfter.some((row) => row.file.id === fileId)).toBe(false);
  });

  test("a third person with no share cannot fetch the file directly", async () => {
    const owner = await ownerSession();
    const marlow = await signedInAdult(owner.client, "Marlow");
    const fileId = uploadFileFor(owner.id);

    const res = await marlow.client.get(`/api/files/${fileId}`);
    expect(res.status).toBe(404);
  });

  test("someone with no access to a file cannot share it", async () => {
    const owner = await ownerSession();
    const marlow = await signedInAdult(owner.client, "Marlow");
    const lucia = await signedInAdult(owner.client, "Lucia");
    const fileId = uploadFileFor(owner.id);

    const res = await marlow.client.post(`/api/files/${fileId}/shares`, { to: lucia.id });
    expect(res.status).toBe(403);
  });
});
