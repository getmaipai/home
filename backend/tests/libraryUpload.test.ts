// LIBRARY-REVAMP-11: upload to the Library.
import { beforeEach, expect, test } from "bun:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());
async function login() {
  const sage = new TestClient();
  await sage.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const make = async (displayName: string, role: string) => {
    const made = await sage.post("/api/people", { displayName, role, secret: "0000" });
    const id = ((await made.json()) as { id: string }).id;
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
    return client;
  };
  return { sage, teen: await make("Riff", "teen"), child: await make("Bramble", "child") };
}
const send = (client: TestClient, name: string, bytes: Uint8Array | string, type = "application/octet-stream") => {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type }));
  return client.postForm("/api/library/upload", form);
};
const png = async () => new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: "#3a7" } }).png().toBuffer());

test("a picture is cleaned, kept, named and listed; the same picture again is a duplicate", async () => {
  const { sage } = await login();
  const first = await send(sage, "Lake day.png", await png(), "image/png");
  expect(first.status).toBe(201);
  const body = (await first.json()) as { id: string; name: string; kind: string; media_type: string; duplicate: boolean };
  expect(body).toMatchObject({ name: "Lake day.png", kind: "image", media_type: "image/jpeg", duplicate: false });
  const row = db.select().from(attachments).where(eq(attachments.id, body.id)).get()!;
  expect(row.retention).toBe("kept");
  expect(row.conversationId).toBeNull();
  expect(row.provenance).toBe("library:upload");
  const listed = (await (await sage.get("/api/library")).json()) as { items: Array<{ id: string; name: string; retention: string }> };
  expect(listed.items).toEqual([expect.objectContaining({ id: body.id, name: "Lake day.png", retention: "kept" })]);
  const again = (await (await send(sage, "copy.png", await png(), "image/png")).json()) as { id: string; duplicate: boolean };
  expect(again).toMatchObject({ id: body.id, duplicate: true });
  expect(db.select().from(attachments).all()).toHaveLength(1);
});

test("the type comes from the bytes: text by extension, a document, and refusals with a next step", async () => {
  const { sage } = await login();
  const text = await send(sage, "notes.txt", "plain words here", "application/x-evil");
  expect(text.status).toBe(201);
  expect(((await text.json()) as { kind: string; media_type: string })).toMatchObject({ kind: "document", media_type: "text/plain" });
  const fake = await send(sage, "notes.png", "this is not a picture", "image/png");
  expect(fake.status).toBe(400);
  expect(((await fake.json()) as { error: string }).error).toBe("That file type is not supported. Use a picture, video, song or document.");
  const program = await send(sage, "run.sh", "#!/bin/sh\nrm -rf /\n", "text/plain");
  expect(program.status).toBe(400);
  const binary = await send(sage, "data.txt", new Uint8Array([1, 2, 0, 3]), "text/plain");
  expect(binary.status).toBe(400);
  expect((await send(sage, "empty.txt", "", "text/plain")).status).toBe(400);
  expect((await sage.postForm("/api/library/upload", new FormData())).status).toBe(400);
  expect(db.select().from(attachments).all()).toHaveLength(1);
});

test("a full Library refuses before anything is stored; a child asks a grown-up", async () => {
  const { sage, teen, child } = await login();
  setHouseholdSettingValue("storage.household.cap_bytes", 10);
  const full = await send(sage, "big.txt", "this text is longer than ten bytes", "text/plain");
  expect(full.status).toBe(403);
  expect(((await full.json()) as { error: string }).error).toContain("Your storage is full");
  expect(db.select().from(attachments).all()).toHaveLength(0);
  setHouseholdSettingValue("storage.household.cap_bytes", 0);
  const refused = await send(child, "mine.txt", "hello", "text/plain");
  expect(refused.status).toBe(403);
  expect(((await refused.json()) as { error: string }).error).toContain("Ask a grown-up");
  expect(db.select().from(attachments).all()).toHaveLength(0);
  expect((await send(teen, "teen.txt", "hello", "text/plain")).status).toBe(201);
  expect((await new TestClient().postForm("/api/library/upload", new FormData())).status).toBe(401);
});

test("the same file again is accepted when storage is full, because it needs no more room", async () => {
  const { sage } = await login();
  expect((await send(sage, "a.txt", "hello", "text/plain")).status).toBe(201);
  setHouseholdSettingValue("storage.household.cap_bytes", 5);
  const again = await send(sage, "b.txt", "hello", "text/plain");
  expect(again.status).toBe(201);
  expect(((await again.json()) as { duplicate: boolean }).duplicate).toBe(true);
  expect((await send(sage, "c.txt", "hello world", "text/plain")).status).toBe(403);
});

import { libraryMultipart } from "@/lib/libraryMultipart";
async function multipartBytes(content: Uint8Array, chunk: number, header = 'Content-Disposition: form-data; name="file"; filename="notes.txt"', tail = "\r\n--abc--\r\n") {
  const wire = Buffer.concat([Buffer.from(`--abc\r\n${header}\r\n\r\n`), content, Buffer.from(tail)]);
  let offset = 0;
  const request = new Request("http://localhost/upload", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=abc" }, body: new ReadableStream<Uint8Array>({ pull(c) { if (offset === wire.length) c.close(); else { c.enqueue(wire.subarray(offset, offset + chunk)); offset = Math.min(wire.length, offset + chunk); } } }) });
  const parsed = await libraryMultipart(request);
  return new Uint8Array(await new Response(parsed.body).arrayBuffer());
}
for (const chunk of [1, 2, 3, 7, 13, 65536]) test(`multipart preserves complete boundary lookalikes at chunk size ${chunk}`, async () => {
  const content = Buffer.concat([Buffer.from("hello\r\n--abc--NOT_A_DELIMITER\r\nworld\r\n--abcX\r\n--abc-\r\n--abc\rX"), Buffer.from([0, 255, 128, 13, 10]), Buffer.from("--abc--no\r\nend")]);
  expect(await multipartBytes(content, chunk)).toEqual(new Uint8Array(content));
});
for (const [label, header, tail] of [
  ["missing filename", 'Content-Disposition: form-data; name="file"', "\r\n--abc--\r\n"],
  ["huge header", 'Content-Disposition: form-data; name="file"; filename="notes.txt"; x=' + "x".repeat(9000), "\r\n--abc--\r\n"],
  ["extra part", 'Content-Disposition: form-data; name="file"; filename="notes.txt"', '\r\n--abc\r\nContent-Disposition: form-data; name="other"\r\n\r\nextra\r\n--abc--\r\n'],
  ["nested part", 'Content-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: multipart/mixed; boundary=inner', "\r\n--abc--\r\n"],
]) test(`multipart rejects ${label}`, async () => {
  await expect(multipartBytes(Buffer.from("hello"), 7, header, tail)).rejects.toThrow();
});
