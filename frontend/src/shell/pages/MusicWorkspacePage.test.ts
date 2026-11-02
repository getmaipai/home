import { describe, expect, test } from "bun:test";
import { songLine } from "./MusicWorkspacePage";
import type { MusicCard } from "@/lib/musicApi";

const card = (patch: Partial<MusicCard>): MusicCard => ({ state: "done", stage_label: "", progress: 0, position: null, error_line: null, description: null, ...patch }) as MusicCard;

describe("songLine", () => {
  test("a song being made shows its stage and percent", () => {
    expect(songLine(card({ state: "running", stage_label: "Writing the music", progress: 0.4 }))).toBe("Writing the music 40%");
  });
  test("a queued song says where it waits", () => {
    expect(songLine(card({ state: "queued", position: 2 }))).toBe("Waiting, number 2 in line");
  });
  test("a failed song says what to do, a finished one shows its sound", () => {
    expect(songLine(card({ state: "failed" }))).toContain("Open it to try again");
    expect(songLine(card({ description: "warm indie pop" }))).toBe("warm indie pop");
  });
});
