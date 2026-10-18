import { beforeEach, expect, test } from "bun:test";
import { db } from "@/db";
import { attachments, people, shares, pictureJobs, videoJobs, musicJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { personUsageByKind } from "@/lib/storage/usage";

import type { listLibrary, librarySummary } from "@/lib/library";
type Page = ReturnType<typeof listLibrary>;
type Summary = ReturnType<typeof librarySummary>;
async function page(response: Promise<Response>): Promise<Page> { return await (await response).json() as Page; }
async function summary(response: Promise<Response>): Promise<Summary> { return await (await response).json() as Summary; }
beforeEach(resetDb);
async function fixture() {
  const client = new TestClient();
  const result = await (await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).json() as { person: { id: string } };
  const id = result.person.id;
  function file(n: number, mediaType = "image/png", provenance = "composer:upload") {
    const key = `file-${n.toString(16).padStart(16, "0")}`;
    db.insert(attachments).values({ id: key, ownerPersonId: id, conversationId: null, turnId: null, mediaType, size: n + 1, sha256: "a".repeat(64), storagePath: `people/${id}/attachments/${key}`, provenance, createdAt: "2026-10-14T12:00:00.000Z", hlc: "fixture" }).run();
    return key;
  }
  return { client, id, file };
}
test("listing limits and keyset cursor survive inserts with equal timestamps", async () => {
  const { client, file } = await fixture();
  for (let n = 0; n < 65; n++) file(n);
  const first = await page(client.get("/api/library"));
  expect(first.items).toHaveLength(60);
  file(100);
  const second = await page(client.get(`/api/library?cursor=${first.next_cursor}`));
  expect(second.items).toHaveLength(5);
  expect(second.next_cursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map(x => x.id)).size).toBe(65);
  expect((await client.get("/api/library?cursor=broken")).status).toBe(400);
  expect((await client.get("/api/library?limit=61")).status).toBe(400);
});
test("derived metadata, escaped search, filters, sorts and physical per-kind bytes", async () => {
  const { client, id, file } = await fixture();
  file(1, "application/pdf");
  file(2, "video/mp4", 'video-gen:{"job":"clip","prompt":"Boat 100%_","seconds":8}');
  file(3, "image/jpeg", 'video-poster:{"job":"clip"}');
  const root = file(4, "image/png", 'picture-gen:{"prompt":"Otters"}');
  file(5, "image/png", `image-edit:${JSON.stringify({ root, label: "Crop" })}`);
  file(6, "audio/mp4", 'music-gen:{"title":"River","duration_seconds":42}');
  file(7, "application/octet-stream");
  file(8, "text/plain");
  const rows = await page(client.get("/api/library?sort=name"));
  expect(rows.items).toHaveLength(6);
  expect((await page(client.get("/api/library?type=file"))).items).toHaveLength(1);
  expect((await page(client.get("/api/library?type=document"))).items).toHaveLength(2);
  expect((await page(client.get("/api/library?type=story"))).items).toHaveLength(0);
  expect(rows.items.map(x => x.name)).toContain("River");
  expect(JSON.stringify(rows)).not.toMatch(/storage_path|sha256/);
  const video = (await page(client.get("/api/library?search=100%25_&type=video"))).items[0]!;
  expect(video.duration_seconds).toBe(8);
  expect(video.thumb_url).toContain("/thumb?w=320");
  expect((await page(client.get("/api/library?search=%25%25"))).items).toHaveLength(0);
  const totals = await summary(client.get("/api/library/summary"));
  expect(totals.items).toBe(6);
  expect(totals.bytes).toBe(44);
  for (const entry of personUsageByKind(id)) expect(totals.per_kind[entry.kind === "other" ? "file" : entry.kind]!.bytes).toBe(entry.bytes);
  expect(totals.trash.items).toBe(0);
  expect(totals.expiring.items).toBe(0);
});
for (const role of ["child", "teen"] as const) test(`${role} sees only classified shared rows and always owns their rows`, async () => {
  const { client, id, file } = await fixture();
  const made = await (await client.post("/api/people", { displayName: "Bramble", role, secret: "0000" })).json() as { id: string };
  const reader = new TestClient();
  await reader.post("/api/auth/verify-secret", { personId: made.id, secret: "0000" });
  const safe = file(1, "image/png", 'picture-gen:{"audience":"all-ages"}');
  const adult = file(2, "image/png", 'picture-gen:{"audience":"adult-only"}');
  const unknown = file(3);
  for (const [n, key] of [safe, adult, unknown].entries()) db.insert(shares).values({ id: `share-${n}`, fileId: key, fromPersonId: id, to: "household", provenance: "fixture", createdAt: "2026-10-14", hlc: "fixture" }).run();
  expect((await page(reader.get("/api/library"))).items.map(x => x.id)).toEqual([safe]);
  expect((await summary(reader.get("/api/library/summary"))).items).toBe(1);
  db.update(attachments).set({ ownerPersonId: made.id }).where(eq(attachments.id, unknown)).run();
  expect((await page(reader.get("/api/library?owner=me"))).items.map(x => x.id)).toEqual([unknown]);
  expect(db.select().from(people).where(eq(people.id, made.id)).get()).toBeDefined();
});

test("job prompts, song titles and covers use the shipped writer relations", async () => {
  const { client, id, file } = await fixture();
  const picture = file(10,"image/png",'picture-gen:{"job":"picture-fixture","audience":"all-ages"}');
  const video = file(11,"video/mp4",'video-gen:{"job":"video-fixture","audience":"all-ages"}');
  const poster = file(12,"image/jpeg",'video-poster:{"job":"video-fixture","audience":"all-ages"}');
  const audio = file(13,"audio/mp4",'music-gen:{"job_id":"music-fixture"}');
  const cover = file(14,"image/png",'picture-gen:{"job":"cover-fixture"}');
  const clock = "2026-10-14T12:00:00.000Z";
  const job = { personId: id, kind: "generate", state: "done", request: "{}", createdAt: clock, updatedAt: clock, hlc: "fixture" };
  db.insert(pictureJobs).values({ ...job,id:"picture-fixture",prompt:"Otters on a boat" }).run();
  db.insert(videoJobs).values({ ...job,id:"video-fixture",prompt:"A river",request:'{"seconds":9}' }).run();
  db.insert(musicJobs).values({ ...job,id:"music-fixture",task:"text2music",fileId:audio,coverFileId:cover,durationS:42,request:'{"title":"River song"}' }).run();
  const rows = (await page(client.get("/api/library"))).items;
  expect(rows).toHaveLength(3);
  expect(rows.find(row=>row.id===picture)?.name).toBe("Otters on a boat");
  expect(rows.find(row=>row.id===video)?.thumb_url).toBe(`/api/files/${poster}/thumb?w=320`);
  expect(rows.find(row=>row.id===video)?.duration_seconds).toBe(9);
  expect(rows.find(row=>row.id===audio)?.name).toBe("River song");
  expect(rows.find(row=>row.id===audio)?.thumb_url).toBe(`/api/files/${cover}/thumb?w=320`);
  expect(rows.find(row=>row.id===audio)?.duration_seconds).toBe(42);
  expect((await page(client.get("/api/library?search=OTTERS"))).items.map(row=>row.id)).toEqual([picture]);
  expect((await page(client.get("/api/library?sort=size&limit=1"))).items[0]?.id).toBe(audio);
  expect((await page(client.get("/api/library?sort=oldest&limit=1"))).items[0]?.id).toBe(picture);
  expect((await client.get("/api/library?type=invalid")).status).toBe(400);
  expect((await new TestClient().get("/api/library")).status).toBe(401);
});

test("owner and sharing filters count targets once and keep departed files under household", async () => {
  const { client, id, file } = await fixture();
  const made = await (await client.post("/api/people", { displayName: "Clover", role: "adult", secret: "0000" })).json() as { id: string };
  const shared = file(20);
  const inherited = file(21);
  file(22);
  db.update(attachments).set({ ownerPersonId: made.id }).where(eq(attachments.id,inherited)).run();
  for (const [n,to] of [made.id,"household"].entries()) db.insert(shares).values({id:`share-filter-${n}`,fileId:shared,fromPersonId:id,to,provenance:"fixture",createdAt:"2026-10-14",hlc:"fixture"}).run();
  db.insert(shares).values({id:"share-inherited",fileId:inherited,fromPersonId:made.id,to:"household",provenance:"fixture",createdAt:"2026-10-14",hlc:"fixture"}).run();
  const mine = await page(client.get("/api/library?shared=by-me"));
  expect(mine.items.map(row=>row.id)).toEqual([shared]);
  expect(mine.items[0]?.shared_with).toEqual({count:2,household:true});
  expect((await page(client.get("/api/library?shared=with-me"))).items.map(row=>row.id)).toEqual([inherited]);
  expect((await page(client.get(`/api/library?owner=${made.id}`))).items.map(row=>row.id)).toEqual([inherited]);
  db.update(people).set({deletedAt:"2026-10-18T00:00:00.000Z"}).where(eq(people.id,made.id)).run();
  expect((await page(client.get("/api/library?owner=household"))).items.map(row=>row.id)).toEqual([inherited]);
  expect((await page(client.get("/api/library?owner=me"))).items).toHaveLength(2);
  const edited = file(23,"image/png",`image-edit:${JSON.stringify({root:inherited})}`);
  expect((await page(client.get("/api/library?owner=me"))).items.map(row=>row.id)).toContain(edited);
});

for (const sort of ["newest","oldest","name","size"] as const) test(`${sort} pagination has no gaps and rejects a different filter`, async () => {
  const { client,file } = await fixture();
  const ids = [file(1),file(2),file(3),file(4)];
  const first = await page(client.get(`/api/library?sort=${sort}&limit=2`));
  const second = await page(client.get(`/api/library?sort=${sort}&limit=2&cursor=${first.next_cursor}`));
  expect([...first.items,...second.items].map(row=>row.id).sort()).toEqual(ids.sort());
  expect(second.next_cursor).toBeNull();
  expect((await client.get(`/api/library?sort=${sort}&type=image&cursor=${first.next_cursor}`)).status).toBe(400);
});

test("fetched rows preserve owner access and require both an admin and a share for listing", async () => {
  const { client,id,file } = await fixture();
  const shared = file(30);
  const privateFile = file(31);
  db.update(attachments).set({origin:"fetched"}).where(eq(attachments.id,shared)).run();
  db.update(attachments).set({origin:"fetched"}).where(eq(attachments.id,privateFile)).run();
  db.insert(shares).values({id:"share-fetched",fileId:shared,fromPersonId:id,to:"household",provenance:"fixture",createdAt:"2026-10-14",hlc:"fixture"}).run();
  expect((await page(client.get("/api/library"))).items).toHaveLength(2);
  for (const role of ["adult","admin"] as const) {
    const person = await (await client.post("/api/people",{displayName:role === "adult" ? "Clover" : "Quill",role,secret:role === "admin" ? "correcthorse" : "0000"})).json() as {id:string};
    const reader = new TestClient();
    await reader.post("/api/auth/verify-secret",{personId:person.id,secret:role === "admin" ? "correcthorse" : "0000"});
    expect((await page(reader.get("/api/library"))).items.map(row=>row.id)).toEqual(role === "admin" ? [shared] : []);
  }
});
