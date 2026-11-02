import { describe, expect, test } from "bun:test";
import { studioTracks, timeLabel } from "./MusicStudioView";
import { peaksOf } from "./MusicWaveform";
import type { MusicCard } from "@/lib/musicApi";

const card = (patch: Partial<MusicCard>): MusicCard => ({ state: "done", title: "Pancakes", current_id: "a", versions: [{ id: "a", label: "Version 1", url: "/a.mp3" }], ...patch }) as MusicCard;

describe("studioTracks", () => {
  test("the full song is the first row", () => {
    expect(studioTracks(card({}), undefined).map((t) => t.name)).toEqual(["Pancakes"]);
  });
  test("a finished split adds one row per stem, each with its own color", () => {
    const stems = card({ versions: [{ id: "v", label: "Vocals", url: "/v" }, { id: "d", label: "Drums", url: "/d" }] });
    const rows = studioTracks(card({}), stems);
    expect(rows.map((t) => t.name)).toEqual(["Pancakes", "Vocals", "Drums"]);
    expect(new Set(rows.map((t) => t.hue)).size).toBe(3);
  });
  test("a split still being made adds no rows", () => {
    expect(studioTracks(card({}), card({ state: "running" })).length).toBe(1);
  });
});

test("timeLabel and peaksOf", () => {
  expect(timeLabel(125)).toBe("2:05");
  const peaks = peaksOf(Float32Array.from([0, 0.5, -1, 0.25]), 2);
  expect(peaks).toEqual([0.5, 1]);
});
