import { describe, expect, test } from "bun:test";
import { decide } from "@/lib/gate/decide";

const request = (band: "child" | "teen" | "adult", capabilities: string[], overrides: Record<string, unknown> = {}) => ({
  who: { personId: "person", role: band, band },
  what: { capabilities, ...overrides },
});

describe("GATE-01 band matrix", () => {
  test("adult baseline from the pre-gate turn policy is unchanged", () => {
    // Captured from policyNode before it used decide(): ordinary host calls
    // ran, household-name searches asked the speaker, and consequential
    // package/project actions asked the speaker.
    const baseline: Array<{ capabilities: string[]; what: Record<string, unknown>; expected: "allow" | "ask_self" }> = [
      { capabilities: ["net:api.open-meteo.com"], what: {}, expected: "allow" },
      { capabilities: ["search.household_subject"], what: {}, expected: "ask_self" },
      { capabilities: ["home:lock"], what: { consequential: true }, expected: "ask_self" },
      { capabilities: ["artifact:write"], what: { consequential: true }, expected: "ask_self" },
    ];
    for (const row of baseline) expect(decide(request("adult", row.capabilities, row.what)).kind).toBe(row.expected);
  });
  test("unknown capability asks a parent for a minor and the adult themselves", () => {
    expect(decide(request("child", ["unregistered.capability"])).kind).toBe("ask_parent");
    expect(decide(request("teen", ["unregistered.capability"])).kind).toBe("ask_parent");
    expect(decide(request("adult", ["unregistered.capability"])).kind).toBe("ask_self");
  });
  test("child family-name search and teen lock action require a parent; child lock is denied", () => {
    expect(decide(request("child", ["search.household_subject"])).kind).toBe("ask_parent");
    expect(decide(request("teen", ["home:lock"], { consequential: true })).kind).toBe("ask_parent");
    expect(decide(request("child", ["home:lock"], { consequential: true }))).toMatchObject({ kind: "deny", reason: "never_for_band" });
  });
  test("low-risk consequential project stays self-confirmable for a child", () => {
    expect(decide(request("child", ["artifact:write"], { consequential: true })).kind).toBe("ask_self");
  });
  test("parameterized policy and policy_ref both resolve from the Commons vocab", () => {
    expect(decide(request("child", ["home:light"])).kind).toBe("allow");
    expect(decide(request("child", ["integration:searxng"])).kind).toBe("ask_parent");
    expect(decide(request("adult", ["integration:searxng"])).kind).toBe("allow");
  });
  test("hard refusals precede capability policies", () => {
    expect(decide({ ...request("adult", ["memory:read"]), context: { crisis: true } })).toMatchObject({ kind: "deny", reason: "crisis_state" });
    expect(decide({ ...request("child", ["memory:read"]), who: { personId: "person", role: "child", band: "child", anonymous: true } })).toMatchObject({ kind: "deny", reason: "anonymous_speaker" });
    expect(decide({ ...request("adult", ["memory:write"]), context: { temporary: true } })).toMatchObject({ kind: "deny", reason: "temporary_mode" });
    expect(decide({ ...request("adult", ["net:api.open-meteo.com"], { denied: true }) })).toMatchObject({ kind: "deny", reason: "grant_denied" });
  });
});
