import { beforeEach, expect, test, spyOn } from "bun:test";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { db } from "@/db";
import { attachments, shares, musicJobs } from "@/db/schema";
import { dataDir } from "@/lib/paths";
import { nextHlc } from "@/lib/hlc";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => { resetDb(); rmSync(join(dataDir, "thumbs"), { recursive: true, force: true }); });
async function fixture() {
  const client = new TestClient();
  const { person } = await (await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).json() as { person: { id: string } };
  let n = 0;
  const bytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "green" } }).png().toBuffer();
  function file(mediaType = "image/png", provenance = "composer:upload", input = bytes) {
    const id = `file-${(++n).toString(16).padStart(16,"0")}`;
    const sha256 = createHash("sha256").update(input).digest("hex");
    const storagePath = `people/${person.id}/attachments/${id}`;
    mkdirSync(dirname(join(dataDir,storagePath)), { recursive: true }); writeFileSync(join(dataDir,storagePath),input);
    db.insert(attachments).values({ id, ownerPersonId: person.id, mediaType, provenance, size: input.length, sha256, storagePath, createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
    return { id, sha256 };
  }
  function share(id: string, to = "household") { db.insert(shares).values({ id: `share-${n}-${to}-${id}`, fileId: id, fromPersonId: person.id, to, provenance: "fixture", createdAt: new Date().toISOString(), hlc: nextHlc() }).run(); }
  async function reader(role: "adult" | "teen" | "child") {
    const { id } = await (await client.post("/api/people", { displayName: "Bramble", role, secret: "0000" })).json() as { id: string };
    const other = new TestClient(); await other.post("/api/auth/verify-secret", { personId: id, secret: "0000" }); return other;
  }
  return { client, person, file, share, reader };
}
test("owner gets bounded webp, cache is reused, ETag revalidates and invalid widths are plain", async () => {
  const f = await fixture(); const image = f.file();
  const encode = spyOn(sharp.prototype, "webp");
  try {
    for (const w of [320,640]) {
      const url = `/api/files/${image.id}/thumb?w=${w}`;
      const res = await f.client.get(url); expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("cache-control")).toBe("private, no-cache");
      expect(res.headers.get("etag")).toBe(`"${image.sha256}-${w}"`);
      expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(w);
      const calls = encode.mock.calls.length;
      expect((await f.client.get(url)).status).toBe(200); expect(encode.mock.calls.length).toBe(calls);
      const cached = await f.client.get(url, { "If-None-Match": `"${image.sha256}-${w}"` });
      expect(cached.status).toBe(304); expect(await cached.text()).toBe("");
    }
    for (const w of ["", "1", "0320", "no", "320.0"]) { const res = await f.client.get(`/api/files/${image.id}/thumb?w=${w}`); expect(res.status).toBe(400); expect(await res.text()).toBe("Use w=320 or w=640."); }
  } finally { encode.mockRestore(); }
});
for (const role of ["child","teen"] as const) test(`${role} hidden pictures match missing and never create cache`, async () => {
  const f = await fixture(); const reader = await f.reader(role);
  for (const provenance of ['picture-gen:{"audience":"adult-only"}', 'composer:upload']) {
    const image = f.file("image/png",provenance); f.share(image.id);
    const res = await reader.get(`/api/files/${image.id}/thumb?w=320`, { "If-None-Match": `"${image.sha256}-320"` });
    expect(res.status).toBe(404); expect(await res.text()).toBe(await (await reader.get("/api/files/file-missing/thumb?w=320")).text());
    expect(existsSync(join(dataDir,"thumbs",`${image.sha256}-320.webp`))).toBe(false);
  }
  const safe = f.file("image/png",'picture-gen:{"audience":"all-ages"}'); f.share(safe.id);
  expect((await reader.get(`/api/files/${safe.id}/thumb?w=320`)).status).toBe(200);
});
test("revoked shares are refused even with a matching ETag and warm cache", async () => {
  const f = await fixture(); const reader = await f.reader("adult"); const image = f.file(); f.share(image.id);
  const url = `/api/files/${image.id}/thumb?w=320`; const res = await reader.get(url); expect(res.status).toBe(200);
  db.delete(shares).where(eq(shares.fileId,image.id)).run();
  expect((await reader.get(url,{ "If-None-Match": res.headers.get("etag")! })).status).toBe(404);
});
test("video posters and accessible song covers are used; absent or inaccessible previews fall back", async () => {
  const f = await fixture(); const poster = f.file("image/png",'video-poster:{"job":"clip"}');
  const video = f.file("video/mp4",'video-gen:{"job":"clip"}');
  expect((await f.client.get(`/api/files/${video.id}/thumb?w=320`)).status).toBe(200);
  const audio = f.file("audio/mp4",'music-gen:{"job_id":"song"}');
  db.insert(musicJobs).values({ id:"song",personId:f.person.id,task:"text2music",state:"done",request:"{}",fileId:audio.id,coverFileId:poster.id,createdAt:"2026-10-18",updatedAt:"2026-10-18",hlc:nextHlc() }).run();
  expect((await f.client.get(`/api/files/${audio.id}/thumb?w=320`)).status).toBe(200);
  const reader = await f.reader("adult"); f.share(audio.id); f.share(video.id);
  for (const id of [audio.id,video.id]) { const res = await reader.get(`/api/files/${id}/thumb?w=320`); expect(res.status).toBe(404); expect(await res.text()).toBe("no preview"); }
  for (const type of ["video/mp4","audio/mp4","application/pdf"]) { const item = f.file(type); const res = await f.client.get(`/api/files/${item.id}/thumb?w=320`); expect(res.status).toBe(404); expect(await res.text()).toBe("no preview"); }
});

test("Storage reports and clears previews for admins only", async () => {
  const f = await fixture(); const image = f.file();
  await f.client.get(`/api/files/${image.id}/thumb?w=320`);
  const stats = await (await f.client.get("/api/storage/previews")).json() as { removed: number; bytes: number };
  expect(stats.removed).toBe(1); expect(stats.bytes).toBeGreaterThan(0);
  const reader = await f.reader("adult");
  expect((await reader.request("/api/storage/previews", { method:"DELETE" })).status).toBe(403);
  expect((await f.client.request("/api/storage/previews", { method:"DELETE" })).status).toBe(200);
  expect(existsSync(join(dataDir,"thumbs",`${image.sha256}-320.webp`))).toBe(false);
  expect((await f.client.get(`/api/files/${image.id}/thumb?w=320`)).status).toBe(200);
});
test("corrupt images and oversized stored inputs return no preview without a cache file", async () => {
  const f = await fixture();
  const image = f.file("image/png","composer:upload",Buffer.from("invalid image"));
  const response = await f.client.get(`/api/files/${image.id}/thumb?w=320`);
  expect(response.status).toBe(404); expect(await response.text()).toBe("no preview");
  expect(existsSync(join(dataDir,"thumbs",`${image.sha256}-320.webp`))).toBe(false);
  db.update(attachments).set({ size: 1024 * 1024 * 1024 }).where(eq(attachments.id,image.id)).run();
  expect((await f.client.get(`/api/files/${image.id}/thumb?w=320`)).status).toBe(404);
});
