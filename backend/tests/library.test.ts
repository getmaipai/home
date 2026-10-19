import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "@/lib/paths";
import { nextHlc } from "@/lib/hlc";
import { canAccessFile } from "@/lib/access";
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
    db.insert(attachments).values({ id: key, ownerPersonId: id, conversationId: null, turnId: null, mediaType, size: n + 1, sha256: createHash("sha256").update(key).digest("hex"), storagePath: `people/${id}/attachments/${key}`, provenance, createdAt: "2026-10-14T12:00:00.000Z", hlc: nextHlc() }).run();
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

async function minorFixture(role: "child" | "teen") {
  const f = await fixture();
  const made = await (await f.client.post("/api/people", { displayName: "Bramble", role, secret: "0000" })).json() as { id: string };
  // The role remains authoritative even with an adult birthdate.
  db.update(people).set({ birthdate: "1980-01-01" }).where(eq(people.id, made.id)).run();
  const reader = new TestClient();
  await reader.post("/api/auth/verify-secret", { personId: made.id, secret: "0000" });
  function share(key: string, to = "household") {
    db.insert(shares).values({ id: `share-${key}-${to}`, fileId: key, fromPersonId: f.id, to, provenance: "fixture", createdAt: "2026-10-14", hlc: "fixture" }).run();
    return key;
  }
  return { ...f, reader, minorId: made.id, share };
}

for (const role of ["child", "teen"] as const) {
  test(`${role} retains a shared all-ages cover of a private unclassified song`, async () => {
    const { id, file, reader, share } = await minorFixture(role);
    const cover = share(file(9, "image/png", 'picture-gen:{"audience":"all-ages","prompt":"Otters"}'));
    const song = file(10, "audio/mp4", 'music-gen:{"job_id":"private-song"}');
    db.insert(musicJobs).values({ id: "private-song", personId: id, state: "done", task: "text2music", request: "{}", fileId: song, coverFileId: cover, createdAt: "2026-10-14", updatedAt: "2026-10-14", hlc: "fixture" }).run();
    expect((await page(reader.get("/api/library"))).items.map(x => x.id)).toEqual([cover]);
    const totals = await summary(reader.get("/api/library/summary"));
    expect(totals.items).toBe(1);
    expect(totals.bytes).toBe(10);
    expect(totals.per_kind.image).toEqual({ items: 1, bytes: 10 });
    const path = join(dataDir, `people/${id}/attachments/${cover}`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "0123456789");
    db.update(attachments).set({ sha256: createHash("sha256").update("0123456789").digest("hex") }).where(eq(attachments.id, cover)).run();
    expect((await reader.get(`/api/files/${cover}`)).status).toBe(200);
    const content = await reader.get(`/api/files/${cover}/content`);
    expect(content.status).toBe(200);
    expect(await content.text()).toBe("0123456789");
    expect((await reader.get(`/api/files/${song}`)).status).toBe(404);
  });

  test(`${role} counts only visible media and never exposes hidden derived ids`, async () => {
    const { file, reader, share, minorId } = await minorFixture(role);
    const safe = '"audience":"all-ages"';
    const hidden = '"audience":"adult-only"';
    const root = share(file(1, "image/png", `picture-gen:{${safe},"prompt":"Visible"}`), minorId);
    const edit = share(file(2, "image/png", `image-edit:{${hidden},"root":"${root}"}`));
    const video = share(file(3, "video/mp4", `video-gen:{${safe},"job":"visible-video"}`));
    const poster = share(file(4, "image/png", `video-poster:{${hidden},"job":"visible-video"}`));
    const privateVideo = file(5, "video/mp4", `video-gen:{${hidden},"job":"hidden-video"}`);
    const orphanPoster = share(file(6, "image/png", `video-poster:{${safe},"job":"hidden-video"}`), minorId);
    const orphanEdit = share(file(7, "image/png", `image-edit:{${safe},"root":"${privateVideo}"}`));
    const rows = (await page(reader.get("/api/library"))).items;
    expect(rows.map(x => x.id).sort()).toEqual([root, video, orphanPoster, orphanEdit].sort());
    expect(rows.find(x => x.id === root)?.version_count).toBe(1);
    expect(rows.find(x => x.id === root)?.thumb_url).toContain(root);
    expect(rows.find(x => x.id === video)?.thumb_url).toContain(video);
    expect(JSON.stringify(rows)).not.toContain(edit);
    expect(JSON.stringify(rows)).not.toContain(poster);
    const totals = await summary(reader.get("/api/library/summary"));
    expect(totals.items).toBe(4);
    expect(totals.bytes).toBe(21);
    expect(totals.per_kind.image).toEqual({ items: 3, bytes: 17 });
    expect(totals.per_kind.video).toEqual({ items: 1, bytes: 4 });
    for (const kind of ["audio", "document", "story", "file"]) expect(totals.per_kind[kind]).toEqual({ items: 0, bytes: 0 });
  });

  test(`${role} provenance and hidden-row pagination preserve the visible set for every sort`, async () => {
    const { file, reader, share, minorId } = await minorFixture(role);
    const notes = [
      'picture-gen:{"audience":"all-ages","prompt":"Needle A"}',
      'picture-gen:{broken', 'picture-gen:{"prompt":"Needle 0"}', 'picture-gen:{"audience":"unknown","prompt":"Needle AB"}',
      'picture-gen:{"nested":{"audience":"all-ages"}}',
      'picture-gen:{"audience":"all-ages","audience":"adult-only","prompt":"Needle BC"}',
      'picture-gen:{"audience":"adult-only","audience":"all-ages","prompt":"Needle B"}',
      'music-gen:{"audience":"all-ages"}', 'composer:upload', 'fetched:{"audience":"all-ages"}',
      'video-gen:{"audience":"all-ages","prompt":"Needle C"}',
      'upload:{"audience":"all-ages"}', 'picture-gen:{"audience":"adult-only"}',
      'image-edit:{"audience":"all-ages","prompt":"Needle D"}',
    ];
    const ids = notes.map((note, n) => share(file(100 + n, n === 10 ? "video/mp4" : "image/png", note), n % 2 ? minorId : "household"));
    const visible = [ids[0]!, ids[6]!, ids[10]!, ids[13]!];
    const fetched = share(file(200, "image/png", 'picture-gen:{"audience":"all-ages"}'));
    db.update(attachments).set({ origin: "fetched" }).where(eq(attachments.id, fetched)).run();
    for (const sort of ["newest", "oldest", "name", "size"]) {
      for (const search of ["", "Needle"]) {
        const query = `/api/library?sort=${sort}&search=${search}`;
        const all = await page(reader.get(query));
        expect(all.items.map(x => x.id).sort()).toEqual([...visible].sort());
        for (const limit of [1, 3]) {
          const seen: string[] = [];
          let next: string | null = null;
          do {
            const result: Page = await page(reader.get(`${query}&limit=${limit}${next ? `&cursor=${next}` : ""}`));
            seen.push(...result.items.map(x => x.id));
            next = result.next_cursor;
            if (next) {
              const decoded = JSON.parse(Buffer.from(next, "base64url").toString()) as { id: string };
              expect(visible).toContain(decoded.id);
              expect(decoded.id).toBe(result.items.at(-1)!.id);
            }
            expect(seen.length).toBeLessThanOrEqual(visible.length);
          } while (next);
          expect(seen).toEqual(all.items.map(x => x.id));
        }
        const totals = await summary(reader.get(`/api/library/summary?sort=${sort}&search=${search}`));
        expect(totals.items).toBe(4);
        expect(totals.bytes).toBe(433);
        expect(totals.per_kind.image).toEqual({ items: 3, bytes: 322 });
        expect(totals.per_kind.video).toEqual({ items: 1, bytes: 111 });
      }
    }
    const actor = db.select().from(people).where(eq(people.id, minorId)).get()!;
    expect(canAccessFile(actor, minorId, visible[0]!)).toBe(false);
    expect(canAccessFile(actor, minorId, "file-ffffffffffffffff")).toBe(false);
    for (const hidden of [...ids.filter(id => !visible.includes(id)), fetched, "file-ffffffffffffffff"]) expect((await reader.get(`/api/files/${hidden}`)).status).toBe(404);
  });
}

for (const role of ["child", "teen"] as const) {
  for (const parentSafe of [false, true]) for (const derivedSafe of [false, true]) {
    test(`${role} folds only visible video posters and image edits (${parentSafe}, ${derivedSafe})`, async () => {
      const { file, reader, share } = await minorFixture(role);
      const audience = (safe: boolean) => safe ? "all-ages" : "adult-only";
      const root = share(file(1, "image/png", `picture-gen:{"audience":"${audience(parentSafe)}"}`));
      const edit = share(file(2, "image/png", `image-edit:{"audience":"${audience(derivedSafe)}","root":"${root}"}`));
      const video = share(file(3, "video/mp4", `video-gen:{"audience":"${audience(parentSafe)}","job":"clip"}`));
      const poster = share(file(4, "image/png", `video-poster:{"audience":"${audience(derivedSafe)}","job":"clip"}`));
      const rows = (await page(reader.get("/api/library"))).items;
      expect(rows.map(x => x.id).sort()).toEqual((parentSafe ? [root, video] : derivedSafe ? [edit, poster] : []).sort());
      if (parentSafe) {
        expect(rows.find(x => x.id === root)?.version_count).toBe(derivedSafe ? 2 : 1);
        expect(rows.find(x => x.id === root)?.thumb_url).toBe(`/api/files/${derivedSafe ? edit : root}/thumb?w=320`);
        expect(rows.find(x => x.id === video)?.thumb_url).toBe(`/api/files/${derivedSafe ? poster : video}/thumb?w=320`);
      }
      const totals = await summary(reader.get("/api/library/summary"));
      expect(totals.items).toBe(rows.length);
      expect(totals.bytes).toBe((parentSafe ? 6 : 0) + (derivedSafe ? 8 : 0));
      expect(totals.per_kind.image).toEqual({ items: parentSafe ? 1 : derivedSafe ? 2 : 0, bytes: (parentSafe ? 2 : 0) + (derivedSafe ? 8 : 0) });
      expect(totals.per_kind.video).toEqual({ items: parentSafe ? 1 : 0, bytes: parentSafe ? 4 : 0 });
    });
  }
}

test("Only me excludes every share target and includes a file again after unsharing", async () => {
  const { client, id, file } = await fixture();
  const person = await (await client.post("/api/people", { displayName: "Clover", role: "adult", secret: "0000" })).json() as { id: string };
  const privateFile = file(1);
  const household = file(2);
  const direct = file(3);
  const unshared = file(4, "application/pdf");
  for (const [key, to] of [[household, "household"], [direct, person.id], [unshared, "household"]]) {
    db.insert(shares).values({ id: `only-${key}`, fileId: key!, fromPersonId: id, to: to!, provenance: "fixture", createdAt: "2026-10-14", hlc: "fixture" }).run();
  }
  expect((await page(client.get("/api/library?shared=none"))).items.map(row => row.id)).toEqual([privateFile]);
  expect((await client.request(`/api/shares/only-${unshared}`, { method: "DELETE" })).status).toBe(200);
  const rows = (await page(client.get("/api/library?shared=none"))).items;
  expect(rows.map(row => row.id)).toEqual([unshared, privateFile]);
  const totals = await summary(client.get("/api/library/summary?shared=none"));
  expect(totals.items).toBe(rows.length);
  expect(totals.bytes).toBe(rows.reduce((n, row) => n + row.size_bytes, 0));
  for (const kind of ["image", "document"]) {
    const matching = rows.filter(row => row.kind === kind);
    expect(totals.per_kind[kind]).toEqual({ items: matching.length, bytes: matching.reduce((n, row) => n + row.size_bytes, 0) });
  }
  const reader = new TestClient();
  await reader.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" });
  for (const filter of ["", "?shared=none", "?shared=by-me", "?shared=with-me", `?owner=${id}`, `?owner=${id}&shared=none`]) {
    const visible = (await page(reader.get(`/api/library${filter}`))).items;
    expect(visible.map(row => row.id)).not.toContain(privateFile);
    expect(visible.map(row => row.id)).not.toContain(unshared);
    const totals = await summary(reader.get(`/api/library/summary${filter}`));
    expect(totals.items).toBe(visible.length);
    expect(totals.bytes).toBe(visible.reduce((n, row) => n + row.size_bytes, 0));
  }
});

for (const sort of ["newest", "oldest", "name", "size"] as const) test(`Only me ${sort} pages filter before the limit`, async () => {
  const { client, id, file } = await fixture();
  const expected: string[] = [];
  for (let n = 0; n < 9; n++) {
    const key = file(n);
    if (n % 2 === 0) expected.push(key);
    else db.insert(shares).values({ id: `page-${n}`, fileId: key, fromPersonId: id, to: "household", provenance: "fixture", createdAt: "2026-10-14", hlc: "fixture" }).run();
  }
  const query = `/api/library?shared=none&sort=${sort}&limit=2`;
  const first = await page(client.get(query));
  expect(first.items).toHaveLength(2);
  const second = await page(client.get(`${query}&cursor=${first.next_cursor}`));
  expect(second.items).toHaveLength(2);
  const third = await page(client.get(`${query}&cursor=${second.next_cursor}`));
  expect(third.items).toHaveLength(1);
  expect(third.next_cursor).toBeNull();
  expect([...first.items, ...second.items, ...third.items].map(row => row.id).sort()).toEqual(expected.sort());
  expect((await client.get(`/api/library?shared=by-me&sort=${sort}&cursor=${first.next_cursor}`)).status).toBe(400);
});

for (const role of ["child", "teen"] as const) test(`Only me keeps ${role} ownership and the existing audience rule`, async () => {
  const { file, reader, minorId, share } = await minorFixture(role);
  const owned = [file(1, "image/png", 'picture-gen:{"audience":"all-ages"}'), file(2, "image/png", 'picture-gen:{"audience":"adult-only"}'), file(3)];
  const ownedShared = share(file(4));
  for (const key of [...owned, ownedShared]) db.update(attachments).set({ ownerPersonId: minorId }).where(eq(attachments.id, key)).run();
  share(file(5, "image/png", 'picture-gen:{"audience":"all-ages"}'));
  share(file(6, "image/png", 'picture-gen:{"audience":"adult-only"}'));
  file(7);
  const rows = (await page(reader.get("/api/library?shared=none"))).items;
  // Ownership passes the existing audience predicate, even for unclassified or adult-only rows.
  expect(rows.map(row => row.id).sort()).toEqual(owned.sort());
  const totals = await summary(reader.get("/api/library/summary?shared=none"));
  expect(totals.items).toBe(3);
  expect(totals.bytes).toBe(9);
  expect(totals.per_kind.image).toEqual({ items: 3, bytes: 9 });
});

for (const path of ["/api/library", "/api/library/summary"]) test(`${path} rejects unknown sharing filters with plain allowed values`, async () => {
  const { client } = await fixture();
  for (const value of ["unknown", ""]) {
    const response = await client.get(`${path}?shared=${value}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid shared filter. Choose with-me, by-me, or none." });
  }
});
