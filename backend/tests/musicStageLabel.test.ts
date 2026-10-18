// ISOLATION-01: the Stack reports stage "paused" for a song whose worker is stopped while chat is working;
// the song card says so through its existing stage line (rule S6, no new surface).
import { expect, test } from "bun:test";
import { musicStageLabel } from "@/routes/music";
import type { MusicJob } from "@/lib/music/types";

const job = (patch: Partial<MusicJob>): MusicJob => ({ state: "running", stage: "planning", position: null, ...patch }) as MusicJob;

test("a paused song says it is waiting for chat, and goes back to its stage afterwards", () => {
  expect(musicStageLabel(job({ stage: "paused" }))).toBe("Paused while chat is working");
  expect(musicStageLabel(job({ stage: "plan" }))).toBe("Making the song");
  expect(musicStageLabel(job({ stage: "planning" }))).toBe("Planning the song");
});
