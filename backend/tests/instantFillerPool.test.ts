import { describe, expect, test } from "bun:test";
import { ACKNOWLEDGEMENT_GROUPS } from "@/lib/replyVariation";
import { talkOverDecision } from "@/lib/talkOver";
import { setHouseholdSettingValue } from "@/lib/settings";
import { SPECULATIVE_START_KEY } from "@/lib/speculation";

describe("INSTANT-FILLER-01a ready payload", () => {
  test("keeps clips as backchannel and adds all normalized groups", () => {
    const actor = { id: "adult-filler", birthdate: "1980-01-01" } as never;
    expect(setHouseholdSettingValue("voice.talk_over", "gentle").ok).toBe(true);
    expect(setHouseholdSettingValue(SPECULATIVE_START_KEY, true).ok).toBe(true);
    const grant = talkOverDecision({ actor, isRobot: false, now: new Date("2026-11-13T12:00:00Z") }).grant!;
    expect(grant.groups).toEqual(ACKNOWLEDGEMENT_GROUPS);
    expect(grant.clips).toEqual(grant.groups.backchannel);
    expect(Object.keys(grant.groups)).toEqual(["backchannel", "thinking", "request", "question", "good_news", "bad_news"]);
  });
});
