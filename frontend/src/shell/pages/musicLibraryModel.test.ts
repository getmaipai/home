import { describe, expect, test } from "bun:test";
import { clockOf, isLockedTile, libraryRows, playableVersion, styleTags, takeStrip } from "./musicLibraryModel";
import type { MusicCard, SavedSound } from "@/lib/musicApi";

const card = (patch: Partial<MusicCard>): MusicCard => ({ id: "a", state: "done", title: "Neon Rain", description: "dreamy indie pop, female vocal", versions: [], current_id: null, takes: null, sound: null, ...patch }) as MusicCard;
const sound = (patch: Partial<SavedSound>): SavedSound => ({ id: "s1", title: "Door creak", duration_s: 3, src: "/s", loop: false, ...patch });

describe("clockOf", () => {
  test("shows minutes and padded seconds, and nothing for an unknown length", () => {
    expect(clockOf(187)).toBe("3:07");
    expect(clockOf(59.6)).toBe("1:00");
    expect(clockOf(null)).toBe("");
    expect(clockOf(0)).toBe("");
  });
});

describe("styleTags", () => {
  test("splits the style line, trims, drops repeats and empties, and caps the count", () => {
    expect(styleTags(" Indie pop,  dreamy ,, indie POP; warm\nlo-fi")).toEqual(["Indie pop", "dreamy", "warm", "lo-fi"]);
    expect(styleTags("a, b, c, d", 2)).toEqual(["a", "b"]);
    expect(styleTags(null)).toEqual([]);
  });
});

describe("takeStrip and playableVersion", () => {
  const takes = card({ takes: { group: "g", index: 0, total: 3 }, current_id: "v2", versions: [{ id: "v1", label: "Take 1", url: "/1", seed: 11 }, { id: "v2", label: "Take 2", url: "/2", seed: 22 }, { id: "v3", label: "Take 3", url: "/3" }] });
  test("a song asked for as takes gives one chip per take with its seed", () => {
    expect(takeStrip(takes).map((one) => [one.number, one.label, one.seed])).toEqual([[1, "Take 1", 11], [2, "Take 2", 22], [3, "Take 3", null]]);
  });
  test("a song with one version, or versions that are not takes, has no strip", () => {
    expect(takeStrip(card({ versions: [{ id: "v1", label: "Version 1", url: "/1" }, { id: "v2", label: "Version 2", url: "/2" }] }))).toEqual([]);
    expect(takeStrip(card({ takes: { group: "g", index: 0, total: 1 }, versions: [{ id: "v1", label: "Take 1", url: "/1" }] }))).toEqual([]);
  });
  test("a row plays the chosen take, else the current version, else the newest", () => {
    expect(playableVersion(takes, "v3")?.id).toBe("v3");
    expect(playableVersion(takes)?.id).toBe("v2");
    expect(playableVersion(takes, "gone")?.id).toBe("v2");
    expect(playableVersion({ ...takes, current_id: null })?.id).toBe("v3");
    expect(playableVersion(card({}))).toBeUndefined();
  });
});

describe("libraryRows", () => {
  const cards = [card({ id: "a" }), card({ id: "b", title: "Harbor Lights", description: "cinematic score" }), { locked: true, making: false } as unknown as MusicCard];
  const sounds = [sound({}), sound({ id: "s2", title: "Rain on glass" })];
  test("All lists the songs, then the sounds, and never the locked tile", () => {
    expect(libraryRows(cards, sounds, "all", "").map((row) => row.key)).toEqual(["a", "b", "sound-s1", "sound-s2"]);
    expect(isLockedTile(cards[2])).toBe(true);
  });
  test("the Songs and Sounds chips each keep their own kind", () => {
    expect(libraryRows(cards, sounds, "songs", "").every((row) => row.kind === "song")).toBe(true);
    expect(libraryRows(cards, sounds, "sounds", "").map((row) => row.key)).toEqual(["sound-s1", "sound-s2"]);
  });
  test("search matches the title or the style line, ignoring case and spacing", () => {
    expect(libraryRows(cards, sounds, "all", "  CINEMATIC ").map((row) => row.key)).toEqual(["b"]);
    expect(libraryRows(cards, sounds, "all", "rain").map((row) => row.key)).toEqual(["a", "sound-s2"]);
    expect(libraryRows(cards, sounds, "all", "nothing like this")).toEqual([]);
  });
});
