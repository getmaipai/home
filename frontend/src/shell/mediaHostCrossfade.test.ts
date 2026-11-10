// MEDIA-PARITY-02: a second element primed for the next song is the one the host holds for it, so the song carries on without a restart.
import { expect, test } from "bun:test";
import { createMediaStore } from "./mediaHost";
import { EQ_PRESETS, eqPresetOf, getEqPreset } from "@/lib/media/audioGraph";
import { chooseEqPreset, getEqPresetChoice, seedEqPreset, setEqWriter } from "@/shell/media/eqPreset";

const song = (id: string) => ({ id, src: `/${id}.mp3`, kind: "audio" as const, title: id });

test("elementFor takes the primed element for that song and drops the old one", () => {
  const store = createMediaStore();
  const old = store.elementFor(song("a"), "music");
  const second = document.createElement("audio");
  second.setAttribute("src", "/b.mp3");
  store.prime({ id: "b", src: "/b.mp3" }, second);
  const taken = store.elementFor(song("b"), "music");
  expect(taken).toBe(second);
  expect(store.get()?.el).toBe(second);
  expect(old.hasAttribute("src")).toBe(false);
  expect(second.getAttribute("src")).toBe("/b.mp3");
});

test("a primed element for another song is dropped, and an unprimed one is released", () => {
  const store = createMediaStore();
  store.elementFor(song("a"), "music");
  const second = document.createElement("audio");
  second.setAttribute("src", "/b.mp3");
  store.prime({ id: "b", src: "/b.mp3" }, second);
  const other = store.elementFor(song("c"), "music");
  expect(other).not.toBe(second);
  expect(second.hasAttribute("src")).toBe(false);
  const third = document.createElement("audio");
  third.setAttribute("src", "/d.mp3");
  store.prime({ id: "d", src: "/d.mp3" }, third);
  store.unprime(third);
  expect(third.hasAttribute("src")).toBe(false);
});

test("the Equalizer presets are flat, bass, treble and vocal; the choice applies and is saved once", () => {
  expect(Object.keys(EQ_PRESETS)).toEqual(["flat", "bass", "treble", "vocal"]);
  expect(EQ_PRESETS.flat).toEqual([0, 0, 0]);
  expect(eqPresetOf("treble")).toBe("treble");
  expect(eqPresetOf("loud")).toBe("flat");
  const saved: string[] = [];
  setEqWriter((preset) => saved.push(preset));
  seedEqPreset("vocal");
  expect(getEqPresetChoice()).toBe("vocal");
  expect(getEqPreset()).toBe("vocal");
  expect(saved).toEqual([]);
  chooseEqPreset("bass");
  expect(getEqPreset()).toBe("bass");
  expect(saved).toEqual(["bass"]);
  seedEqPreset("nonsense");
  expect(getEqPresetChoice()).toBe("flat");
  setEqWriter(null);
});
