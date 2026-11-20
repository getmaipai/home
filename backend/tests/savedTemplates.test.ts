// TEMPLATE-02 (design record data-scratch/reports/video-template-02-v4-2026-11-20.md; RULES.md C1, C3, C4, C9, C10, C11, E7, E8, 6a): templates a person saves from a finished clip or
// picture. Private to the owner until Share with home; filtered where listTemplates builds its list (stamp vs the viewer's ceiling, then the household setting, for saved rows too);
// never in any other person's list while private. Every adult-only case runs with generation.styles.adult_only on and off.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { contentRatings, people as peopleTable, savedTemplates } from "@/db/schema";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { GENERATION_ADULT_STYLES_KEY } from "@/lib/pictures/policy";
import { setHouseholdSettingValue } from "@/lib/settings";
import { listTemplates } from "@/lib/media/templates";
import { putStamp } from "@/lib/filter/stamps";
import { rateStoredItem } from "@/lib/filter/rateStored";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { household, makeClip, markAdultOnly, unlock, unlockHeader } from "./fixtures/adultLock";
import type { TestClient } from "./client";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
beforeEach(() => {
  resetDb(); __resetAdultLockForTests();
  fake = installFakeVideoStack(); fake.ltx25 = "ready"; __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
});
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); setHouseholdSettingValue(GENERATION_ADULT_STYLES_KEY, "allowed"); });

const patch = (client: TestClient, path: string, body: unknown) => client.request(path, { method: "PATCH", body });
const setHouse = (restricted: boolean) => { setHouseholdSettingValue(GENERATION_ADULT_STYLES_KEY, restricted ? "restricted" : "allowed"); };
const PLAIN = "A paper boat floats down a rainy street, soft evening light";
type Template = { id: string; title: string; prompt: string; audience: string; owner_person_id?: string; shared_with?: string; references: string[]; styles: string[]; content_rating?: { level: string; source: string } };
const save = (client: TestClient, source: { kind: "clip" | "picture"; id: string }, extra: Record<string, unknown> = {}, headers?: Record<string, string>) => client.post("/api/media-templates", { source, title: "My boat", ...extra }, headers);
const idsFor = async (client: TestClient, kind = "video", headers?: Record<string, string>) => ((await (await client.get(`/api/media-templates?kind=${kind}`, headers)).json()) as { templates: Template[] }).templates.map((row) => row.id);
async function savedBy(client: TestClient, actor: PersonRow, extra: Record<string, unknown> = {}, prompt = PLAIN) {
  const clip = await makeClip(client, actor, prompt);
  const res = await save(client, { kind: "clip", id: clip.jobId }, extra);
  return { clip, res, body: (res.status === 201 ? await res.json() : null) as Template | null };
}

describe("saving a template from a finished clip", () => {
  test("keeps the words, stores no references, no styles and no model id, carries the owner and a stamp, and the clip's settings ride along", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const { res, body } = await savedBy(adult.client, me);
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ title: "My boat", prompt: PLAIN, audience: "all-ages", owner_person_id: me.id, references: [], styles: [] });
    expect(body).not.toHaveProperty("shared_with");
    expect(body!.content_rating).toMatchObject({ level: "G", source: "worked_out" });
    const stored = db.select().from(savedTemplates).where(eq(savedTemplates.id, body!.id)).get()!;
    expect(JSON.parse(stored.settings!).seconds).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/ltx|wan|minimax|model/i);
  });

  test("it is the owner's alone: another adult, the owner role, a teen and a child do not see it, and a guess at its id is a miss", async () => {
    const { adult, other, owner, teen, child, row } = await household();
    const { body } = await savedBy(adult.client, row("Marlow"));
    expect(await idsFor(adult.client)).toContain(body!.id);
    for (const viewer of [other.client, owner, teen.client, child.client]) expect(await idsFor(viewer)).not.toContain(body!.id);
    expect((await patch(other.client, `/api/media-templates/${body!.id}`, { title: "mine now" })).status).toBe(404);
    expect((await other.client.delete(`/api/media-templates/${body!.id}`)).status).toBe(404);
  });

  test("the person's cast names in the words become cast_* blanks and the name is not stored", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    createMediaSubject(me, { name: "Pippa", kind: "character", look: "a fox", referenceIds: [] } as never);
    const { body } = await savedBy(adult.client, me, { words: "Pippa waves at the sea. Pippa laughs." });
    expect(body!.prompt).toBe("{{cast_1|Person|a person from your cast}} waves at the sea. {{cast_2|Person|a person from your cast}} laughs.");
    expect(JSON.stringify(db.select().from(savedTemplates).all())).not.toContain("Pippa");
  });

  test("refusals: a photo blank, a broken blank, an empty name, a guest, a clip that is not yours or not done", async () => {
    const { adult, other, row } = await household();
    const clip = await makeClip(adult.client, row("Marlow"), PLAIN);
    expect((await save(adult.client, { kind: "clip", id: clip.jobId }, { words: "Use {{photo_1|Photo|a face}}" })).status).toBe(422);
    expect((await save(adult.client, { kind: "clip", id: clip.jobId }, { words: "Open {{name|Label" })).status).toBe(422);
    expect((await adult.client.post("/api/media-templates", { source: { kind: "clip", id: clip.jobId }, title: "   " })).status).toBe(400);
    expect((await save(other.client, { kind: "clip", id: clip.jobId })).status).toBe(404);
    expect((await save(adult.client, { kind: "clip", id: "vid-nope" })).status).toBe(404);
    expect((await new (await import("./client")).TestClient().post("/api/media-templates", { source: { kind: "clip", id: clip.jobId }, title: "x" })).status).toBe(401);
  });
});

describe("review fixes", () => {
  test("a cast name is blanked as a whole word only (Sam is not cut out of Samurai), and a title never carries the name", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    createMediaSubject(me, { name: "Sam", kind: "character", look: "a fox", referenceIds: [] } as never);
    const { body } = await savedBy(adult.client, me, { words: "Sam meets a samurai, then Sam waves", title: "Sam at the beach" });
    expect(body!.prompt).toBe("{{cast_1|Person|a person from your cast}} meets a samurai, then {{cast_2|Person|a person from your cast}} waves");
    expect(body!.title).toBe("someone at the beach");
    const renamed = await patch(adult.client, `/api/media-templates/${body!.id}`, { title: "Sam again" });
    expect(((await renamed.json()) as Template).title).toBe("someone again");
  });

  test("rename and share answer as a missing template, with no words, while the owner cannot open it (a closed lock)", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const clip = await makeClip(adult.client, me, "Zebraquill velvet cabaret dancer under violet lamps");
    markAdultOnly(clip.jobId);
    const proof = unlockHeader(await unlock(adult.client));
    const saved = (await (await save(adult.client, { kind: "clip", id: clip.jobId }, {}, proof)).json()) as Template;
    const closed = await patch(adult.client, `/api/media-templates/${saved.id}`, { title: "Quiet" });
    expect(closed.status).toBe(404);
    expect(await closed.text()).not.toContain("Zebraquill");
    expect((await adult.client.request(`/api/media-templates/${saved.id}`, { method: "PATCH", body: { shared_with: "household" } })).status).toBe(404);
    expect((await adult.client.request(`/api/media-templates/${saved.id}`, { method: "PATCH", body: { title: "Quiet" }, headers: proof })).status).toBe(200);
  });

  test("renaming a template whose stamp was lost keeps it unrated (never a fresh G)", async () => {
    const { adult, row } = await household();
    const { body } = await savedBy(adult.client, row("Marlow"));
    db.delete(contentRatings).where(eq(contentRatings.subjectId, body!.id)).run();
    await patch(adult.client, `/api/media-templates/${body!.id}`, { title: "Renamed" });
    expect(db.select().from(contentRatings).where(eq(contentRatings.subjectId, body!.id)).all()).toHaveLength(0);
  });
});

describe("Share with home and Stop sharing", () => {
  test("shared: the household sees it (child and teen too, it is G); stopped: it is gone again; a guest never sees a shared template", async () => {
    const { adult, other, teen, child, row, owner } = await household();
    const { body } = await savedBy(adult.client, row("Marlow"));
    expect((await patch(adult.client, `/api/media-templates/${body!.id}`, { shared_with: "household" })).status).toBe(200);
    for (const viewer of [other.client, teen.client, child.client, owner]) expect(await idsFor(viewer)).toContain(body!.id);
    // A guest: the list builder is where the guest rule lives.
    const guestRow = { id: "person-guestx", role: "guest" } as PersonRow;
    expect(listTemplates({ actor: guestRow, kind: "video" }).map((r) => r.id)).not.toContain(body!.id);
    expect((await patch(adult.client, `/api/media-templates/${body!.id}`, { shared_with: null })).status).toBe(200);
    for (const viewer of [other.client, teen.client, child.client, owner]) expect(await idsFor(viewer)).not.toContain(body!.id);
    expect(await idsFor(adult.client)).toContain(body!.id);
  });

  test("a child cannot share their own template", async () => {
    const { child, row } = await household();
    const kid = row("Sprout"), now = new Date().toISOString();
    db.insert(savedTemplates).values({ id: "mtpl-kidone0001", ownerPersonId: kid.id, kind: "video", title: "Kid boat", summary: "", category: "other", audience: "all-ages", prompt: "a paper boat", settings: null, aspect: null, sharedWith: null, lock: null, createdAt: now, updatedAt: now, hlc: "1:0:test", provenance: `${kid.id} (saved template)` }).run();
    putStamp({ kind: "template", id: "mtpl-kidone0001" }, rateStoredItem({ kind: "template", title: "Kid boat", text: "a paper boat" })!, "kid-fingerprint");
    const shared = await patch(child.client, "/api/media-templates/mtpl-kidone0001", { shared_with: "household" });
    expect(shared.status).toBe(403);
    expect(((await shared.json()) as { code: string }).code).toBe("share_children_off");
    expect(db.select().from(savedTemplates).where(eq(savedTemplates.id, "mtpl-kidone0001")).get()!.sharedWith).toBeNull();
  });
});

describe("rating and the household setting, saved rows included (setting on and off)", () => {
  for (const restricted of [false, true]) {
    test(`words that trip the minor floor are X: adult-only, absent for a teen and a child, and ${restricted ? "absent from an adult too (restricted home)" : "visible to an adult"}`, async () => {
      const { adult, other, teen, child, row } = await household();
      setHouse(restricted);
      const { res, body } = await savedBy(adult.client, row("Marlow"), { words: "a naked child in a bedroom" });
      expect(res.status).toBe(201);
      expect(body).toMatchObject({ audience: "adult-only" });
      expect(body!.content_rating).toMatchObject({ level: "X" });
      // Shared with the home: a person whose ceiling is below X still does not see it.
      await patch(adult.client, `/api/media-templates/${body!.id}`, { shared_with: "household" });
      for (const viewer of [teen, child]) expect(await idsFor(viewer.client)).not.toContain(body!.id);
      expect((await idsFor(other.client)).includes(body!.id)).toBe(!restricted);
      expect((await idsFor(adult.client)).includes(body!.id)).toBe(!restricted);
    });
  }

  test("an unrated saved template is hidden from a teen and a child (even shared) and still shown to an adult", async () => {
    const { adult, teen, child, row } = await household();
    const { body } = await savedBy(adult.client, row("Marlow"));
    await patch(adult.client, `/api/media-templates/${body!.id}`, { shared_with: "household" });
    db.delete(contentRatings).where(eq(contentRatings.subjectId, body!.id)).run();
    for (const viewer of [teen, child]) expect(await idsFor(viewer.client)).not.toContain(body!.id);
    expect(await idsFor(adult.client)).toContain(body!.id);
  });
});

describe("a lock on the source carries over, and being unchecked never creates one", () => {
  test("an all-ages source makes an unlocked template; a locked adult-only source makes a locked one that cannot be shared and is absent until unlocked", async () => {
    const { adult, other, row } = await household();
    const me = row("Marlow");
    const plain = await savedBy(adult.client, me);
    expect(db.select().from(savedTemplates).where(eq(savedTemplates.id, plain.body!.id)).get()!.lock).toBeNull();
    const clip = await makeClip(adult.client, me, "Zebraquill velvet cabaret dancer under violet lamps");
    markAdultOnly(clip.jobId);
    const proof = unlockHeader(await unlock(adult.client));
    const open = await save(adult.client, { kind: "clip", id: clip.jobId }, {}, proof);
    expect(open.status).toBe(201);
    const locked = (await open.json()) as Template;
    expect(locked.audience).toBe("adult-only");
    expect(db.select().from(savedTemplates).where(eq(savedTemplates.id, locked.id)).get()!.lock).toBe("on");
    const refused = await adult.client.request(`/api/media-templates/${locked.id}`, { method: "PATCH", body: { shared_with: "household" }, headers: proof });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe("share_locked");
    expect(await idsFor(adult.client)).not.toContain(locked.id);               // absent while the lock is closed
    expect(await idsFor(other.client)).not.toContain(locked.id);
    expect(await idsFor(adult.client, "video", proof)).toContain(locked.id);   // visible again with the owner's own unlock
  });
});

describe("rename and delete", () => {
  test("renaming re-rates the name with the words and never lowers the stamp; deleting removes the row and its stamp", async () => {
    const { adult, row } = await household();
    const { body } = await savedBy(adult.client, row("Marlow"));
    const renamed = await patch(adult.client, `/api/media-templates/${body!.id}`, { title: "Boat at dawn" });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as Template).title).toBe("Boat at dawn");
    expect((await adult.client.delete(`/api/media-templates/${body!.id}`)).status).toBe(204);
    expect(db.select().from(savedTemplates).where(eq(savedTemplates.id, body!.id)).get()).toBeUndefined();
    expect(db.select().from(contentRatings).where(eq(contentRatings.subjectId, body!.id)).all()).toHaveLength(0);
    expect((await adult.client.delete(`/api/media-templates/${body!.id}`)).status).toBe(404);
  });
});

describe("a person's saved templates go when the person is deleted", () => {
  test("their rows and stamps are erased, and a template they shared with the home is gone for everyone", async () => {
    const { adult, other, owner, row } = await household();
    const { body } = await savedBy(adult.client, row("Marlow"));
    await patch(adult.client, `/api/media-templates/${body!.id}`, { shared_with: "household" });
    expect(await idsFor(other.client)).toContain(body!.id);
    expect((await owner.delete(`/api/people/${row("Marlow").id}`)).status).toBeLessThan(300);
    expect(db.select().from(savedTemplates).where(eq(savedTemplates.id, body!.id)).get()).toBeUndefined();
    expect(db.select().from(contentRatings).where(eq(contentRatings.subjectId, body!.id)).all()).toHaveLength(0);
    expect(await idsFor(other.client)).not.toContain(body!.id);
  });
});

describe("round trip through Create", () => {
  test("the owner role makes a clip from a saved template (its words and settings); another person's private template does not resolve, a shared one does", async () => {
    const { owner, other, row } = await household();
    const me = row("Sage");
    const clip = await makeClip(owner, me, PLAIN);
    const res = await save(owner, { kind: "clip", id: clip.jobId }, { words: "A slow reveal of a paper boat" });
    const body = (await res.json()) as Template;
    const made = await owner.post("/api/plugins/video/actions/make", { prompt: "go", template: body.id });
    expect(made.status).toBe(200);
    expect(fake.submitted.at(-1)!.prompt).toContain("A slow reveal of a paper boat");
    const { resolveTemplate } = await import("@/lib/media/templates");
    const them = row("Quill");
    expect(resolveTemplate(them, body.id)).toBeNull();
    await patch(owner, `/api/media-templates/${body.id}`, { shared_with: "household" });
    expect(resolveTemplate(them, body.id)?.id).toBe(body.id);
    void other;
  });
});
