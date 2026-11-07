import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { listPackageIds } from "@/lib/plugins";
import { createSynth, forkSynth, getSynth, listSynths, maySeeSynth, shareFork } from "@/lib/synths";
import { setValue } from "@/lib/settings";
import { createHouseholdCompanion, householdCompanionFolder, migrateOwnerJsonAll } from "@/lib/householdCompanions";
import { resetDb } from "./reset-db";
import { child, owner, teen } from "./support/testAuth";

const invented = {
  display_name: "Moss",
  formality: "neutral",
  complexity: "standard",
  engagement: "balanced",
  filler_density: "light",
  audience: "all",
} as const;
const none = { kind: "none", person_id: null, name: null, refresh: "7d", minor: false } as const;
const basedOnMember = (personId: string) => ({ kind: "household_member", person_id: personId, name: null, refresh: "7d", minor: false } as const);

beforeEach(() => resetDb());

describe("TALENT-01 synth store", () => {
  test("creates an invented synth for the owner and lists a bundled companion as a synth", async () => {
    const { row } = await owner();
    const result = createSynth(row, { persona: invented, based_on: none, life: { enabled: true, seed: "" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.synth).toMatchObject({ based_on: { kind: "none" }, life: { enabled: true, seed: "" }, owner_person_id: row.id, private_to: null, forked_from: null });
    const bundledId = listPackageIds().find((id) => listSynths(row).some((synth) => synth.id === id));
    expect(bundledId).toBeDefined();
    expect(listSynths(row).some((synth) => synth.id === result.value.id)).toBe(true);
  });

  test("a child or teen cannot create a synth based on a person", async () => {
    const { client: ownerClient } = await owner();
    const teenClient = await teen(ownerClient);
    const childResult = await child(ownerClient);
    const teenRow = db.select().from(people).where(eq(people.role, "teen")).get()!;
    expect(teenClient).toBeDefined();
    const { row: childRow } = childResult;
    expect(createSynth(teenRow, { persona: invented, based_on: basedOnMember(teenRow.id), life: { enabled: true, seed: "" } })).toMatchObject({ ok: false, error: "Only an adult can base a synth on a real person. Make an invented one instead." });
    expect(createSynth(childRow, { persona: invented, based_on: basedOnMember(childRow.id), life: { enabled: true, seed: "" } })).toMatchObject({ ok: false, error: "Only an adult can base a synth on a real person. Make an invented one instead." });
  });

  test("a household member can refuse synths based on them", async () => {
    const { client: ownerClient } = await owner();
    const { row: childRow } = await child(ownerClient);
    const ownerRow = db.select().from(people).where(eq(people.role, "owner")).get()!;
    setValue(ownerRow, `person:${childRow.id}`, "synths.of_me", false);
    const result = createSynth(ownerRow, { persona: invented, based_on: basedOnMember(childRow.id), life: { enabled: true, seed: "" } });
    expect(result).toMatchObject({ ok: false, error: `${childRow.displayName} has turned off synths of them.` });
  });

  test("a real-person synth defaults to adult audience", async () => {
    const { row } = await owner();
    const result = createSynth(row, { persona: { ...invented, audience: undefined }, based_on: { kind: "real_person", person_id: null, name: "A public figure", refresh: "7d", minor: false }, life: { enabled: true, seed: "" } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.companion?.audience).toBe("adult");
  });

  test("a fork is private to its maker and can be seen by a parent managing a child", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const { row: childRow } = await child(ownerClient);
    const base = createSynth(ownerRow, { persona: invented, based_on: none, life: { enabled: true, seed: "" } });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const fork = forkSynth(childRow, base.value.id);
    expect(fork.ok).toBe(true);
    if (!fork.ok) return;
    expect(fork.value.synth).toMatchObject({ forked_from: base.value.id, private_to: childRow.id, owner_person_id: childRow.id });
    expect(maySeeSynth(ownerRow, fork.value.synth!)).toBe(true);
    expect(getSynth(ownerRow, fork.value.id)).toBe(fork.value.synth);
    await teen(ownerClient);
    const teenRow = db.select().from(people).where(eq(people.role, "teen")).get()!;
    expect(listSynths(teenRow).some((synth) => synth.id === fork.value.id)).toBe(false);
    expect(getSynth(teenRow, fork.value.id)).toBeNull();
    const shared = shareFork(ownerRow, fork.value.id);
    expect(shared).toMatchObject({ ok: true, value: { synth: { private_to: null } } });
  });

  test("migrates owner.json into the manifest and removes the old file", async () => {
    const { row } = await owner();
    const made = createHouseholdCompanion(invented, { display_name: row.displayName, person_id: row.id });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const dir = householdCompanionFolder(made.value.id)!;
    const manifestPath = join(dir, "manifest.json"), ownerPath = join(dir, "owner.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    delete manifest.synth;
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    writeFileSync(ownerPath, `${JSON.stringify({ person_id: row.id })}\n`);
    expect(migrateOwnerJsonAll()).toBe(1);
    expect(existsSync(ownerPath)).toBe(false);
    expect(JSON.parse(readFileSync(manifestPath, "utf8")).synth.owner_person_id).toBe(row.id);
  });
});
