import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memoryRecords, people, talentResearchRuns } from "@/db/schema";
import { createSynth, forkSynth, updateSynth, type SynthRecord } from "@/lib/synths";
import { activeBeats, rememberBeat } from "@/lib/talent/life";
import { forgetByIds } from "@/lib/memory";
import { RESEARCH_PROMPT, researchSynth, isResearchingSynth, __setResearchSearchForTests, __setResearchReferenceForTests } from "@/lib/talent/researcher";
import { __setResearchCompleterForTests, __setResearchSourcesForTests } from "@/lib/talent/researcher";
import { setValue } from "@/lib/settings";
import { useDefaultScriptedStack } from "./stackFixture";
import { resetDb } from "./reset-db";
import { child, owner, teen } from "./support/testAuth";

const persona: Parameters<typeof createSynth>[1]["persona"] = { display_name: "Ada Lovelace", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", audience: "all", examples: ["I enjoy a careful calculation.", "Let us consider the pattern.", "One may test this idea."] };
const basedOn = { kind: "real_person", person_id: null, name: "Ada Lovelace", refresh: "7d", minor: false } as const;
const payload = (updates: Record<string, unknown> = {}) => ({
  facts: [
    { date: "2026-10-01", text: "She published a new public letter.", source: "https://example.org/news", confidence: 0.91 },
    { date: "2026-10-02", text: "She spoke at a public event.", source: "https://example.org/event", confidence: 0.87 },
    { date: "2026-10-03", text: "She released a public statement.", source: "https://example.org/statement", confidence: 0.82 },
  ],
  style: { dials: { formality: "formal", complexity: "advanced", hedging: "high" }, examples: [
    { phrase: "One must consider the evidence.", source: "https://example.org/phrase1" },
    { phrase: "A curious calculation follows.", source: "https://example.org/phrase2" },
    { phrase: "Let us examine the result.", source: "https://example.org/phrase3" },
  ] },
  views: [
    { topic: "education", position: "She supported wider access to education.", source: "https://example.org/view1" },
    { topic: "science", position: "She valued careful observation.", source: "https://example.org/view2" },
  ],
  ...updates,
});

async function setup() {
  const { row } = await owner();
  const made = await createSynth(row, { persona, based_on: basedOn, life: { enabled: false, seed: "" } });
  if (!made.ok) throw new Error("The research synth fixture could not be created. Check its persona and base figure.");
  return { actor: row, synth: made.value.synth as SynthRecord };
}

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __setResearchSourcesForTests(["searxng"]);
  __setResearchSearchForTests(async ({ args }) => ({ text: "", rows: [{ title: String((args as { query: string }).query), url: "https://example.org/search", snippet: "Public search result." }], pages: [] }));
  __setResearchReferenceForTests({ search: async () => ({ hits: [], total: 0 }), load: async () => null });
  __setResearchCompleterForTests(async () => ({ ok: true, text: JSON.stringify(payload()) }));
});

describe("TALENT-14 researcher", () => {
  test("reports only research runs that are in flight", async () => {
    const { actor, synth } = await setup();
    expect(isResearchingSynth(synth.id)).toBe(false);
    let finish!: (value: { ok: true; text: string }) => void;
    __setResearchCompleterForTests(() => new Promise((resolve) => { finish = resolve; }));
    const running = researchSynth(synth, actor, { since: null });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(isResearchingSynth(synth.id)).toBe(true);
    finish({ ok: true, text: JSON.stringify(payload()) });
    const result = await running;
    expect(isResearchingSynth(synth.id)).toBe(false);
    expect(result).toMatchObject({ skipped: null });
  });

  test("first run stores sourced facts and views with confidence, and updates unpinned style", async () => {
    const { actor, synth } = await setup();
    const result = await researchSynth(synth, actor, { since: null });
    expect(result).toMatchObject({ facts: 3, views: 2, style: true, skipped: null });
    const beats = activeBeats(synth.id, actor);
    expect(beats.filter((r) => r.source.startsWith("talent.research:") && r.category === "event")).toHaveLength(3);
    expect(beats.filter((r) => r.source.startsWith("talent.research:") && r.category === "preference")).toHaveLength(2);
    expect(beats.find((r) => r.text === "She published a new public letter.")).toMatchObject({ fact_confidence: 0.91, confidence_evidence: [{ source_id: "https://example.org/news", kind: "corroboration" }] });
    expect(db.select().from(talentResearchRuns).where(eq(talentResearchRuns.synthId, synth.id)).all()).toHaveLength(1);
  });

  test("new fact with a corrected date supersedes its earlier memory", async () => {
    const { actor, synth } = await setup();
    await researchSynth(synth, actor, { since: null });
    db.delete(talentResearchRuns).where(eq(talentResearchRuns.synthId, synth.id)).run();
    __setResearchCompleterForTests(async () => ({ ok: true, text: JSON.stringify(payload({ facts: [{ date: "2026-10-04", text: "She published a new public letter.", source: "https://example.org/correction", confidence: 0.95 }], views: [], style: null })) }));
    await researchSynth(synth, actor, { since: "2026-10-03" });
    const versions = db.select().from(memoryRecords).where(eq(memoryRecords.text, "She published a new public letter.")).all();
    expect(versions.filter((r) => r.status === "active")).toHaveLength(1);
    expect(versions.filter((r) => r.status === "superseded")).toHaveLength(1);
  });

  test("a forgotten matching fact stays forgotten", async () => {
    const { actor, synth } = await setup();
    const saved = rememberBeat(synth.id, actor, { text: "She published a new public letter.", category: "event", tier: "durable", source: "talent.research:https://example.org/news", valid_from: "2026-10-01", fact_confidence: 0.5 });
    if (!saved.ok) throw new Error("The forgotten-fact fixture could not be saved. Check the memory schema.");
    expect(forgetByIds(actor, [saved.value.id])[0]?.deleted).toBe(true);
    await researchSynth(synth, actor, { since: null });
    expect(db.select().from(memoryRecords).where(eq(memoryRecords.source, "talent.research:https://example.org/news")).all()).toHaveLength(1);
  });

  test("pinned dial and phrase remain unchanged", async () => {
    const { actor, synth } = await setup();
    const pinned = updateSynth(actor, synth.id, { persona: { ...synth.persona, formality: "neutral", examples: ["I prefer my own phrase.", "A second private phrase.", "A third private phrase."] }, pins: { dials: ["formality"], examples: ["I prefer my own phrase."] } });
    if (!pinned.ok) throw new Error("The pinned synth fixture could not be saved. Check its persona.");
    await researchSynth(pinned.value.synth, actor, { since: null });
    const updated = (await import("@/lib/synths")).synthById(synth.id)!;
    expect(updated.persona.formality).toBe("neutral");
    expect(updated.persona.examples).toContain("I prefer my own phrase.");
  });

  test("web search off and household-member synths are skipped before reading", async () => {
    const { actor, synth } = await setup();
    let calls = 0;
    __setResearchSearchForTests(async () => { calls++; return { text: "", rows: [] }; });
    __setResearchSourcesForTests([]);
    expect(await researchSynth(synth, actor, { since: null })).toMatchObject({ skipped: "web search is off" });
    expect(calls).toBe(0);
    const invented = await createSynth(actor, { persona, based_on: { kind: "household_member", person_id: actor.id, name: null, refresh: "7d", minor: false }, life: { enabled: false, seed: "" } });
    if (!invented.ok) throw new Error("The household-member synth fixture could not be created. Check its base person.");
    __setResearchSourcesForTests(["searxng"]);
    expect(await researchSynth(invented.value.synth, actor, { since: null })).toMatchObject({ skipped: "synth is not based on a real person" });
  });

  test("forks are not researched and minor real-person permission stays age gated", async () => {
    const { client, row: actor } = await owner();
    const made = await createSynth(actor, { persona, based_on: basedOn, life: { enabled: false, seed: "" } });
    if (!made.ok) throw new Error("The research synth fixture could not be created. Check its persona and base figure.");
    const fork = forkSynth(actor, made.value.id);
    if (!fork.ok) throw new Error("The private research fork fixture could not be created. Check the base synth.");
    expect(await researchSynth(fork.value.synth, actor, { since: null })).toMatchObject({ skipped: "forks are not researched" });
    const { row: childRow } = await child(client);
    setValue(actor, `person:${childRow.id}`, "synths.real_people", "off");
    expect((await import("@/lib/synths")).getSynth(childRow, made.value.id)).toBeNull();
    expect(setValue(actor, `person:${childRow.id}`, "synths.real_people", "all")).toMatchObject({ ok: false, status: 400 });
    setValue(actor, `person:${childRow.id}`, "synths.real_people", "ask");
    setValue(actor, `person:${childRow.id}`, "synths.real_people_allowed", [made.value.id]);
    expect((await import("@/lib/synths")).getSynth(childRow, made.value.id)?.id).toBe(made.value.id);
    expect(forkSynth(childRow, made.value.id).ok).toBe(true);
    await teen(client);
    const teenRow = db.select().from(people).where(eq(people.role, "teen")).get()!;
    setValue(actor, `person:${teenRow.id}`, "synths.real_people", "all");
    expect((await import("@/lib/synths")).getSynth(teenRow, made.value.id)?.id).toBe(made.value.id);
  });

  test("the research prompt is the approved prompt", () => {
    expect(RESEARCH_PROMPT).toContain("Never copy more than one sentence from any page.");
  });

  test("a birth date showing the person is under 18 marks the base synth and its fork", async () => {
    const { actor, synth } = await setup();
    const fork = forkSynth(actor, synth.id);
    if (!fork.ok) throw new Error("The minor real-person fork fixture could not be created. Check the base synth.");
    __setResearchCompleterForTests(async () => ({ ok: true, text: JSON.stringify(payload({ facts: [{ date: "2015-03-04", text: "Ada was born on 2015-03-04.", source: "https://example.org/birth", confidence: 0.9 }], style: null, views: [] })) }));
    await researchSynth(synth, actor, { since: null });
    expect((await import("@/lib/synths")).synthById(synth.id)?.based_on.minor).toBe(true);
    expect((await import("@/lib/synths")).synthById(fork.value.id)?.based_on.minor).toBe(true);
    expect(activeBeats(fork.value.id, actor).some((beat) => beat.source.startsWith("talent.research"))).toBe(true);
  });

  test("every research fact is held to the synth's child floor", async () => {
    const { actor, synth } = await setup();
    __setResearchCompleterForTests(async () => ({ ok: true, text: JSON.stringify(payload({ facts: [
      { date: "2026-10-01", text: "A safe public update was released.", source: "https://example.org/safe", confidence: 0.9 },
      { date: "2026-10-02", text: "any l-o-l-i stuff", source: "https://example.org/unsafe", confidence: 0.9 },
    ], style: null, views: [] })) }));
    await researchSynth(synth, actor, { since: null });
    const texts = activeBeats(synth.id, actor).map((beat) => beat.text);
    expect(texts).toContain("A safe public update was released.");
    expect(texts).not.toContain("any l-o-l-i stuff");
  });

  test("logs only result counts and elapsed time", async () => {
    const { actor, synth } = await setup();
    const lines: string[] = [], original = console.log;
    console.log = (line?: unknown) => { lines.push(String(line)); };
    try { await researchSynth(synth, actor, { since: null }); } finally { console.log = original; }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^talent\.research facts=3 views=2 style=1 ms=\d+$/);
    expect(lines[0]).not.toContain(synth.id);
  });
});
