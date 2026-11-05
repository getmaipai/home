// ADULT-LOCK-07 slice 1: picture provenance enters the existing file-level lock.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { attachments, mediaItems, people } from "@/db/schema";
import { __resetAdultLockForTests, lockItemOfProvenance, lockState } from "@/lib/adultLock";
import { scanRoot } from "@/lib/media/scan";
import { buildMediaTree } from "./support/mediaTree";
import { household, textOf, unlock, unlockHeader } from "./fixtures/adultLock";
import { makeImageEdit, makePicture } from "./fixtures/adultLockPicture";
import type { PersonRow } from "@/types";

beforeEach(() => { resetDb(); __resetAdultLockForTests(); });
afterEach(() => __resetAdultLockForTests());

type Row = Record<string, any>;
const list = (client: TestClient) => client.get("/api/library");

describe("stored pictures obey the Adult lock", () => {
  test("adult-only picture and its image-edit child are omitted or 404 until the owner proves; all-ages remains open", async () => {
    const h = await household();
    const actor = h.row("Marlow");
    const adultPicture = await makePicture(actor, "adult-only", "Zebraquill picture secret");
    const editedPicture = await makeImageEdit(actor, adultPicture, "Zebraquill edited secret");
    const plain = await makePicture(actor, "all-ages", "Paper boat picture");

    const library = await (await list(h.adult.client)).json() as { items: Row[] };
    expect(library.items.map((item) => item.id)).toContain(plain.id);
    expect(library.items.map((item) => item.id)).not.toContain(adultPicture.id);
    expect(library.items.map((item) => item.id)).not.toContain(editedPicture.id);
    const adultStored = db.select().from(attachments).where(eq(attachments.id, adultPicture.id)).get()!;
    const editedStored = db.select().from(attachments).where(eq(attachments.id, editedPicture.id)).get()!;
    const secrets = [adultPicture.id, editedPicture.id, adultStored.sha256, editedStored.sha256, adultPicture.label, editedPicture.label];
    expect(JSON.stringify(library)).not.toContain(adultStored.sha256);
    expect(JSON.stringify(library)).not.toContain(editedStored.sha256);
    for (const path of ["/api/library?search=Zebraquill", "/api/search?q=Zebraquill"]) {
      const text = await textOf(await h.adult.client.get(path));
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
    const summary = await (await h.adult.client.get("/api/library/summary?type=image")).json() as { per_kind: { image: { items: number } } };
    expect(summary.per_kind.image.items).toBe(1);

    const tree = buildMediaTree();
    const source = await h.owner.post("/api/media/sources", { label: "music", path: tree.music, kinds: ["track"] });
    const sourceId = ((await source.json()) as { source: { id: string } }).source.id;
    await scanRoot(sourceId, { prober: null, pruneGraceMs: 0 });
    const track = db.select().from(mediaItems).where(eq(mediaItems.kind, "track")).get()!;
    const refusedEdit = await h.owner.post("/api/plugins/music/actions/edit", { id: track.id, artwork: adultPicture.id });
    expect(refusedEdit.status).toBe(400);
    const refusedText = await refusedEdit.text();
    expect(refusedText).not.toContain(adultPicture.id);
    expect(refusedText).not.toContain(adultPicture.label);
    expect(refusedText).not.toContain(adultStored.sha256);

    for (const item of [adultPicture, editedPicture]) {
      const paths: Array<[string, string]> = [
        [`/api/files/${item.id}`, "/api/files/file-missing-picture"],
        [`/api/files/${item.id}/content`, "/api/files/file-missing-picture/content"],
        [`/api/files/${item.id}/thumb?w=320`, "/api/files/file-missing-picture/thumb?w=320"],
      ];
      if (item.id === adultPicture.id) paths.push([`/api/attachments/${item.id}?v=full&conversation_id=${adultPicture.conversationId}`, "/api/attachments/file-missing-picture?v=full"]);
      for (const [path, missingPath] of paths) {
        const response = await h.adult.client.get(path);
        const missing = await h.adult.client.get(missingPath);
        expect(response.status).toBe(404);
        expect(await response.text()).toBe(await missing.text());
        const text = await textOf(await h.adult.client.get(path));
        for (const secret of secrets) expect(text).not.toContain(secret);
      }
      const refused = [
        await h.adult.client.post(`/api/files/${item.id}/shares`, { to: h.other.id }),
        await h.adult.client.request(`/api/files/${item.id}`, { method: "DELETE" }),
        await h.adult.client.request(`/api/files/${item.id}`, { method: "PATCH", body: { name: "leaked" } }),
      ];
      for (const response of refused) {
        expect(response.status).toBe(404);
        const text = await textOf(response);
        for (const secret of secrets) expect(text).not.toContain(secret);
      }
    }

    const proof = unlockHeader(await unlock(h.adult.client));
    for (const item of [adultPicture, editedPicture]) {
      expect((await h.adult.client.get(`/api/files/${item.id}/content`, proof)).status).toBe(200);
      expect((await h.adult.client.get(`/api/files/${item.id}/thumb?w=320`, proof)).status).toBe(200);
      expect((await h.adult.client.get(`/api/files/${item.id}`, proof)).status).toBe(200);
    }
    expect((await h.adult.client.get(`/api/attachments/${adultPicture.id}?v=full&conversation_id=${adultPicture.conversationId}`, proof)).status).toBe(200);
    const ownerProof = unlockHeader(await unlock(h.owner, "correcthorse"));
    expect((await h.owner.post("/api/plugins/music/actions/edit", { id: track.id, artwork: adultPicture.id }, ownerProof)).status).toBe(200);
    expect((await h.adult.client.get(`/api/files/${plain.id}/content`)).status).toBe(200);
    expect((await h.adult.client.get(`/api/files/${plain.id}/thumb?w=320`)).status).toBe(200);
  });

  test("age gates still hide adult-only pictures from teens, children and guests, including after the lock is cleared", async () => {
    const h = await household();
    const actor = h.row("Marlow");
    const picture = await makePicture(actor, "adult-only", "Zebraquill minor secret");
    const proof = unlockHeader(await unlock(h.adult.client));
    for (const minor of [h.teen, h.child]) {
      for (const headers of [undefined, proof]) {
        expect((await minor.client.get(`/api/files/${picture.id}/content`, headers)).status).toBe(404);
        expect(await textOf(await minor.client.get("/api/library", headers))).not.toContain(picture.id);
        expect(await textOf(await minor.client.get(`/api/attachments/${picture.id}?v=full&conversation_id=${picture.conversationId}`, headers))).not.toContain(picture.id);
      }
    }
    const ownerRow = db.select().from(people).where(eq(people.id, actor.id)).get()! as PersonRow;
    const stored = db.select().from(attachments).where(eq(attachments.id, picture.id)).get()!;
    const provenance = JSON.parse(stored.provenance.slice("picture-gen:".length));
    provenance.lock = "off";
    db.update(attachments).set({ provenance: `picture-gen:${JSON.stringify(provenance)}` }).where(eq(attachments.id, picture.id)).run();
    expect(lockState(lockItemOfProvenance(actor.id, `picture-gen:${JSON.stringify(provenance)}`), ownerRow, { token: null, sessionKey: null })).toBe("open");
    for (const minor of [h.teen, h.child]) expect((await minor.client.get(`/api/files/${picture.id}/content`, proof)).status).toBe(404);

    const guest = new TestClient();
    expect((await guest.get(`/api/files/${picture.id}/content`, proof)).status).toBe(401);
  });

  test("all-ages picture-gen provenance is open, including music cover writer notes", () => {
    const adult = { id: "person-adult", role: "adult" } as PersonRow;
    const teen = { id: "person-teen", role: "teen" } as PersonRow;
    const allAges = lockItemOfProvenance("person-adult", 'picture-gen:{"v":1,"audience":"all-ages","job":"cover-job"}');
    expect(lockState(allAges, adult, { token: null, sessionKey: null })).toBe("open");
    expect(lockState(allAges, teen, { token: null, sessionKey: null })).toBe("open");
  });
});
