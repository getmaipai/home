import { describe, expect, test } from "bun:test";
import { timeLabel } from "./MusicStudioView";
import { compressBody, effectBody, eqBody, nextVersionId, previousVersionId, studioLanes } from "./musicStudioFx";
import { defaultEffects, makeSelection } from "@maipai/ui/src/elements/track-studio";
import type { MusicCard } from "@/lib/musicApi";

const card = (patch: Partial<MusicCard>): MusicCard => ({ state: "done", title: "Pancakes", current_id: "a", versions: [{ id: "a", label: "Version 1", url: "/a.m4a" }], ...patch }) as MusicCard;
type Lane = { id: string; pieces: { ref: string; src: string; in_s: number; out_s: number }[] };

describe("studioLanes", () => {
  test("the full song is the Music lane", () => {
    const lanes = studioLanes(card({}), undefined, 90) as Lane[];
    expect(lanes.map((l) => l.id)).toEqual(["music"]);
    expect(lanes[0]!.pieces[0]).toMatchObject({ ref: "a", src: "/a.m4a", in_s: 0, out_s: 90 });
  });
  test("the version on show is the card's current one", () => {
    const song = card({ current_id: "b", versions: [{ id: "a", label: "Version 1", url: "/a" }, { id: "b", label: "Version 2", url: "/b" }] });
    expect((studioLanes(song, undefined, 30) as Lane[])[0]!.pieces[0]!.src).toBe("/b");
  });
  test("a finished split adds one stem lane per stem, in the kit's ids", () => {
    const stems = card({ versions: [{ id: "v", label: "Vocals", url: "/v" }, { id: "d", label: "Drums", url: "/d" }, { id: "x", label: "Piano", url: "/x" }] });
    expect((studioLanes(card({}), stems, 60) as Lane[]).map((l) => l.id)).toEqual(["music", "stem-vocals", "stem-drums"]);
  });
  test("a split still being made adds nothing, and a song of unknown length has no lanes", () => {
    expect(studioLanes(card({}), card({ state: "running" }), 60).length).toBe(1);
    expect(studioLanes(card({}), undefined, 0)).toEqual([]);
  });
});

describe("effect requests", () => {
  const sel = makeSelection(10, 20, 100);
  test("a slider effect carries its amount, an effect on a selection carries the range", () => {
    expect(effectBody("gain", { amount: -6 }, sel)).toEqual({ change: "gain", amount: -6, from_s: 10, to_s: 20 });
    expect(effectBody("speed", {}, null)).toEqual({ change: "speed", amount: 1.25 });
    expect(effectBody("reverse", { amount: 9 }, null)).toEqual({ change: "reverse" });
    expect(effectBody("eq_preset", { preset: "bass_boost" }, null)).toEqual({ change: "eq", preset: "bass_boost" });
  });
  test("the EQ panel's six bands and the compressor panel's settings map to eq and compress", () => {
    const fx = { ...defaultEffects(), eq: [3, 0, 0, 0, -2, 0] };
    expect(eqBody(fx, null)).toEqual({ change: "eq", bands: [3, 0, 0, 0, -2, 0] });
    expect(compressBody({ ...fx, compressor: { threshold_db: -24, ratio: 4, attack_ms: 10, release_ms: 250, makeup_db: 3 } }, sel))
      .toEqual({ change: "compress", compressor: { threshold_db: -24, ratio: 4, attack_ms: 10, release_ms: 250, makeup_db: 3 }, from_s: 10, to_s: 20 });
  });
});

describe("Undo and Redo walk the versions", () => {
  const song = (current: string) => card({ current_id: current, versions: [{ id: "a", label: "1", url: "/a" }, { id: "b", label: "2", url: "/b" }, { id: "c", label: "3", url: "/c" }] });
  test("previous and next", () => {
    expect(previousVersionId(song("c"))).toBe("b"); expect(nextVersionId(song("c"))).toBeNull();
    expect(previousVersionId(song("a"))).toBeNull(); expect(nextVersionId(song("a"))).toBe("b");
    expect(previousVersionId(card({}))).toBeNull();
  });
});

test("timeLabel", () => { expect(timeLabel(125)).toBe("2:05"); });
