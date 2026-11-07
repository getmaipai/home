import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { owner, child } from "./support/testAuth";
import { createSynth, type SynthRecord } from "@/lib/synths";
import { rememberBeat } from "@/lib/talent/life";
import { buildBrief } from "@/lib/talent/brief";
import { loadFormats } from "@/lib/talent/formats";
import { LineSchema, type Brief, type Line } from "@/lib/talent/types";
import { TalentWriteError, checkLines, writeOutline, writeSegment, __setTalentWriterSafetyForTests, __setTalentWriterMinorCheckForTests } from "@/lib/talent/writer";
import type { Production } from "@/lib/mediaProductions";
import { resetNewsState, seedFeeds, putItem, installNewsApp } from "./support/newsFixture";
import { sharedShelfStore } from "@/lib/shelf/shelfStore";
import { setHouseholdSettingValue } from "@/lib/settings";
import { db } from "@/db";
import { newsStorySummaries } from "@/db/schema";
import { storyIdOf } from "@/lib/news/cards";
import { nextHlc } from "@/lib/hlc";
import { __setOfferedVoicesForTests } from "@/lib/voiceResolve";
import { createList } from "@/lib/lists";

const persona = { display_name: "Moss", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", audience: "all" } as const;
const outline = (values: number[]) => ({ title: "Morning Update", segments: values.map((seconds, i) => ({ kind: i === 0 ? "hook" : i === values.length - 1 ? "closing" : "segment", goal: `Segment ${i + 1}`, source_refs: [], seconds, leads: "anchor", beats_to_use: [] })) });
const line = (text: string, cut: number | null = null): Line => ({ part: "anchor", text, delivery: { energy: "mid", pace: "mid", tags: [] }, timing: { gap_ms: null, overlap_ms: null, cut_in_at_word: cut, talked_over: null, backchannels: [] } });
let actor: Awaited<ReturnType<typeof owner>>["row"];
let ownerClient: Awaited<ReturnType<typeof owner>>["client"];
let synth: SynthRecord;

beforeEach(async () => {
  resetDb(); resetNewsState(); installNewsApp();
  const result = await owner(); actor = result.row; ownerClient = result.client;
  createList(actor, { kind: "shopping", scope: "household" });
  const made = await createSynth(actor, { persona, based_on: { kind: "none", person_id: null, name: null, refresh: "7d", minor: false }, life: { enabled: false, seed: "" } });
  if (!made.ok) throw new Error("The test synth could not be created. Check the synth fixture.");
  synth = made.value.synth;
  __setOfferedVoicesForTests([{ id: "alloy", name: "Alloy", source: "preset" } as never]);
  __setTalentWriterSafetyForTests(null);
  __setTalentWriterMinorCheckForTests(null);
});

describe("TALENT-02 formats and writer", () => {
  test("loads all nine formats and validates each against the pinned spec", () => {
    const formats = loadFormats();
    expect(formats.size).toBe(9);
    for (const format of formats.values()) { expect(format.id.length).toBeGreaterThan(0); expect(format.parts.length).toBeGreaterThan(0); expect(format.structure.length).toBeGreaterThan(0); }
  });

  test("builds a news briefing from released shelf stories with points", async () => {
    const feeds = seedFeeds();
    setHouseholdSettingValue("news.lists.child", ["feeds-children"]);
    const stories = [0, 1, 2].map((i) => putItem(feeds.kids, "https://kids.example.test", { title: `Story ${i}`, summary: `Summary ${i}`, topics: ["local"] }));
    for (const story of stories) db.insert(newsStorySummaries).values({ storyId: storyIdOf(story), band: "child", summary: JSON.stringify({ intro: "The garden opened today.", points: ["Volunteers planted trees.", "Paths are ready.", "Families can visit."] }), updatedAt: new Date().toISOString(), hlc: nextHlc(), provenance: "test" }).run();
    setHouseholdSettingValue("news.shelf.enabled", true);
    const show = makeShow(synth.id);
    const brief = await buildBrief(actor, show, loadFormats().get("news_briefing")!);
    expect(brief.stories).toHaveLength(3);
    expect(brief.stories.every((story) => story.points.length > 0)).toBe(true);
  });

  test("accepts an in-range outline and repairs an out-of-range one once", async () => {
    const brief = minimalBrief(); let calls = 0;
    const repaired = async () => ({ ok: true as const, text: JSON.stringify(++calls === 1 ? outline([250, 250]) : outline([150, 150])) });
    await expect(writeOutline(brief, repaired as never)).resolves.toMatchObject({ segments: expect.any(Array) });
    expect(calls).toBe(2);
    calls = 0;
    const stillBad = async () => ({ ok: true as const, text: JSON.stringify(++calls === 1 ? outline([250, 250]) : outline([250, 250])) });
    await expect(writeOutline(brief, stillBad as never)).rejects.toBeInstanceOf(TalentWriteError);
    expect(calls).toBe(2);
  });

  test("validates segment lines against LineSchema", async () => {
    const brief = minimalBrief();
    const complete = async () => ({ ok: true as const, text: JSON.stringify({ lines: [line("The park opened today.")] }) });
    const lines = await writeSegment(brief, outline([150, 150]) as never, 0, complete as never);
    expect(LineSchema.array().parse(lines)).toHaveLength(1);
  });

  test("cuts refused child lines and clears a dependent cut-in", () => {
    __setTalentWriterSafetyForTests((reply) => ({ text: { action: reply.text === "Refused line." ? "refuse" : "allow", categories: [], flagged: false, matched_signals: [], notify_parent: false }, effective: { action: reply.text === "Refused line." ? "refuse" : "allow", categories: [], flagged: false, matched_signals: [], notify_parent: false } } as never));
    const result = checkLines([line("Refused line.", 2), line("Next line.", 4)], "child", { minorInCast: false });
    expect(result.cut).toBeGreaterThanOrEqual(0);
    expect(result.kept[0]?.timing.cut_in_at_word).toBeNull();
  });

  test("puts an active absence in the brief and writer context", async () => {
    const today = new Date().toISOString().slice(0, 10);
    rememberBeat(synth.id, actor, { text: "Moss is away this week.", category: "state", tier: "episodic", source: "talent.life.absence", valid_from: today, valid_to: today });
    const brief = await buildBrief(actor, makeShow(synth.id), loadFormats().get("news_briefing")!);
    expect(brief.cast[0]?.absent).toMatchObject({ text: "Moss is away this week." });
    let prompt = "";
    await writeOutline(brief, (async (messages: Array<{content:string}>) => { prompt = messages.map((m) => m.content).join("\n"); return { ok: true as const, text: JSON.stringify(outline([150, 150])) }; }) as never);
    expect(prompt).toContain("absent:");
  });

  test("keeps private list data out of a shared show brief", async () => {
    const own = await buildBrief(actor, makeShow(synth.id), loadFormats().get("news_briefing")!);
    const shared = await buildBrief(actor, makeShow(synth.id, ["someone-else"]), loadFormats().get("news_briefing")!);
    expect(JSON.stringify(shared.household)).not.toContain("Shopping List");
    expect(JSON.stringify(own.household)).toContain("Shopping List");
  });

  test("uses the child floor and minor-specific check for an adult show", async () => {
    const kid = await child(ownerClient);
    const minorBased = await createSynth(actor, { persona, based_on: { kind: "household_member", person_id: kid.row.id, name: null, refresh: "7d", minor: false }, life: { enabled: false, seed: "" } });
    if (!minorBased.ok) throw new Error("The minor synth fixture could not be created. Check the household member fixture.");
    const minorBrief = await buildBrief(actor, makeShow(minorBased.value.id, [], "adult"), loadFormats().get("news_briefing")!);
    expect(minorBrief.cast[0]?.minor).toBe(true);
    __setTalentWriterMinorCheckForTests((text) => text === "A sexual line.");
    const outcome = checkLines([line("A sexual line."), line("A violent news report.")], "adult", { minorInCast: minorBrief.cast.some((member) => member.minor) });
    expect(outcome.kept.map((entry) => entry.text)).toEqual(["A violent news report."]);
  });

  test("a show for everyone lowers the format's talk_over one step; a teen show only tames heated", async () => {
    const debate = loadFormats().get("debate")!;
    expect((await buildBrief(actor, makeShow(synth.id), debate)).format.talk_over).toBe("lively");
    expect((await buildBrief(actor, makeShow(synth.id, [], "teen"), debate)).format.talk_over).toBe("lively");
    expect((await buildBrief(actor, makeShow(synth.id, [], "adult"), debate)).format.talk_over).toBe("heated");
    expect((await buildBrief(actor, makeShow(synth.id), loadFormats().get("round_table")!)).format.talk_over).toBe("light");
  });
});

function makeShow(synthId: string, sharedTo: string[] = [], audience: "all" | "teen" | "adult" = "all"): Production {
  return { id: "show-test", title: "Morning", summary: "", owner_person_id: actor.id, shared_to: sharedTo, cast: [{ subject_id: "subject", role: "anchor", wardrobe_variant_ids: [], voice_choice: null, notes: "", synth_id: synthId, part: "anchor" }], sets: [], props: [], episodes: [], clip_file_ids: [], picture_file_ids: [], music_line_ids: [], voice_line_ids: [], finished_cut_file_ids: [], show: { format_id: "news_briefing", audience, household_facts: true, sources: [{ kind: "news", topics: [], file_ids: [], media_item_id: null }, { kind: "household", topics: [], file_ids: [], media_item_id: null }], schedule: null, length_s: 300, talk_over: "none", state: {} } as never, provenance: "test", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), hlc: "1:1:abcdef" };
}
function minimalBrief(): Brief {
  const format = loadFormats().get("news_briefing")!;
  return { show: makeShow(synth.id), format, cast: [{ synth_id: synth.id, part: "anchor", display_name: "Moss", persona: {} as never, voice: "alloy", minor: false, absent: null }], audience: "child", date: "2026-11-07", weekday: "Sat", air_time: "9:00", stories: [], weather: null, household: [], documents: [], item: null, cards: {}, beats: {}, recaps: [], person_name: actor.displayName };
}
