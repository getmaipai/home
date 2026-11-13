import { describe, expect, test } from "bun:test";
import { peaksUrlOf, pickNext, pickPrevious, queueFor, type Track } from "./musicQueue";
import { barsOf } from "./WaveformSeek";

const t = (key: string): Track => ({ key, url: `/a/${key}`, title: key });
const queue = ["a", "b", "c", "d"].map(t);
const off = { shuffle: false, repeat: "off" as const };

describe("pickNext", () => {
  test("walks the queue and ends at the last song", () => {
    expect(pickNext({ queue, index: 0, mode: off, played: new Set(), ended: true })).toBe(1);
    expect(pickNext({ queue, index: 3, mode: off, played: new Set(), ended: true })).toBeNull();
  });
  test("repeat all goes round; repeat one replays only when the song ended by itself", () => {
    expect(pickNext({ queue, index: 3, mode: { shuffle: false, repeat: "all" }, played: new Set(), ended: true })).toBe(0);
    expect(pickNext({ queue, index: 2, mode: { shuffle: false, repeat: "one" }, played: new Set(), ended: true })).toBe(2);
    expect(pickNext({ queue, index: 2, mode: { shuffle: false, repeat: "one" }, played: new Set(), ended: false })).toBe(3);
  });
  test("shuffle plays every song once, then stops or goes round", () => {
    const shuffle = { shuffle: true, repeat: "off" as const };
    const first = pickNext({ queue, index: 0, mode: shuffle, played: new Set(["a"]), ended: true, random: () => 0 });
    expect(first).toBe(1);
    expect(pickNext({ queue, index: 3, mode: shuffle, played: new Set(["a", "b", "c", "d"]), ended: true })).toBeNull();
    const again = pickNext({ queue, index: 3, mode: { shuffle: true, repeat: "all" }, played: new Set(["a", "b", "c", "d"]), ended: true, random: () => 0.99 });
    expect(again).not.toBe(3);
    expect(again).not.toBeNull();
  });
  test("an empty queue has no next", () => {
    expect(pickNext({ queue: [], index: -1, mode: off, played: new Set(), ended: false })).toBeNull();
  });
});

describe("pickPrevious", () => {
  test("restarts a song that has played a few seconds", () => {
    expect(pickPrevious({ queue, index: 2, mode: off, time: 4, history: [] })).toBe("restart");
  });
  test("goes back one, restarts at the first song, wraps with repeat", () => {
    expect(pickPrevious({ queue, index: 2, mode: off, time: 1, history: [] })).toBe(1);
    expect(pickPrevious({ queue, index: 0, mode: off, time: 1, history: [] })).toBe("restart");
    expect(pickPrevious({ queue, index: 0, mode: { shuffle: false, repeat: "all" }, time: 1, history: [] })).toBe(3);
  });
  test("with shuffle it goes back through what played", () => {
    expect(pickPrevious({ queue, index: 1, mode: { shuffle: true, repeat: "off" }, time: 0, history: ["a", "c"] })).toBe(2);
    expect(pickPrevious({ queue, index: 1, mode: { shuffle: true, repeat: "off" }, time: 0, history: [] })).toBe("restart");
  });
});

describe("queueFor and the waveform route", () => {
  test("a track outside the queue plays alone; repeats are dropped", () => {
    expect(queueFor(t("x"), queue).map((one) => one.key)).toEqual(["x"]);
    expect(queueFor(t("b"), [...queue, t("b")]).map((one) => one.key)).toEqual(["a", "b", "c", "d"]);
    expect(queueFor(t("b"), undefined).map((one) => one.key)).toEqual(["b"]);
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
