import { expect, test } from "bun:test";
import { FAILURE_COPY, VOICE_FAILURE_COPY, composerNotice, makingNotice, voiceFailureLine, type ChatPauseCause, type MakingCause } from "@/lib/failureCopy";

test("a minor sees the short grown-up line and an adult without Repairs access is not told to open Repairs", () => {
  expect(voiceFailureLine("listening_engine", { minor: true, canOpenRepairs: true })).toBe("I can't hear you right now. Please tell a grown-up.");
  expect(voiceFailureLine("listening_engine", { minor: false, canOpenRepairs: false })).toBe("Home can't hear you right now. Type your message instead, or ask an owner or admin to check it.");
});

test("no copy string in the new table contains an em dash", () => {
  expect(Object.values(VOICE_FAILURE_COPY).flatMap((copy) => Object.values(copy)).every((line) => !line.includes("—"))).toBe(true);
});

// Owner rule (2026-11-01, "No resource words for users"): a person who is not an admin never reads memory, RAM, sizes, room, engine,
// busy, bigger or better in a status line. They are told what to expect ("Waiting for its turn").
const RESOURCE_WORDS = /\b(memory|RAM|GB|MB|room|engine|engines|busy|bigger|better)\b/i;
test("no line a non-admin can see names a resource or the engine", () => {
  const lines: string[] = [];
  const causes: ChatPauseCause[] = ["restarting", "memory", "not_installed", "mode_change", "reduced_swap", "paused_by_admin", "offline", "gpu"];
  for (const availability of ["starting", "unavailable"] as const) {
    for (const cause of [null, ...causes]) {
      const n = composerNotice(availability, cause);
      if (n) lines.push(n.adult, n.teen, n.child, ...(n.more ? [n.more] : []));
    }
  }
  const making: Array<MakingCause | null> = [null, "restarting", "memory", "not_installed", "mode_change", "offline", "gpu"];
  for (const kind of ["image", "video"] as const) {
    for (const availability of ["starting", "unavailable"] as const) {
      for (const cause of making) {
        const n = makingNotice(kind, availability, cause);
        if (n) lines.push(n.adult, n.teen, n.child, ...(n.more ? [n.more] : []));
      }
    }
  }
  for (const copy of Object.values(FAILURE_COPY)) lines.push(copy.adult, copy.minor);
  for (const copy of Object.values(VOICE_FAILURE_COPY)) lines.push(copy.adult, copy.adultNoRepairs, copy.minor);
  expect(lines.length).toBeGreaterThan(60);
  expect(lines.filter((line) => RESOURCE_WORDS.test(line))).toEqual([]);
  expect(lines.filter((line) => line.includes("${"))).toEqual([]);
});
