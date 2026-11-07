import { expect, jest, test } from "bun:test";
import { createMediaStore } from "./mediaHost";

const station = { id: "station-1", src: "/api/plugins/music/radio/stream/station-1", kind: "audio" as const, title: "Cabin FM" };

test("closing a playing station pauses it, clears the source and drops the now playing item", () => {
  const store = createMediaStore();
  const el = store.elementFor(station, "music");
  store.clear();
  expect(store.get()).toBeNull();
  expect(el.hasAttribute("src")).toBe(false);
  expect(el.paused).toBe(true);
});

test("clear pauses the held audio element and empties current", () => {
  const store = createMediaStore();
  const el = store.elementFor({ ...station, src: "/audio.mp3" }, "music") as HTMLAudioElement;
  const pause = jest.spyOn(el, "pause");
  store.clear();
  expect(pause).toHaveBeenCalledTimes(1);
  expect(store.get()).toBeNull();
});

test("playback reflects and observes the held element", async () => {
  const store = createMediaStore();
  const el = store.elementFor({ ...station, id: "a", src: "/audio.mp3" }, "music");
  Object.defineProperty(el, "paused", { configurable: true, value: false });
  expect(store.playback.isPlaying("a")).toBe(true);
  expect(store.playback.isPlaying("b")).toBe(false);
  const pause = jest.spyOn(el, "pause");
  const listener = jest.fn();
  const unsubscribe = store.playback.subscribe(listener);
  store.playback.pause("a");
  expect(pause).toHaveBeenCalledTimes(1);
  el.dispatchEvent(new Event("pause"));
  await Promise.resolve();
  expect(listener).toHaveBeenCalled();
  unsubscribe();
  store.clear();
});

test("the page that still shows the closed station cannot start it again", () => {
  const store = createMediaStore();
  store.elementFor(station, "music");
  store.clear();
  // The station page renders again after Close and asks the host for the same element.
  const again = store.elementFor(station, "music");
  expect(again.autoplay).toBe(false);
  store.clear();
});

test("pressing Play on the closed station starts it again", () => {
  const store = createMediaStore();
  store.elementFor(station, "music");
  store.clear();
  store.allowAutoplay(station.id);
  expect(store.elementFor(station, "music").autoplay).toBe(true);
  store.clear();
});

test("a different item after a close still autoplays, and so does the closed one once something else played", () => {
  const store = createMediaStore();
  store.elementFor(station, "music");
  store.clear();
  const other = store.elementFor({ ...station, id: "station-2", src: "/api/plugins/music/radio/stream/station-2" }, "music");
  expect(other.autoplay).toBe(true);
  store.clear();
  expect(store.elementFor(station, "music").autoplay).toBe(true);
  store.clear();
});

test("a live station's bar opens at once, before any sound", () => {
  const store = createMediaStore();
  store.elementFor(station, "music");
  expect(store.get()?.started).toBe(true);
  store.clear();
  // After a close, the page that re-asks for it does not reopen the bar.
  store.elementFor(station, "music");
  expect(store.get()?.started).toBe(false);
  store.clear();
});
