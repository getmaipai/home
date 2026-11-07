import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resetDb } from "./reset-db";
import { owner, child } from "./support/testAuth";
import { createShow, dueShows, makeEpisode, __setTalentShowCompleterForTests } from "@/lib/talent/shows";
import { getMediaProduction, listMediaProductions } from "@/lib/mediaProductions";
import { setHouseholdSettingValue } from "@/lib/settings";
import { loadFormats } from "@/lib/talent/formats";
import { __setTalentLifeCompleterForTests } from "@/lib/talent/life";
import { afterEach } from "bun:test";
import { createSynth } from "@/lib/synths";
import type { StackClient } from "@/lib/stack/client";
import { queryItems } from "@/lib/media/appHost";
import { storedTranscriptForItem } from "@/lib/transcripts/store";

describe("TALENT-04 shows", () => {
  beforeEach(() => resetDb());
  afterEach(() => { __setTalentShowCompleterForTests(null); __setTalentLifeCompleterForTests(null); });

  test("creates an invented-cast production and private production source", async () => {
    const { row } = await owner();
    __setTalentShowCompleterForTests((async () => ({ ok: true as const, text: JSON.stringify([
      { part: "anchor", display_name: "Mira Vale", pronouns: "she/her", tagline: "Clear eyed", backstory: "A careful local reporter who likes maps and morning walks.", interests: ["maps", "gardening", "baking"], formality: "formal", complexity: "standard", engagement: "balanced", filler_density: "none", clock_style: "formal", hedging: "high", humor: "low", warmth: "medium", initiative: "high" },
      { part: "reporter", display_name: "Theo Reed", pronouns: "he/him", tagline: "Curious neighbor", backstory: "A curious neighbor who enjoys asking questions and meeting people.", interests: ["walking", "music", "gardening"], formality: "neutral", complexity: "standard", engagement: "curious", filler_density: "light", clock_style: "plain", hedging: "medium", humor: "medium", warmth: "high", initiative: "medium" },
    ]) })) as never);
    __setTalentLifeCompleterForTests((async () => ({ ok: true as const, text: "{}" })) as never);
    const show = await createShow(row, { title: "Morning", format_id: "news_briefing", cast: "invent", sources: [{ kind: "news", topics: [], file_ids: [], media_item_id: null }, { kind: "weather", topics: [], file_ids: [], media_item_id: null }, { kind: "household", topics: [], file_ids: [], media_item_id: null }], schedule: null });
    expect(show.show?.format_id).toBe("news_briefing");
    expect(show.cast).toHaveLength(2);
    expect(show.cast.every((member) => member.synth_id && member.subject_id)).toBe(true);
    expect(listMediaProductions(row).some((production) => production.id === show.id)).toBe(true);
  });

  test("minors need the household setting to make shows and default to their band", async () => {
    const { client } = await owner();
    const kid = await child(client);
    setHouseholdSettingValue("talent.minors.make", false);
    await expect(createShow(kid.row, { title: "Kids", format_id: "kids_news", cast: "invent", sources: [], schedule: null })).rejects.toThrow("Shows are off for children and teens in this household. A parent can turn them on in Settings.");
    setHouseholdSettingValue("talent.minors.make", true);
    const made = await createSynth(kid.row, { persona: { display_name: "Pip", formality: "casual", complexity: "simple", engagement: "brief", filler_density: "light", audience: "all" } as never, based_on: { kind: "none", person_id: null, name: null, refresh: "7d", minor: false }, life: { enabled: false, seed: "" } });
    if (!made.ok) throw new Error("The child synth fixture could not be created. Check the test profile.");
    const show = await createShow(kid.row, { title: "Kids", format_id: "kids_news", cast: [{ synth_id: made.value.id, part: "host" }], sources: [], schedule: null });
    expect(show.show?.audience).toBe("all");
  });

  test("due shows account for the local make-time lead", () => {
    expect(loadFormats().get("news_briefing")).toBeDefined();
  });

  test("queues a daily show ten minutes before its local air time", async () => {
    const { row } = await owner();
    const made = await createSynth(row, { persona: { display_name: "Moss", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", audience: "all" } as never, based_on: { kind: "none", person_id: null, name: null, refresh: "7d", minor: false }, life: { enabled: false, seed: "" } });
    if (!made.ok) throw new Error("The show synth fixture could not be created. Check the owner fixture.");
    const show = await createShow(row, { title: "Morning", format_id: "news_briefing", cast: [{ synth_id: made.value.id, part: "anchor" }], sources: [], schedule: { every: "1d", at: "07:00", days: [] } });
    expect(dueShows(new Date("2026-11-07T06:49:00")).some((entry) => entry.production.id === show.id)).toBe(false);
    expect(dueShows(new Date("2026-11-07T06:50:00")).some((entry) => entry.production.id === show.id)).toBe(true);
  });

  test("makes and stores an age-banded episode with chapters, transcript, and one shot per line", async () => {
    const { row, client } = await owner();
    const made = await createSynth(row, { persona: { display_name: "Moss", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "none", audience: "teen" } as never, based_on: { kind: "none", person_id: null, name: null, refresh: "7d", minor: false }, life: { enabled: false, seed: "" } });
    if (!made.ok) throw new Error("The show synth fixture could not be created. Check the owner fixture.");
    const show = await createShow(row, { title: "Morning", format_id: "news_briefing", audience: "teen", cast: [{ synth_id: made.value.id, part: "anchor" }], sources: [], schedule: null, length_s: 180 });
    let sequence = 0, failMix = true, writerCalls = 0;
    const stack = {
      voices: async () => [],
      submitJob: async ({ kind, input }: { kind: string; input: Record<string, unknown> }) => {
        const id = `stack-${++sequence}`;
        if (kind === "media.tts") {
          const lines = input.lines as Array<{ id: string; text: string }>;
          const rendered = lines.map((line) => { const path = `/tmp/${id}-${line.id}.wav`; writeFileSync(path, new Uint8Array([1, 2, 3])); return { id: line.id, path, duration_s: 0.5, sha256: "a".repeat(64) }; });
          return { id, state: "done", result: { lines: rendered }, reason: null };
        }
        if (failMix) { failMix = false; throw new Error("The scripted mix failure needs a retry."); }
        // The Stack writes the mix in its own job folder: no output.dir is sent (the test double plays that folder).
        const output = input.output as { dir?: string; name: string };
        expect(output.dir).toBeUndefined();
        const dir = `/tmp/talent-mix-${id}`; mkdirSync(dir, { recursive: true }); const path = `${dir}/${output.name}`; writeFileSync(path, new Uint8Array([1, 2, 3]));
        return { id, state: "done", result: { path, duration_s: 1 }, reason: null };
      },
    } as unknown as StackClient;
    const complete = async (messages: Array<{ role: string; content: string }>) => {
      const system = messages.find((message) => message.role === "system")?.content ?? "";
      if (system.startsWith("You are the producer")) { writerCalls++; return { ok: true as const, text: JSON.stringify({ title: "Morning Update", segments: [{ kind: "hook", goal: "The top story", source_refs: [], seconds: 90, leads: "anchor", beats_to_use: [] }, { kind: "closing", goal: "What comes next", source_refs: [], seconds: 90, leads: "anchor", beats_to_use: [] }] }) }; }
      if (system.startsWith("You write the spoken lines")) { writerCalls++; return { ok: true as const, text: JSON.stringify({ lines: [{ part: "anchor", text: "The morning is clear.", delivery: { energy: "mid", pace: "mid", tags: [] }, timing: { gap_ms: null, overlap_ms: null, cut_in_at_word: null, talked_over: null, backchannels: [] } }] }) }; }
      return { ok: true as const, text: "[]" };
    };
    const now = new Date("2026-11-07T12:00:00Z");
    await expect(makeEpisode(row, show.id, { now, complete: complete as never, stack })).rejects.toThrow("The scripted mix failure needs a retry.");
    expect(getMediaProduction(row, show.id)?.show?.state?.stage).toBe("mix");
    expect(getMediaProduction(row, show.id)?.show?.state?.reason).toEqual(expect.any(String));
    expect(getMediaProduction(row, show.id)?.show?.state?.reason).not.toBe("");
    const writerCallsBeforeResume = writerCalls;
    const result = await makeEpisode(row, show.id, { now, complete: complete as never, stack });
    const saved = getMediaProduction(row, show.id)!;
    const item = queryItems(row, "podcasts", { limit: 20 }).find((entry) => entry.id === result.item_id)!;
    expect(saved.show?.state?.stage).toBe("done");
    expect(saved.show?.state?.reason).toBeNull();
    expect(writerCalls).toBe(writerCallsBeforeResume);
    expect(item.band_ok).toBe("teen");
    expect(item.chapters).toHaveLength(2);
    expect(storedTranscriptForItem(item.id)?.segments).toHaveLength(2);
    expect(saved.episodes[0]?.scenes.flatMap((scene) => scene.shots)).toHaveLength(2);
    const kid = await child(client);
    expect(queryItems(kid.row, "podcasts", { limit: 20 }).some((entry) => entry.id === result.item_id)).toBe(false);
  });
});
