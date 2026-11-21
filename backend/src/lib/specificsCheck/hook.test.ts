import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../../../tests/reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetSpecificsCheckCountersForTests, specificsCheckCounters } from "./counters";
import { __setSpecificsCheckRunnerForTests, checkReleasedSpecifics } from "./hook";

const actor = (role: string) => ({ id: "person-1", role } as never);
const state = (role = "adult", extra: Record<string, unknown> = {}) => ({
  surface: "chat", actor: actor(role), speakerEvidence: null, outcomes: [], memoryTrace: undefined, ...extra,
} as never);

beforeEach(() => { resetDb(); __resetSpecificsCheckCountersForTests(); __setSpecificsCheckRunnerForTests(async () => "flagged"); });

describe("released specifics hook", () => {
  test("checks an adult fact cue with no outcomes when shadow is on", async () => {
    let calls = 0;
    __setSpecificsCheckRunnerForTests(async (input) => { calls++; expect(input.question).toBe("question"); expect(input.memoryInjected).toBe(false); return "flagged"; });
    await checkReleasedSpecifics(state(), "question", "It happened in 1998.");
    expect(calls).toBe(1);
    expect(specificsCheckCounters()).toEqual({ "specifics_check.checked": 1, "specifics_check.flagged": 1 });
  });
  test("does not call for outcomes, no cue, setting off, child, teen, unknown speaker, or robot", async () => {
    let calls = 0;
    __setSpecificsCheckRunnerForTests(async () => { calls++; return "clear"; });
    await checkReleasedSpecifics(state(), "q", "The answer is generally known.");
    await checkReleasedSpecifics({ ...(state() as object), outcomes: [{}] } as never, "q", "1998");
    await checkReleasedSpecifics(state("adult", { surface: "chat", speakerEvidence: { person: "someone-else", level: "unknown", basis: "unknown" } }), "q", "1998");
    await checkReleasedSpecifics(state("adult", { surface: "robot" }), "q", "1998");
    await checkReleasedSpecifics(state("child"), "q", "1998");
    await checkReleasedSpecifics(state("teen"), "q", "1998");
    setHouseholdSettingValue("chat.specifics_check", "off");
    await checkReleasedSpecifics(state(), "q", "1998");
    expect(calls).toBe(0);
    expect(specificsCheckCounters()["specifics_check.skipped"]).toBe(4);
  });
  test("a throwing judge is absorbed and counted unavailable", async () => {
    __setSpecificsCheckRunnerForTests(async () => { throw new Error("offline"); });
    await expect(checkReleasedSpecifics(state(), "q", "1998")).resolves.toBeUndefined();
    expect(specificsCheckCounters()).toEqual({ "specifics_check.checked": 1, "specifics_check.unavailable": 1 });
  });
});
