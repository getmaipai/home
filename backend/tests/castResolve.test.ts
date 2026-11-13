// CREATOR-04 (CREATOR-PORT-2026-11-13, section 6): the one cast resolver, GET /api/cast, and the two-link write.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaSubjects, people } from "@/db/schema";
import { createSynth, linkSynthSubject, synthById, ensureSubject, ownerActor, listSynths, type SynthRecord } from "@/lib/synths";
import { createMediaSubject, shareMediaSubject, updateMediaSubject, subjectFacts } from "@/lib/mediaSubjects";
import { storeFile } from "@/lib/attachments";
import { listCast, resolveCast, type CastEntry } from "@/lib/cast";
import { LIKENESS_OFF_LINE } from "@/lib/likeness";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { createMediaProduction, getMediaProduction } from "@/lib/mediaProductions";
import { runFilm, type FilmEngines } from "@/lib/films/run";
import type { FilmPlan } from "@/lib/films/plan";
import { resetDb } from "./reset-db";
import { child, owner, teen } from "./support/testAuth";
import type { PersonRow } from "@/types";

const persona: Parameters<typeof createSynth>[1]["persona"] = { display_name: "Marlow Fox", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", audience: "all", examples: ["I like a good plan.", "Let us try that.", "Fine by me."], status: "ready" } as never;
const none = { kind: "none", person_id: null, name: null, refresh: "7d", minor: false } as const;
const real = { kind: "real_person", person_id: null, name: "Ada Lovelace", refresh: "7d", minor: false } as const;
const life = { enabled: false, seed: "" };

async function world() {
  const { client, row: sage } = await owner();
  const kid = (await child(client)).row;
  await teen(client);
  const teenRow = db.select().from(people).where(eq(people.role, "teen")).get()! as PersonRow;
  return { sage, kid, teenRow };
}
async function makeSynth(actor: PersonRow, name: string, basedOn: Parameters<typeof createSynth>[1]["based_on"] = none): Promise<SynthRecord> {
  const made = await createSynth(actor, { persona: { ...persona, display_name: name }, based_on: basedOn, life });
  if (!made.ok) throw new Error(`The ${name} synth fixture could not be created: ${made.error}`);
  created.add(made.value.synth.id);
  return made.value.synth;
}
// Bundled and leftover household synths exist on disk across tests (resetDb clears the database only): a list is judged on the synths this test made.
const created = new Set<string>();
const mine = (rows: CastEntry[]) => rows.filter((r) => r.kind !== "synth" || created.has(r.synth_id!));
const names = (rows: CastEntry[]) => mine(rows).map((r) => r.name).sort();

beforeEach(() => { resetDb(); created.clear(); });

describe("GET /api/cast lists what the viewer may cast", () => {
  test("an adult sees synths, saved subjects and household members with real and minor derived", async () => {
    const { sage, kid } = await world();
    await makeSynth(sage, "Marlow Fox");
    createMediaSubject(sage, { name: "Blue house", kind: "place", look: "A blue house" });
    const list = mine(listCast(sage));
    expect(names(list)).toEqual(["Blue house", "Bramble", "Marlow Fox", "Poppy", "Sage"]);
    const poppy = list.find((e) => e.person_id === kid.id)!;
    expect(poppy).toMatchObject({ kind: "member", real: true, minor: true, synth_id: null, subject_id: null });
    expect(list.find((e) => e.person_id === sage.id)).toMatchObject({ real: true, minor: false });
    expect(list.find((e) => e.name === "Marlow Fox")).toMatchObject({ kind: "synth", real: false, minor: false });
    for (const e of list) expect(Object.keys(e)).toEqual(expect.arrayContaining(["id", "kind", "name", "look", "voice", "avatar"]));
  });

  test("a child's list has no household member, no real subject and no real-person synth", async () => {
    const { sage, kid } = await world();
    await makeSynth(sage, "Marlow Fox");
    await makeSynth(sage, "Ada", real);
    const realSubject = createMediaSubject(sage, { name: "Real friend", kind: "character", look: "a friend", real: true });
    const plain = createMediaSubject(sage, { name: "Red kite", kind: "prop", look: "a red kite" });
    shareMediaSubject(sage, realSubject.id, kid.id, true);
    shareMediaSubject(sage, plain.id, kid.id, true);
    const list = mine(listCast(kid));
    expect(names(list)).toEqual(["Marlow Fox", "Red kite"]);
    expect(list.some((e) => e.kind === "member" || e.real)).toBe(false);
    const result = await resolveCast(kid, ["Sage", "Real friend", "Ada"]);
    expect(result.members).toEqual([]);
    expect(result.refused.map((r) => r.ref)).toEqual(["Sage", "Real friend", "Ada"]);
    expect(result.refused[0]!.line).toMatch(/Real-person subjects are not available/);
  });

  test("a teen's list follows synths.real_people the same way and never lists a household member", async () => {
    const { sage, teenRow } = await world();
    const ada = await makeSynth(sage, "Ada", real);
    expect(names(listCast(teenRow))).toEqual([]);
    setValue(sage, `person:${teenRow.id}`, "synths.real_people", "all");
    expect(names(listCast(teenRow))).toEqual(["Ada"]); // the existing parent gate (maySeeSynth, synths.real_people) decides, exactly as on main
    setValue(sage, `person:${teenRow.id}`, "synths.real_people", "ask");
    expect(names(listCast(teenRow))).toEqual([]);
    setValue(sage, `person:${teenRow.id}`, "synths.real_people_allowed", [ada.id]);
    expect(names(listCast(teenRow))).toEqual(["Ada"]);
    setValue(sage, `person:${teenRow.id}`, "synths.real_people_allowed", []);
    setValue(sage, `person:${teenRow.id}`, "synths.real_people", "off");
    expect(names(listCast(teenRow))).toEqual([]);
    expect(listCast(teenRow).some((e) => e.kind === "member")).toBe(false);
    expect(ada.id).toBeTruthy();
  });

  test("a synth based on a household member needs household_likeness on (or the viewer is that member); a minor follows the existing synth gate", async () => {
    const { sage, kid, teenRow } = await world();
    const synth = await makeSynth(sage, "Poppy Fox", { kind: "household_member", person_id: kid.id, name: null, refresh: "7d", minor: true });
    const other = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
    expect(names(listCast(other))).toContain("Poppy Fox");
    setHouseholdSettingValue("generation.household_likeness", false);
    expect(names(listCast(sage))).not.toContain("Poppy Fox");
    expect((await resolveCast(sage, [synth.id])).members).toEqual([]);
    expect(names(listCast(teenRow))).not.toContain("Poppy Fox");
    expect((await resolveCast(teenRow, [synth.id, "Poppy Fox"])).members).toEqual([]);
    expect(names(listCast(kid))).toContain("Poppy Fox"); // the viewer is that member
    setHouseholdSettingValue("generation.household_likeness", true);
    expect(names(listCast(teenRow))).toContain("Poppy Fox"); // on: the existing synth gate alone decides for a minor
  });

  test("adult-only subjects are filtered out for a minor, not just labelled", async () => {
    const { sage, teenRow } = await world();
    const stored = storeFile(sage, { conversationId: null, turnId: null, mediaType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]), provenance: 'picture-gen:{"audience":"adult-only"}', name: "a.png" });
    if (!stored.ok) throw new Error("fixture picture failed");
    const subject = createMediaSubject(sage, { name: "Night club", kind: "place", look: "a club", referenceIds: [stored.value.id] });
    const plain = createMediaSubject(sage, { name: "Park", kind: "place", look: "a park" });
    shareMediaSubject(sage, subject.id, teenRow.id, true); shareMediaSubject(sage, plain.id, teenRow.id, true);
    expect(names(listCast(sage))).toContain("Night club");
    expect(listCast(sage).find((e) => e.name === "Night club")).toMatchObject({ audience: "adult-only" });
    expect(names(listCast(teenRow))).toEqual(["Park"]);
    expect((await resolveCast(teenRow, ["Night club"])).members).toEqual([]);
  });

  test("a household member's subject is not reachable through the subject paths or the pictures of a minor", async () => {
    const { sage, kid } = await world();
    const { getMediaSubject, listMediaSubjects, subjectsForNames, deleteMediaSubject } = await import("@/lib/mediaSubjects");
    const member = (await resolveCast(sage, ["Poppy"])).members[0]!;
    expect(getMediaSubject(sage, member.subject_id)).toBeNull();
    expect(listMediaSubjects(sage).map((s) => s.id)).not.toContain(member.subject_id);
    expect(subjectsForNames(sage, ["Poppy"])).toBeNull();
    expect(getMediaSubject(kid, member.subject_id)).toBeNull();
    expect(shareMediaSubject(kid, member.subject_id, sage.id, true)).toBeNull();
    expect(deleteMediaSubject(kid, member.subject_id)).toBe(false);
    expect(listCast(sage).find((e) => e.person_id === kid.id)!.avatar.url).toBeNull();
  });

  test("an id is exact; a name shared by two cast members is ambiguous, never the first hit", async () => {
    const { sage } = await world();
    const one = createMediaSubject(sage, { name: "Rex", kind: "prop", look: "a toy" });
    const two = createMediaSubject(sage, { name: "rex", kind: "prop", look: "another toy" });
    const byName = await resolveCast(sage, ["REX"]);
    expect(byName.members).toEqual([]);
    expect(byName.refused[0]).toMatchObject({ ref: "REX", ambiguous: true });
    expect((await resolveCast(sage, [two.id])).members[0]!.subject_id).toBe(two.id);
    expect((await resolveCast(sage, [one.id, two.id])).members).toHaveLength(2);
  });

  test("the household option off hides other members from adults, keeps their own entry, and the line names the setting", async () => {
    const { sage, kid } = await world();
    setHouseholdSettingValue("generation.household_likeness", false);
    expect(names(listCast(sage))).toEqual(["Sage"]);
    const refused = await resolveCast(sage, ["Poppy"]);
    expect(refused.members).toEqual([]);
    expect(refused.refused[0]!.line).toBe(LIKENESS_OFF_LINE);
    expect((await resolveCast(sage, ["Sage"])).members).toHaveLength(1);
    setHouseholdSettingValue("generation.household_likeness", true);
    expect((await resolveCast(sage, ["Poppy"])).members[0]).toMatchObject({ person_id: kid.id, minor: true });
  });

  test("casting a household member makes a subject with the person link and no synth, and synths.of_me is ignored", async () => {
    const { sage, kid } = await world();
    setValue(sage, `person:${kid.id}`, "synths.of_me", false);
    const before = listSynths(sage).length;
    const { members, refused } = await resolveCast(sage, ["Poppy", kid.id]);
    expect(refused).toEqual([]);
    expect(members).toHaveLength(1);
    const row = db.select().from(mediaSubjects).where(eq(mediaSubjects.personId, kid.id)).get()!;
    expect(row).toMatchObject({ synthId: null, ownerPersonId: kid.id, real: false });
    expect(members[0]).toMatchObject({ subject_id: row.id, synth: null, real: true, minor: true, kind: "member" });
    expect(listSynths(sage)).toHaveLength(before);
    expect((await resolveCast(sage, ["Poppy"])).members[0]!.subject_id).toBe(row.id);
    expect(db.select().from(mediaSubjects).where(eq(mediaSubjects.personId, kid.id)).all()).toHaveLength(1);
    // The subject never leaks to a child viewer, even when it exists.
    expect(names(listCast(kid))).not.toContain("Poppy");
  });
});

describe("a synth-linked subject", () => {
  test("is one subject for the synth, derives real from based_on and ignores a hand-set real", async () => {
    const { sage } = await world();
    const synth = await makeSynth(sage, "Ada", real);
    const first = await resolveCast(sage, [synth.id]);
    const second = await resolveCast(sage, [first.members[0]!.subject_id]);
    expect(first.members[0]!.subject_id).toBe(second.members[0]!.subject_id);
    expect(first.members[0]).toMatchObject({ kind: "synth", synth_id: synth.id, real: true, minor: false });
    expect(first.members[0]!.synth?.subject_id).toBe(first.members[0]!.subject_id);
    expect(db.select().from(mediaSubjects).all().filter((r) => r.synthId === synth.id)).toHaveLength(1);
    // A subject listed for the synth is not listed again as a saved subject.
    expect(mine(listCast(sage)).filter((e) => e.name === "Ada")).toHaveLength(1);
    const invented = await makeSynth(sage, "Marlow Fox");
    const made = (await resolveCast(sage, [invented.id])).members[0]!;
    expect(updateMediaSubject(sage, made.subject_id, { real: true })?.real).toBe(false); // never set by hand on a linked subject
    // The derived fact is the stricter of the synth and the subject's own flag: a stored real flag is never laundered away.
    expect(subjectFacts({ real: true, synthId: invented.id, personId: null }).real).toBe(true);
    expect(subjectFacts({ real: false, synthId: synth.id, personId: null }).real).toBe(true);
    // A synth that is gone fails safe: real when any stored flag or person link says so.
    expect(subjectFacts({ real: true, synthId: "hc-gone", personId: null }).real).toBe(true);
    expect(subjectFacts({ real: false, synthId: "hc-gone", personId: "person-x" }).real).toBe(true);
    expect(subjectFacts({ real: false, synthId: "hc-gone", personId: null }).real).toBe(false);
  });

  test("a minor household-member synth keeps based_on.minor", async () => {
    const { sage, kid } = await world();
    const synth = await makeSynth(sage, "Poppy Fox", { kind: "household_member", person_id: kid.id, name: null, refresh: "7d", minor: true });
    const member = (await resolveCast(sage, [synth.id])).members[0]!;
    expect(member).toMatchObject({ real: true, minor: true, synth_id: synth.id, person_id: null });
  });
});

describe("the two-link transaction", () => {
  test("synth.subject_id and media-subject.synth_id are written together and always agree", async () => {
    const { sage } = await world();
    const synth = await makeSynth(sage, "Marlow Fox");
    const subjectId = await ensureSubject(synth);
    const row = db.select().from(mediaSubjects).where(eq(mediaSubjects.id, subjectId)).get()!;
    expect(synthById(synth.id)!.subject_id).toBe(subjectId);
    expect(row.synthId).toBe(synth.id);
    expect(await ensureSubject(synthById(synth.id)!)).toBe(subjectId);
  });

  test("a bundled synth whose recorded maker is gone is made by the household owner, so it can be cast", async () => {
    const { sage } = await world();
    const synth = await makeSynth(sage, "Rivet Fox");
    const orphaned = { ...synth, owner_person_id: "person-unknown" };
    expect(ownerActor(orphaned)?.id).toBe(sage.id);
    expect(ownerActor({ ...orphaned, private_to: sage.id })).toBeNull();
    expect(ownerActor({ ...orphaned, forked_from: "hc-other" })).toBeNull();
  });

  test("a bundled catalog synth (Rivet) can be cast: the link lives in the subject row and reads back", async () => {
    await world();
    const rivet = synthById("rivet")!;
    expect(rivet).toBeTruthy();
    const subjectId = await ensureSubject(rivet);
    expect(synthById("rivet")!.subject_id).toBe(subjectId);
    expect(db.select().from(mediaSubjects).where(eq(mediaSubjects.id, subjectId)).get()!.synthId).toBe("rivet");
    expect(await ensureSubject(synthById("rivet")!)).toBe(subjectId);
  });

  test("a failed synth write leaves no half link, and a subject cannot serve two synths", async () => {
    const { sage } = await world();
    const subject = createMediaSubject(sage, { name: "Loose", kind: "character", look: "a loose character" });
    expect(() => linkSynthSubject(sage, "hc-missing", subject.id)).toThrow();
    expect(db.select().from(mediaSubjects).where(eq(mediaSubjects.id, subject.id)).get()!.synthId).toBeNull();
    const a = await makeSynth(sage, "Marlow Fox"), b = await makeSynth(sage, "Marlow Two");
    linkSynthSubject(sage, a.id, subject.id);
    expect(synthById(a.id)!.subject_id).toBe(subject.id);
    expect(() => linkSynthSubject(sage, b.id, subject.id)).toThrow(/another synth/);
    expect(synthById(b.id)!.subject_id).toBeNull();
  });
});

describe("the route", () => {
  test("GET /api/cast answers the signed-in viewer's list and refuses a signed-out caller", async () => {
    const { client, row } = await owner();
    createMediaSubject(row, { name: "Blue house", kind: "place", look: "A blue house" });
    const res = await client.get("/api/cast");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cast: CastEntry[] };
    expect(body.cast.map((e) => e.name)).toEqual(expect.arrayContaining(["Blue house", "Sage"]));
    const { TestClient } = await import("./client");
    expect((await new TestClient().get("/api/cast")).status).toBe(401);
  });
});

describe("the film runner", () => {
  test("stores synth_id on production cast for a synth-linked subject and null for a plain one", async () => {
    const { sage } = await world();
    const synth = await makeSynth(sage, "Marlow Fox");
    const cast = (await resolveCast(sage, [synth.id])).members[0]!;
    const plain = createMediaSubject(sage, { name: "Mira", kind: "character", look: "Blue coat." });
    const ids: Record<string, string> = { "Marlow Fox": cast.subject_id, Mira: plain.id };
    const plan: FilmPlan = { title: "T", summary: "S", music: "m", credits: [], cast: [{ name: "Marlow Fox", kind: "character", locked: "Fox coat." }, { name: "Mira", kind: "character", locked: "Blue coat." }], shots: [{ id: "shot-1", subject_ids: [], framing: "wide", still: "Both.", motion: "Walk.", seconds: 5 }] } as never;
    const engines: FilmEngines = { async waitForIdle() {}, async ensureSubject(input) { return ids[input.name]!; }, async makeStill() { return "picture:1"; }, async makeClip() { return "clip:1"; }, async makeMusic() { return "music-1"; }, async assemble() { return "cut-1"; } };
    const production = createMediaProduction(sage, { title: "Draft" });
    await runFilm({ actor: sage, productionId: production.id, plan, engines, signal: new AbortController().signal });
    expect(getMediaProduction(sage, production.id)!.cast.map((c) => [c.role, c.synth_id])).toEqual([["Marlow Fox", synth.id], ["Mira", null]]);
  });
});

describe("link guards and the race", () => {
  test("only someone who may edit the synth and use the subject links them; real is never laundered to a fictional synth", async () => {
    const { sage, kid } = await world();
    const synth = await makeSynth(sage, "Marlow Fox");
    const mine = createMediaSubject(sage, { name: "Loose", kind: "character", look: "a character" });
    expect(() => linkSynthSubject(kid, synth.id, mine.id)).toThrow();
    expect(db.select().from(mediaSubjects).where(eq(mediaSubjects.id, mine.id)).get()!.synthId).toBeNull();
    const realOne = createMediaSubject(sage, { name: "Real friend", kind: "character", look: "a friend", real: true });
    expect(() => linkSynthSubject(sage, synth.id, realOne.id)).toThrow(/real/i);
    expect(synthById(synth.id)!.subject_id).toBeNull();
    const ada = await makeSynth(sage, "Ada", real);
    linkSynthSubject(sage, ada.id, realOne.id); // a real synth may take a real subject
    expect(synthById(ada.id)!.subject_id).toBe(realOne.id);
  });

  test("relinking clears the old subject's synth_id, and synth_id is unique", async () => {
    const { sage } = await world();
    const synth = await makeSynth(sage, "Marlow Fox"), other = await makeSynth(sage, "Marlow Two");
    const a = createMediaSubject(sage, { name: "A", kind: "character", look: "a" }), b = createMediaSubject(sage, { name: "B", kind: "character", look: "b" });
    linkSynthSubject(sage, synth.id, a.id);
    linkSynthSubject(sage, synth.id, b.id);
    expect(db.select().from(mediaSubjects).where(eq(mediaSubjects.id, a.id)).get()!.synthId).toBeNull();
    expect(db.select().from(mediaSubjects).where(eq(mediaSubjects.id, b.id)).get()!.synthId).toBe(synth.id);
    expect(() => db.update(mediaSubjects).set({ synthId: synth.id }).where(eq(mediaSubjects.id, a.id)).run()).toThrow();
    expect(other.id).toBeTruthy();
  });

  test("two ensureSubject calls on one synth make one subject", async () => {
    const { sage } = await world();
    const synth = await makeSynth(sage, "Marlow Fox");
    const [x, y] = await Promise.all([ensureSubject(synth), ensureSubject(synth)]);
    expect(x).toBe(y);
    expect(db.select().from(mediaSubjects).all().filter((r) => r.synthId === synth.id)).toHaveLength(1);
    // A stale synth record (subject_id still null) reuses the subject that exists for it.
    expect(await ensureSubject(synth)).toBe(x);
  });
});

describe("the migration back-fill", () => {
  test("guards bad json, links only the oldest subject per synth, and leaves everything else alone", async () => {
    const { Database } = await import("bun:sqlite");
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../src/db/migrations/0195_media_subject_cast.sql", import.meta.url), "utf8");
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE media_subjects (id text primary key, provenance text not null, created_at text not null, real integer not null default 0)");
    const add = (id: string, prov: string, at: string) => sqlite.query("INSERT INTO media_subjects (id, provenance, created_at) VALUES (?, ?, ?)").run(id, prov, at);
    add("old", 'media-subject:{"v":1,"source":"talent:synth:hc-a"}', "2026-01-01");
    add("new", 'media-subject:{"v":1,"source":"talent:synth:hc-a"}', "2026-02-01");
    add("bad", "media-subject:{not json", "2026-01-01");
    add("plain", 'media-subject:{"v":1,"source":"api"}', "2026-01-01");
    for (const part of sql.split("--> statement-breakpoint")) sqlite.exec(part);
    const rows = Object.fromEntries((sqlite.query("SELECT id, synth_id FROM media_subjects").all() as Array<{ id: string; synth_id: string | null }>).map((r) => [r.id, r.synth_id]));
    expect(rows).toEqual({ old: "hc-a", new: null, bad: null, plain: null });
  });
});
