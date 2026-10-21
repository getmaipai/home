// ISOLATION-01: the Stack reports stage "paused" for a song whose worker is stopped while chat is working;
// the song card says so through its existing stage line (rule S6, no new surface).
import { expect, test } from "bun:test";
import { musicStageLabel } from "@/routes/music";
import type { MusicJob } from "@/lib/music/types";

const job = (patch: Partial<MusicJob>): MusicJob => ({ state: "running", stage: "planning", position: null, ...patch }) as MusicJob;

test("the Stack's known stages have plain, distinct labels without repeating the kit heading", () => {
  const labels = [
    musicStageLabel(job({ stage: "loading" })), musicStageLabel(job({ stage: "planning" })),
    musicStageLabel(job({ stage: "making" })), musicStageLabel(job({ stage: "mixing" })),
    musicStageLabel(job({ stage: "decoding" })), musicStageLabel(job({ stage: "paused" })),
  ];
  expect(labels.every(Boolean)).toBe(true);
  expect(new Set(labels).size).toBe(labels.length);
  expect(labels).not.toContain("Making your song");
  expect(musicStageLabel(job({ stage: "lm" }))).toBe("Planning the song");
  expect(musicStageLabel(job({ stage: "dit" }))).toBe("Making the music");
  expect(musicStageLabel(job({ stage: "vae" }))).toBe("Mixing");
  expect(musicStageLabel(job({ stage: "mixing" }))).toBe("Finishing");
  expect(musicStageLabel(job({ stage: "encoding" }))).toBe("Finishing");
  expect(musicStageLabel(job({ state: "queued", stage: "queued", position: 2 }))).toContain("number 2 in line");
  expect(musicStageLabel(job({ state: "queued", stage: "longer" }))).toBe("Making it longer so every line fits");
});

test("unknown, missing and completed stages do not show a fallback label", () => {
  const warn = console.warn; const warnings: string[] = [];
  console.warn = (message?: unknown) => { warnings.push(String(message)); };
  try {
    expect(musicStageLabel(job({ stage: "plan" }))).toBe("");
    expect(musicStageLabel(job({ stage: "plan" }))).toBe("");
    expect(musicStageLabel(job({ stage: null }))).toBe("");
    expect(musicStageLabel(job({ stage: undefined }))).toBe("");
    expect(musicStageLabel(job({ state: "done", stage: "ready" }))).toBe("");
    expect(warnings.filter((line) => line.includes("plan"))).toHaveLength(1);
  } finally { console.warn = warn; }
});
