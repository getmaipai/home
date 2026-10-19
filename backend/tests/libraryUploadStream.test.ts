import { afterEach, beforeEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people, fileContents } from "@/db/schema";
import { dataDir } from "@/lib/paths";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setLibraryUploadCapForTests, appendLibraryUpload, beginLibraryUpload } from "@/lib/libraryUploadStream";
import { TestClient } from "./client";
import { app } from "@/app";
import { reserveFreePort } from "./fixtures/reserveFreePort";
import { resetDb } from "./reset-db";

beforeEach(resetDb);
afterEach(() => __setLibraryUploadCapForTests());
const staging = () => readdirSync(dataDir).filter(name => name.startsWith(".library-upload-"));
async function fixture() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).get()!;
  const start = async (name = "notes.txt") => {
    const res = await client.post("/api/library/uploads", { name });
    expect(res.status).toBe(201);
    return (await res.json() as { upload_id: string }).upload_id;
  };
  const put = (id: string, offset: number, body: Uint8Array | ReadableStream<Uint8Array>) => app.request(`/api/library/uploads/${id}?offset=${offset}`, { method: "PUT", headers: { host: "localhost", cookie: client.getCookie()!, "content-type": "application/octet-stream" }, body });
  return { client, actor, start, put };
}
const bytes = (text: string) => new TextEncoder().encode(text);

test("streamed chunks cross a simulated server body limit, then deduplicate at finish even with storage full", async () => {
  const f = await fixture();
  // Requests here stay below a simulated 4-byte per-request ceiling.
  __setLibraryUploadCapForTests(20);
  const first = await f.start();
  for (let offset = 0; offset < 12; offset += 4) expect((await f.put(first, offset, bytes("word"))).status).toBe(200);
  expect(db.select().from(attachments).all()).toHaveLength(0);
  const saved = await f.client.post(`/api/library/uploads/${first}/finish`);
  expect(saved.status).toBe(201);
  const record = await saved.json() as { id: string };
  setHouseholdSettingValue("storage.household.cap_bytes", 12);
  const second = await f.start();
  for (let offset = 0; offset < 12; offset += 4) expect((await f.put(second, offset, bytes("word"))).status).toBe(200);
  const duplicate = await f.client.post(`/api/library/uploads/${second}/finish`);
  expect(await duplicate.json()).toMatchObject({ id: record.id, duplicate: true });
  expect(db.select().from(fileContents).all()).toHaveLength(1);
  expect(staging()).toEqual([]);
});

test("over-cap and over-allowance streams stop immediately, leaving no staging file or record", async () => {
  const f = await fixture(); __setLibraryUploadCapForTests(6);
  const id = await f.start();
  expect((await f.put(id, 0, bytes("hello"))).status).toBe(200);
  expect((await f.put(id, 5, bytes("world"))).status).toBe(413);
  expect(staging()).toEqual([]);
  expect(db.select().from(attachments).all()).toEqual([]);
  setHouseholdSettingValue("storage.person.default_cap_bytes", 2);
  const full = await f.start();
  expect((await f.put(full, 0, bytes("hello"))).status).toBe(403);
  expect(staging()).toEqual([]);
  expect(db.select().from(attachments).all()).toEqual([]);
});

test("an aborted stream removes its partial bytes; explicit cancellation also removes them", async () => {
  const f = await fixture();
  const { upload_id } = await beginLibraryUpload(f.actor, "notes.txt");
  let pulled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(c) { if (pulled) c.error(new Error("aborted")); else { pulled = true; c.enqueue(bytes("hello")); } } });
  await expect(appendLibraryUpload(f.actor, upload_id, stream, 0)).rejects.toThrow("upload stopped");
  expect(staging()).toEqual([]);
  const id = await f.start(); await f.put(id, 0, bytes("hello"));
  expect((await f.client.request(`/api/library/uploads/${id}`, { method: "DELETE" })).status).toBe(200);
  expect(staging()).toEqual([]);
  expect(db.select().from(attachments).all()).toEqual([]);
});

test("sessions are owner-bound, sequential, and recheck the current role on finish", async () => {
  const f = await fixture(); const id = await f.start();
  const other = new TestClient();
  const made = await f.client.post("/api/people", { displayName: "Riff", role: "teen", secret: "0000" });
  const person = await made.json() as { id: string };
  await other.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" });
  expect((await other.post(`/api/library/uploads/${id}/finish`)).status).toBe(404);
  expect((await f.put(id, 1, bytes("hello"))).status).toBe(409);
  expect((await f.put(id, 0, bytes("hello"))).status).toBe(200);
  db.update(people).set({ role: "child" }).where(eq(people.id, f.actor.id)).run();
  expect((await f.client.post(`/api/library/uploads/${id}/finish`)).status).toBe(403);
  expect(staging()).toEqual([]);
});


test("a real Bun body ceiling rejects one large request but accepts the same file in chunks", async () => {
  const f = await fixture(); __setLibraryUploadCapForTests(512);
  const server = Bun.serve({ hostname: "127.0.0.1", port: reserveFreePort(), maxRequestBodySize: 128, fetch: app.fetch });
  const id = await f.start();
  const headers = { cookie: f.client.getCookie()!, "content-type": "application/octet-stream" };
  try {
    const url = `http://localhost:${server.port}/api/library/uploads/${id}`;
    const large = await fetch(`${url}?offset=0`, { method: "PUT", headers, body: "x".repeat(384) });
    expect(large.status).toBe(413);
    for (let offset = 0; offset < 384; offset += 128) {
      const response = await fetch(`${url}?offset=${offset}`, { method: "PUT", headers, body: "x".repeat(128) });
      expect(response.status).toBe(200);
    }
    expect((await f.client.post(`/api/library/uploads/${id}/finish`)).status).toBe(201);
    expect(db.select().from(attachments).get()!.size).toBe(384);
    expect(staging()).toEqual([]);
  } finally { server.stop(true); }
});


test("multipart boundaries can cross stream chunks; a truncated body leaves no staging file or record", async () => {
  const f = await fixture();
  const prefix = '--upload-boundary\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nhello';
  const send = (suffix: string) => {
    const encoded = bytes(prefix + suffix); let offset = 0;
    return app.request("/api/library/upload", {
      method: "POST", headers: { host: "localhost", cookie: f.client.getCookie()!, "content-type": "multipart/form-data; boundary=upload-boundary" },
      body: new ReadableStream<Uint8Array>({ pull(controller) {
        if (offset >= encoded.length) { controller.close(); return; }
        controller.enqueue(encoded.subarray(offset, offset + 3)); offset += 3;
      } }),
    });
  };
  expect((await send("")).status).toBe(400);
  expect(staging()).toEqual([]);
  expect(db.select().from(attachments).all()).toEqual([]);
  expect((await send("\r\n--upload-boundary--\r\n")).status).toBe(201);
  expect(staging()).toEqual([]);
  expect(db.select().from(attachments).all()).toHaveLength(1);
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { attachmentFilePath } from "@/lib/attachments";
import { finishLibraryUpload, cancelLibraryUpload } from "@/lib/libraryUploadStream";
test("traversal names stay inside storage and bytes, hash and size match across UTF-8 chunk edges", async () => {
  const f = await fixture();
  const content = bytes("Lake 🌊 café\r\nhello");
  const id = await f.start("../../outside.txt");
  for (let i = 0; i < content.length; i++) expect((await f.put(id, i, content.subarray(i, i + 1))).status).toBe(200);
  expect((await f.client.post(`/api/library/uploads/${id}/finish`)).status).toBe(201);
  const row = db.select().from(attachments).get()!;
  expect(row.name).not.toMatch(/[\/\\]/);
  expect(readFileSync(attachmentFilePath(row.storagePath))).toEqual(Buffer.from(content));
  expect(row.size).toBe(content.length);
  expect(row.sha256).toBe(createHash("sha256").update(content).digest("hex"));
  expect(staging()).toEqual([]);
});
for (const scenario of ["invalid-utf8", "storage-full", "missing-staging"] as const) test(`finish cleans staging on ${scenario}`, async () => {
  const f = await fixture(); const id = await f.start();
  const content = scenario === "invalid-utf8" ? new Uint8Array([104, 105, 0xe2, 0x82]) : bytes("hello");
  for (let i = 0; i < content.length; i++) await f.put(id, i, content.subarray(i, i + 1));
  if (scenario === "storage-full") setHouseholdSettingValue("storage.household.cap_bytes", 1);
  if (scenario === "missing-staging") {
    const { rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const dir of staging()) rmSync(join(dataDir, dir, "file"));
  }
  const response = await f.client.post(`/api/library/uploads/${id}/finish`);
  expect(response.status).toBe(scenario === "storage-full" ? 403 : 400);
  expect(staging()).toEqual([]);
  expect(db.select().from(attachments).all()).toEqual([]);
});
test("an active stream expiring never succeeds or leaves staging bytes", async () => {
  const f = await fixture(); const { upload_id } = await beginLibraryUpload(f.actor, "notes.txt");
  const original = Date.now; const started = original(); let part = 0;
  try {
    const stream = new ReadableStream<Uint8Array>({ pull(c) {
      if (part++ === 0) c.enqueue(bytes("hello"));
      else { Date.now = () => started + 3600001; c.close(); }
    } });
    await expect(appendLibraryUpload(f.actor, upload_id, stream, 0)).rejects.toThrow("no longer available");
  } finally { Date.now = original; }
  expect(staging()).toEqual([]);
  expect(db.select().from(attachments).all()).toEqual([]);
});
test("simultaneous starts respect the three-session allowance", async () => {
  const f = await fixture();
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => beginLibraryUpload(f.actor, "notes.txt")));
  const started = results.flatMap(r => r.status === "fulfilled" ? [r.value.upload_id] : []);
  expect(started).toHaveLength(3);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(2);
  for (const id of started) await cancelLibraryUpload(f.actor, id);
  expect(staging()).toEqual([]);
});
test("simultaneous finishes recheck the remaining storage allowance", async () => {
  const f = await fixture();
  const first = await f.start(), second = await f.start();
  await f.put(first, 0, bytes("hello")); await f.put(second, 0, bytes("world"));
  setHouseholdSettingValue("storage.household.cap_bytes", 5);
  const results = await Promise.all([finishLibraryUpload(f.actor, first), finishLibraryUpload(f.actor, second)]);
  expect(results.filter(r => r.ok)).toHaveLength(1);
  expect(results.filter(r => !r.ok)).toHaveLength(1);
  expect(db.select().from(attachments).all()).toHaveLength(1);
  expect(staging()).toEqual([]);
});
test("a lazy 128 MB stream has bounded peak resident memory", async () => {
  const f = await fixture(); const { upload_id } = await beginLibraryUpload(f.actor, "notes.txt");
  const total = 128 * 1024 * 1024, chunk = 64 * 1024;
  Bun.gc(true);
  const baseline = process.memoryUsage().rss; let peak = baseline, sent = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(c) {
    peak = Math.max(peak, process.memoryUsage().rss);
    if (sent === total) { c.close(); return; }
    c.enqueue(new Uint8Array(chunk).fill(120)); sent += chunk;
    if (sent % (1024 * 1024) === 0) Bun.gc(true);
  } });
  await appendLibraryUpload(f.actor, upload_id, stream, 0, total);
  peak = Math.max(peak, process.memoryUsage().rss);
  expect(peak - baseline).toBeLessThan(96 * 1024 * 1024);
  await cancelLibraryUpload(f.actor, upload_id);
  expect(staging()).toEqual([]);
});
