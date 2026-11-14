import { describe, expect, test } from "bun:test";
import { canPlayMediaType, peaksUrlOf, pickNext, pickPrevious, queueFor, trackUnavailableLine, type Track } from "./musicQueue";
import { barsOf } from "./WaveformSeek";

const t = (key: string): Track => ({ key, url: `/a/${key}`, title: key, state: "done", hasFile: true, mediaType: "audio/mp4" });
const queue = ["a", "b", "c", "d"].map(t);
const off = { shuffle: false, repeat: "off" as const };
const playable = () => "probably";
const next = (args: Parameters<typeof pickNext>[0]) => pickNext({ ...args, canPlayType: playable });
const previous = (args: Parameters<typeof pickPrevious>[0]) => pickPrevious({ ...args, canPlayType: playable });

describe("pickNext", () => {
  test("walks the queue and ends at the last song", () => {
    expect(next({ queue, index: 0, mode: off, played: new Set(), ended: true })).toBe(1);
    expect(next({ queue, index: 3, mode: off, played: new Set(), ended: true })).toBeNull();
  });
  test("repeat all goes round; repeat one replays only when the song ended by itself", () => {
    expect(next({ queue, index: 3, mode: { shuffle: false, repeat: "all" }, played: new Set(), ended: true })).toBe(0);
    expect(next({ queue, index: 2, mode: { shuffle: false, repeat: "one" }, played: new Set(), ended: true })).toBe(2);
    expect(next({ queue, index: 2, mode: { shuffle: false, repeat: "one" }, played: new Set(), ended: false })).toBe(3);
  });
  test("shuffle plays every song once, then stops or goes round", () => {
    const shuffle = { shuffle: true, repeat: "off" as const };
    const first = next({ queue, index: 0, mode: shuffle, played: new Set(["a"]), ended: true, random: () => 0 });
    expect(first).toBe(1);
    expect(next({ queue, index: 3, mode: shuffle, played: new Set(["a", "b", "c", "d"]), ended: true })).toBeNull();
    const again = next({ queue, index: 3, mode: { shuffle: true, repeat: "all" }, played: new Set(["a", "b", "c", "d"]), ended: true, random: () => 0.99 });
    expect(again).not.toBe(3);
    expect(again).not.toBeNull();
  });
  test("an empty queue has no next", () => {
    expect(next({ queue: [], index: -1, mode: off, played: new Set(), ended: false })).toBeNull();
  });
  test("skips unfinished and missing files for Next and Previous", () => {
    const mixed = [t("a"), { ...t("b"), state: "running" as const }, { ...t("c"), hasFile: false }, t("d")];
    expect(pickNext({ queue: mixed, index: 0, mode: off, played: new Set(), ended: false, canPlayType: playable })).toBe(3);
    expect(pickNext({ queue: mixed, index: 0, mode: off, played: new Set(["a"]), ended: true, canPlayType: playable })).toBe(3);
    expect(pickPrevious({ queue: mixed, index: 3, mode: off, time: 0, history: [], canPlayType: playable })).toBe(0);
  });
  test("shuffle never chooses an unplayable item and a browser refusal is skipped", () => {
    const mixed = [t("a"), { ...t("b"), mediaType: "audio/flac" }, t("c")];
    expect(pickNext({ queue: mixed, index: 0, mode: { shuffle: true, repeat: "off" }, played: new Set(["a"]), ended: false, random: () => 0, canPlayType: playable })).toBe(2);
    expect(pickNext({ queue: mixed, index: 0, mode: off, played: new Set(), ended: false, canPlayType: () => "" })).toBeNull();
    expect(canPlayMediaType("audio/mp4", (type) => type.includes("mp4") ? "maybe" : "")).toBe(true);
    expect(canPlayMediaType("audio/mp4", () => "no")).toBe(false);
  });
  test("all unplayable items have no next target and a plain status line", () => {
    const notReady = { ...t("b"), state: "running" as const };
    expect(pickNext({ queue: [notReady], index: 0, mode: off, played: new Set(), ended: false, canPlayType: playable })).toBeNull();
    expect(trackUnavailableLine(notReady, playable)).toBe("Still being made.");
    expect(trackUnavailableLine({ ...t("c"), hasFile: false }, playable)).toBe("This song's file is missing. Make it again.");
    expect(trackUnavailableLine({ ...t("d"), mediaType: "audio/flac" }, playable)).toBe("This file type cannot play in this browser.");
  });
});

describe("pickPrevious", () => {
  test("restarts a song that has played a few seconds", () => {
    expect(previous({ queue, index: 2, mode: off, time: 4, history: [] })).toBe("restart");
  });
  test("goes back one, restarts at the first song, wraps with repeat", () => {
    expect(previous({ queue, index: 2, mode: off, time: 1, history: [] })).toBe(1);
    expect(previous({ queue, index: 0, mode: off, time: 1, history: [] })).toBe("restart");
    expect(previous({ queue, index: 0, mode: { shuffle: false, repeat: "all" }, time: 1, history: [] })).toBe(3);
  });
  test("with shuffle it goes back through what played", () => {
    expect(previous({ queue, index: 1, mode: { shuffle: true, repeat: "off" }, time: 0, history: ["a", "c"] })).toBe(2);
    expect(previous({ queue, index: 1, mode: { shuffle: true, repeat: "off" }, time: 0, history: [] })).toBe("restart");
  });
});

describe("queueFor and the waveform route", () => {
  test("a track outside the queue plays alone; repeats are dropped", () => {
    expect(queueFor(t("x"), queue, playable).map((one) => one.key)).toEqual(["x"]);
    expect(queueFor(t("b"), [...queue, t("b")], playable).map((one) => one.key)).toEqual(["a", "b", "c", "d"]);
    expect(queueFor(t("b"), undefined, playable).map((one) => one.key)).toEqual(["b"]);
  });
  test("peaks route names the job and the file; a sound has none", () => {
    expect(peaksUrlOf({ jobId: "j1", key: "f 1" })).toBe("/api/music/jobs/j1/files/f%201/peaks");
    expect(peaksUrlOf({ key: "sound-1" })).toBeNull();
  });
  test("bars keep the loudest value of each slice", () => {
    expect(barsOf([0.1, 0.9, 0.2, 0.3], 2)).toEqual([0.9, 0.3]);
    expect(barsOf(null, 4)).toBeNull();
    expect(barsOf([0.5], 4)).toBeNull();
  });
});
