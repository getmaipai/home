import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { memoryRecords, people } from "@/db/schema";
import { list, registerCompanionReadGate, remember } from "@/lib/memory";
import { resetDb } from "./reset-db";
import { child, owner } from "./support/testAuth";
import { createSynth, forkSynth, isCompanionFork, synthPersona, updateSynth, type SynthRecord } from "@/lib/synths";
import { activeBeats, isOnAir, rememberBeat, synthCard, tickLife, __setTalentLifeCompleterForTests } from "@/lib/talent/life";
import { localDayKey, hubTimeZone } from "@/lib/news/dayParts";
import { useDefaultScriptedStack } from "./stackFixture";
import { contextNode } from "@/lib/turnMachine/nodes/context";
import type { TurnState } from "@/lib/turnMachine/contract";
import { withTurnDefaults } from "./turnMachine/turnStateDefaults";
import { ensureCoreJob, runDueJobs } from "@/lib/scheduler";
import { runPlugin } from "@/lib/plugins";
import { scheduledJobs } from "@/db/schema";
import { eq } from "drizzle-orm";

const persona = { display_name: "Moss", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", audience: "all" } as const;
const basedOnNone = { kind: "none", person_id: null, name: null, refresh: "7d", minor: false } as const;

async function makeSynth() {
  const { row } = await owner();
  const made = await createSynth(row, { persona, based_on: basedOnNone, life: { enabled: false, seed: "" } });
  if (!made.ok) throw new Error("The test synth could not be created. Check the synth fixture.");
  return { actor: row, synth: made.value.synth as SynthRecord };
}

describe("synth life memory scope", () => {
  beforeEach(() => {
    resetDb();
    useDefaultScriptedStack();
    __setTalentLifeCompleterForTests(null);
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

  test("active beats include a current date span and exclude a span that ended yesterday", async () => {
    const { actor, synth } = await makeSynth();
    const today = localDayKey(new Date(), hubTimeZone());
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const upcoming = rememberBeat(synth.id, actor, { text: "A visit is planned.", category: "state", tier: "episodic", source: "talent.life", valid_from: yesterday, valid_to: tomorrow });
    const ended = rememberBeat(synth.id, actor, { text: "The old visit ended.", category: "state", tier: "episodic", source: "talent.life", valid_from: yesterday, valid_to: yesterday });
    if (!upcoming.ok || !ended.ok) throw new Error(JSON.stringify({ upcoming, ended }));
    const active = activeBeats(synth.id, actor, new Date(`${today}T12:00:00`)).map((beat) => beat.text);
    expect(active).toContain("A visit is planned.");
    expect(active).not.toContain("The old visit ended.");
  });

  test("a tick refused at the synth's audience floor does not write a beat", async () => {
    const { actor, synth } = await makeSynth();
    const result = await tickLife({ ...synth, life: { enabled: true, seed: "" } }, actor, localDayKey(new Date(), hubTimeZone()), async () => ({ ok: true, text: JSON.stringify({ beat: { kind: "mood", text: "any l-o-l-i stuff", from: "2026-11-07", to: null } }) }));
    expect(result).toBe("none");
    expect(list(actor, { scope: "companion", companionId: synth.id })).toEqual([]);
  });

  test("a tick skips when a life beat was already created today", async () => {
    const { actor, synth } = await makeSynth();
    const today = localDayKey(new Date(), hubTimeZone());
    const saved = rememberBeat(synth.id, actor, { text: "A small ordinary update.", category: "event", tier: "episodic", source: "talent.life", valid_from: today });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const result = await tickLife({ ...synth, life: { enabled: true, seed: "" } }, actor, today, async () => ({ ok: true, text: JSON.stringify({ beat: null }) }));
    expect(result).toBe("skipped");
  });

  test("synthCard stays within the profile card line and character budgets", async () => {
    const { actor, synth } = await makeSynth();
    for (let i = 0; i < 12; i++) rememberBeat(synth.id, actor, { text: `An ordinary life detail number ${i}.`, category: "event", tier: "durable", source: "talent.life", importance: 0.5 });
    const rendered = synthCard(synth.id, actor);
    expect(rendered.split("\n")).toHaveLength(8);
    expect(rendered.length).toBeLessThanOrEqual(400);
    expect(rendered.startsWith("Moss's life so far:")).toBe(true);
  });

  test("a base synth is not on air before show support exists", () => {
    expect(isOnAir("not-a-show-synth")).toBe(false);
  });

  test("the daily job ticks an active companion fork and skips its unpicked base", async () => {
    const { actor, synth } = await makeSynth();
    const base = { ...synth, life: { enabled: true, seed: "" } };
    const baseResult = updateSynth(actor, synth.id, { life: base.life });
    if (!baseResult.ok) throw new Error("The test synth could not be enabled. Check the synth fixture.");
    const fork = forkSynth(actor, synth.id);
    if (!fork.ok) throw new Error(JSON.stringify(fork));
    expect(isOnAir(base.id)).toBe(false);
    expect(isCompanionFork(base.id)).toBe(false);
    expect(isCompanionFork(fork.value.id)).toBe(true);
    let modelCalls = 0;
    __setTalentLifeCompleterForTests(async () => { modelCalls++; return { ok: true, text: JSON.stringify({ beat: null }) }; });
    ensureCoreJob("talent.life.tick", "every:1d");
    db.update(scheduledJobs).set({ nextRunAt: new Date(Date.now() - 1_000).toISOString() }).where(eq(scheduledJobs.job, "talent.life.tick")).run();
    const result = await runDueJobs(runPlugin);
    expect(result.errors).toBe(0);
    expect(modelCalls).toBe(1);
  });

  test("a synth companion turn receives the synth-card context item", async () => {
    const { actor, synth } = await makeSynth();
    rememberBeat(synth.id, actor, { text: "Moss enjoys quiet walks by the harbor.", category: "identity", tier: "durable", source: "talent.life" });
    const personaValue = synthPersona(synth);
    if (!personaValue) throw new Error("The test synth persona could not be loaded. Check its manifest fixture.");
    const state = withTurnDefaults({ actor, surface: "chat" } as TurnState);
    state.persona = personaValue;
    const { output } = await contextNode(state, { utterance: "hello" }, new AbortController().signal);
    expect(output.items.some((item) => item.id === "synth-card" && item.text.startsWith("Moss's life so far:"))).toBe(true);
  });
});
