// CREATOR-03 (CREATOR-PORT-2026-11-13): the credits of a synth read from the stored cast link, under the Library's viewer rule, and a film's rolling credits
// read from the same link.
import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { household, unlock, unlockHeader } from "./fixtures/adultLock";
import { makePicture } from "./fixtures/adultLockPicture";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { createSynth, ensureSubject, synthById } from "@/lib/synths";
import { createShare } from "@/lib/shares";
import { recordCreation } from "@/lib/creations/store";
import { filmCreditLines, storedFilmCredits } from "@/lib/creations/credits";
import { subjectViewById } from "@/lib/mediaSubjects";
import { createMediaProduction } from "@/lib/mediaProductions";
import type { PersonRow } from "@/types";

const name = (id: string) => subjectViewById(id)?.name;
interface Item { creation_id: string; kind: string; file_id: string; thumb_file_id: string; title: string; role: string; made_at: string }
type Credits = { shows: unknown[]; films: Array<{ file_id: string }>; bands: unknown[]; credits: Item[] };

async function fixture() {
  const h = await household();
  const sage = h.row("Sage"); const marlow = h.row("Marlow"); const quill = h.row("Quill");
  const made = await createSynth(sage, { persona: { display_name: "Moss", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", audience: "all" } as never, based_on: { kind: "none", person_id: null, name: null, refresh: "7d", minor: false }, life: { enabled: false, seed: "" } });
  if (!made.ok) throw new Error("The synth fixture could not be created.");
  const subjectId = await ensureSubject(synthById(made.value.id)!);
  return { h, sage, marlow, quill, synthId: made.value.id, subjectId };
}
const cast = (f: { synthId: string; subjectId: string }, role: string) => [{ subject_id: f.subjectId, synth_id: f.synthId, role }];
const credits = async (client: { get: (p: string, h?: Record<string, string>) => Promise<Response> }, synthId: string, headers?: Record<string, string>) => {
  const res = await client.get(`/api/talent/synths/${synthId}/credits`, headers);
  return { status: res.status, text: await res.clone().text(), body: (res.status === 200 ? await res.json() : null) as Credits | null };
};

describe("CREATOR-03 credits from the stored cast link", () => {
  beforeEach(() => { resetDb(); __resetAdultLockForTests(); });

  test("the owner sees every picture and film the synth is cast in, with role, date, thumbnail, newest first", async () => {
    const f = await fixture();
    const picture = await makePicture(f.sage, "all-ages", "Moss at the pond");
    const film = await makePicture(f.sage, "all-ages", "Moss, the film");
    recordCreation(f.sage, { kind: "picture", fileIds: [picture.id], recipe: { tool: "pictures", route: "text" }, cast: cast(f, "subject") });
    recordCreation(f.sage, { kind: "film", fileIds: [film.id], recipe: { tool: "make_film", route: "film" }, cast: cast(f, "lead") });
    const { status, body } = await credits(f.h.owner, f.synthId);
    expect(status).toBe(200);
    expect(body!.credits.map((item) => item.kind).sort()).toEqual(["film", "picture"]);
    const filmItem = body!.credits.find((item) => item.kind === "film")!;
    expect(filmItem.role).toBe("Lead");
    expect(filmItem.file_id).toBe(film.id);
    expect(filmItem.thumb_file_id).toBe(film.id);
    expect(Date.parse(filmItem.made_at)).toBeGreaterThan(0);
    expect(body!.credits[0]!.kind).toBe("film");
  });

  test("a picture whose cast carries only the synth's subject (no synth id) is still a credit", async () => {
    const f = await fixture();
    const picture = await makePicture(f.sage, "all-ages", "Moss again");
    recordCreation(f.sage, { kind: "picture", fileIds: [picture.id], recipe: { tool: "pictures", route: "text" }, cast: [{ subject_id: f.subjectId, synth_id: null, role: "subject" }] });
    expect((await credits(f.h.owner, f.synthId)).body!.credits).toHaveLength(1);
  });

  test("another adult sees only the items shared to them", async () => {
    const f = await fixture();
    const shared = await makePicture(f.sage, "all-ages", "Shared Moss");
    const kept = await makePicture(f.sage, "all-ages", "Private Moss");
    for (const file of [shared, kept]) recordCreation(f.sage, { kind: "picture", fileIds: [file.id], recipe: { tool: "pictures", route: "text" }, cast: cast(f, "subject") });
    expect(createShare(f.sage, { fileId: shared.id, to: f.quill.id }).ok).toBe(true);
    const { body } = await credits(f.h.other.client, f.synthId);
    expect(body!.credits.map((item) => item.file_id)).toEqual([shared.id]);
  });

  test("a teen and a child never see a locked or adult-only credit, and it is in no count", async () => {
    const f = await fixture();
    const plain = await makePicture(f.sage, "all-ages", "Plain Moss");
    const adult = await makePicture(f.sage, "adult-only", "Zebraquill Moss");
    for (const file of [plain, adult]) recordCreation(f.sage, { kind: "picture", fileIds: [file.id], recipe: { tool: "pictures", route: "text" }, cast: cast(f, "subject") });
    expect(createShare(f.sage, { fileId: plain.id, to: "household" }).ok).toBe(true);
    // The adult-only file is forced into a household share by hand, the way a wrong share would be: the reader still must not see it.
    const { db } = await import("@/db"); const { shares } = await import("@/db/schema");
    db.insert(shares).values({ id: "shr-forced", fileId: adult.id, fromPersonId: f.sage.id, to: "household", provenance: "test", createdAt: new Date().toISOString(), hlc: "0" } as never).run();
    for (const client of [f.h.teen.client, f.h.child.client]) {
      const { status, body, text } = await credits(client, f.synthId);
      expect(status).toBe(200);
      expect(body!.credits.map((item) => item.file_id)).toEqual([plain.id]);
      expect(text).not.toContain(adult.id);
      expect(text).not.toContain("Zebraquill");
    }
  });

  test("a locked adult item is absent for its owner without the unlock and listed with it", async () => {
    const f = await fixture();
    const adult = await makePicture(f.sage, "adult-only", "Locked Moss");
    recordCreation(f.sage, { kind: "picture", fileIds: [adult.id], recipe: { tool: "pictures", route: "text" }, cast: cast(f, "subject") });
    expect((await credits(f.h.owner, f.synthId)).body!.credits).toHaveLength(0);
    // The owner's passcode is the household fixture's; the lock opens for the unlocking adult.
    const proof = unlockHeader(await unlock(f.h.owner, "correcthorse"));
    expect((await credits(f.h.owner, f.synthId, proof)).body!.credits).toHaveLength(1);
  });

  test("a synth the viewer cannot use answers not-found and lists nothing", async () => {
    const f = await fixture();
    const { status } = await credits(f.h.owner, "synth-nobody");
    expect(status).toBe(404);
  });
});

describe("CREATOR-03 a film's rolling credits", () => {
  beforeEach(() => { resetDb(); __resetAdultLockForTests(); });

  test("they are the stored cast: each member's name and the stored role", async () => {
    const f = await fixture();
    const clip = await makePicture(f.sage, "all-ages", "Film cut");
    const production = createMediaProduction(f.sage, { title: "Moss at Dawn", summary: "" } as never, "film");
    recordCreation(f.sage, { kind: "film", fileIds: [clip.id], productionId: production.id, recipe: { tool: "make_film", route: "film" }, cast: cast(f, "lead") });
    expect(storedFilmCredits(production.id, [], name)).toEqual([{ role: "Lead", name: "Moss" }]);
    const planned = [{ role: "Directed by", name: "Someone In The Plan" }];
    expect(filmCreditLines(storedFilmCredits(production.id, [], name), planned)).toEqual([{ role: "Directed by", name: "Someone In The Plan" }, { role: "Lead", name: "Moss" }]);
  });

  test("the production's own stored cast counts when its film has no record yet", async () => {
    const f = await fixture();
    const production = createMediaProduction(f.sage, { title: "Moss Begins", summary: "" } as never, "film");
    expect(storedFilmCredits(production.id, [{ subject_id: f.subjectId, role: "narrator" }], name)).toEqual([{ role: "Narrator", name: "Moss" }]);
  });

  test("stored cast replaces only the plan's cast lines; crew lines stay in the plan's order", () => {
    const stored = [{ role: "Lead", name: "Moss" }];
    const plan = [{ role: "Directed by", name: "Quill" }, { role: "Hero", name: "moss" }, { role: "Music by", name: "Tempo" }, { role: "Sidekick", name: "Mossy Friend" }];
    expect(filmCreditLines(stored, plan, ["Mossy Friend"])).toEqual([{ role: "Directed by", name: "Quill" }, { role: "Lead", name: "Moss" }, { role: "Music by", name: "Tempo" }]);
    expect(filmCreditLines(stored, [{ role: "Music by", name: "Tempo" }])).toEqual([{ role: "Music by", name: "Tempo" }, { role: "Lead", name: "Moss" }]);
  });

  test("a film made before the store falls back to the plan's names", async () => {
    const f = await fixture();
    const production = createMediaProduction(f.sage, { title: "Old Film", summary: "" } as never, "film");
    const stored = storedFilmCredits(production.id, [], name);
    expect(stored).toEqual([]);
    const planned = [{ role: "Directed by", name: "Quill" }];
    expect(filmCreditLines(stored, planned)).toEqual(planned);
  });
});
