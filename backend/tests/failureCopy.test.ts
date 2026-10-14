import { expect, test } from "bun:test";
import { VOICE_FAILURE_COPY, voiceFailureLine } from "@/lib/failureCopy";

test("a minor sees the short grown-up line and an adult without Repairs access is not told to open Repairs", () => {
  expect(voiceFailureLine("listening_engine", { minor: true, canOpenRepairs: true })).toBe("I can't hear you right now. Please tell a grown-up.");
  expect(voiceFailureLine("listening_engine", { minor: false, canOpenRepairs: false })).toBe("Home can't hear you right now because its listening engine is not running. Type your message instead, or ask an owner or admin to check it.");
});

test("no copy string in the new table contains an em dash", () => {
  expect(Object.values(VOICE_FAILURE_COPY).flatMap((copy) => Object.values(copy)).every((line) => !line.includes("—"))).toBe(true);
});
