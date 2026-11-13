// CREATOR-04 (CREATOR-PORT-2026-11-13, section 6): the one cast resolver, GET /api/cast, and the two-link write.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaSubjects, people } from "@/db/schema";
import { createSynth, linkSynthSubject, synthById, ensureSubject, listSynths, type SynthRecord } from "@/lib/synths";
import { createMediaSubject, shareMediaSubject, updateMediaSubject } from "@/lib/mediaSubjects";
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
    expect(names(listCast(teenRow))).toEqual(["Ada"]);
    setValue(sage, `person:${teenRow.id}`, "synths.real_people", "off");
    expect(names(listCast(teenRow))).toEqual([]);
    expect(listCast(teenRow).some((e) => e.kind === "member")).toBe(false);
    expect(mine(listCast(teenRow)).some((e) => e.real)).toBe(false);
    expect(ada.id).toBeTruthy();
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
    const second = await resolveCast(sage, ["Ada"]);
    expect(first.members[0]!.subject_id).toBe(second.members[0]!.subject_id);
    expect(first.members[0]).toMatchObject({ kind: "synth", synth_id: synth.id, real: true, minor: false });
    expect(first.members[0]!.synth?.subject_id).toBe(first.members[0]!.subject_id);
    expect(db.select().from(mediaSubjects).all().filter((r) => r.synthId === synth.id)).toHaveLength(1);
    // A subject listed for the synth is not listed again as a saved subject.
    expect(mine(listCast(sage)).filter((e) => e.name === "Ada")).toHaveLength(1);
    const invented = await makeSynth(sage, "Marlow Fox");
    const made = (await resolveCast(sage, [invented.id])).members[0]!;
    db.update(mediaSubjects).set({ real: true }).where(eq(mediaSubjects.id, made.subject_id)).run();
    expect((await resolveCast(sage, [invented.id])).members[0]!.real).toBe(false);
    expect(updateMediaSubject(sage, made.subject_id, { real: true })?.real).toBe(false);
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
