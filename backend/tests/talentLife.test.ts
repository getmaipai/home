import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { list, registerCompanionReadGate, remember } from "@/lib/memory";
import { resetDb } from "./reset-db";
import { child, owner } from "./support/testAuth";

describe("synth life memory scope", () => {
  beforeEach(() => {
    resetDb();
    registerCompanionReadGate(() => false);
  });

  test("companion records require a talent source and remain isolated by synth", async () => {
    const { row: ownerRow } = await owner();
    const invalid = remember(ownerRow, { text: "A private beat.", category: "event", tier: "durable", scope: "companion", companion_id: "rivet", source: "chat", importance: 0.5 });
    expect(invalid).toMatchObject({ ok: false });
    const missingCompanionId = remember(ownerRow, { text: "An unscoped beat.", category: "event", tier: "durable", scope: "companion", source: "talent.life", importance: 0.5 });
    expect(missingCompanionId).toMatchObject({ ok: false });
    const rivet = remember(ownerRow, { text: "The same beat.", category: "event", tier: "durable", scope: "companion", companion_id: "rivet", source: "talent.life", importance: 0.5 });
    const moss = remember(ownerRow, { text: "The same beat.", category: "event", tier: "durable", scope: "companion", companion_id: "moss", source: "talent.life", importance: 0.5 });
    expect(rivet).toMatchObject({ ok: true });
    expect(moss).toMatchObject({ ok: true });
    registerCompanionReadGate(() => true);
    expect(list(ownerRow, { scope: "companion", companionId: "rivet" })).toHaveLength(1);
    expect(list(ownerRow, { scope: "companion", companionId: "moss" })).toHaveLength(1);
    expect(list(ownerRow, { scope: "companion" })).toHaveLength(2);
  });

  test("a child reads only child_ok companion records when the companion gate allows it", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const { row: childRow } = await child(ownerClient);
    for (const [text, child_disclosure] of [["Child safe beat.", "child_ok"], ["Teen only beat.", "teen_ok"], ["Adult only beat.", "adult_only"]] as const) {
      expect(remember(ownerRow, { text, category: "event", tier: "durable", scope: "companion", companion_id: "rivet", source: "talent.life", importance: 0.5, child_disclosure }).ok).toBe(true);
    }
    registerCompanionReadGate((_actor, id) => id === "rivet");
    expect(list(childRow, { scope: "companion", companionId: "rivet" }).map((record) => record.text)).toEqual(["Child safe beat."]);
    registerCompanionReadGate(() => false);
    expect(list(childRow, { scope: "companion", companionId: "rivet" })).toEqual([]);
  });

  test("a person scoped record with a companion id is not a companion record", async () => {
    const { row: ownerRow } = await owner();
    expect(remember(ownerRow, { text: "Rapport belongs to this person.", category: "event", tier: "durable", scope: "person", person: ownerRow.id, companion_id: "rivet", source: "test", importance: 0.5 }).ok).toBe(true);
    registerCompanionReadGate(() => true);
    expect(list(ownerRow, { scope: "companion", companionId: "rivet" })).toEqual([]);
    expect(list(ownerRow, { scope: "person", person: ownerRow.id }).map((record) => record.text)).toEqual(["Rapport belongs to this person."]);
  });
});
