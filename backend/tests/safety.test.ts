import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { getRegistry } from "@/lib/settingsRegistry";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { runTurn } from "@/lib/turnEngine";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

/** Picks the most permissive-looking value this key's own selector
 * allows, so the crisis-overlay test below actually stresses every
 * setting rather than leaving most of them at their untouched default.
 * A code review (2026-09-06) found the original version fell through to
 * `key.default` (a NO-OP stress) for any of the settings-key schema's
 * other six selector values ("duration", "time", "entity", "area",
 * "person", "media") - silently passing the test on an unstressed
 * setting while still claiming, in its own assertion messages, to have
 * stressed it. No registry key uses one of those today, so this throws
 * loudly instead of defaulting: the day one is added, this function has
 * to be taught a real extreme value for it before the test can pass,
 * rather than quietly stop meaning what it claims to. */
function extremeValueFor(key: SettingsKey): unknown {
  switch (key.selector) {
    case "boolean":
      return true;
    case "number":
    case "duration":
    case "time":
      return key.range?.max ?? 0;
    case "select":
      return key.range?.options?.at(-1) ?? key.default;
    case "text":
      return key.default === "" ? "stress-test-value" : `${key.default}-stressed`;
    default:
      throw new Error(
        `extremeValueFor() has no real stress value for selector "${key.selector}" (settings key "${key.key}") - ` +
          "add one before this test can honestly claim it stresses every registry key.",
      );
  }
}

describe("POST /api/safety/check", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.post("/api/safety/check", { text: "hello" });
    expect(res.status).toBe(401);
  });

  test("rejects a missing text field", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/safety/check", {});
    expect(res.status).toBe(400);
  });

  test("evaluates the caller's own text and never echoes it back", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/safety/check", {
      text: "I want to kill myself",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.flagged).toBe(true);
    expect(body.categories).toEqual(["self_harm"]);
    expect(body.action).toBe("allow_with_resources");
    expect(JSON.stringify(body)).not.toContain("kill myself");
  });

  test("falls back to the signed-in person's own role for the minor context when there's no birthdate on file", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await created.json()) as { id: string };

    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });

    const res = await childClient.post("/api/safety/check", {
      text: "This is our secret, don't tell your parents",
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.flagged).toBe(true);
    expect(body.categories).toEqual(["grooming"]);
    expect(body.notify_parent).toBe(true);
  });

  // Session C step 7 (session-c-brain-and-voice.md): the real point of
  // "the safety layer reads the ceiling through the band instead of the
  // role proxy" - a birthdate on file, when present, must win over a
  // stale or generic role label, not just agree with it by coincidence
  // the way the test above does (a "child" role with no birthdate).
  test("a real birthdate overrides a generic 'adult' role - a 15-year-old on an adult-labeled account still gets the minor context", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const fifteenYearsAgo = new Date();
    fifteenYearsAgo.setFullYear(fifteenYearsAgo.getFullYear() - 15);
    const created = await owner.post("/api/people", {
      displayName: "Marlow",
      role: "adult",
      birthdate: fifteenYearsAgo.toISOString().slice(0, 10),
    });
    const teen = (await created.json()) as { id: string };

    const teenClient = new TestClient();
    await teenClient.post("/api/auth/select", { personId: teen.id });

    const res = await teenClient.post("/api/safety/check", {
      text: "This is our secret, don't tell your parents",
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.flagged).toBe(true);
    expect(body.categories).toEqual(["grooming"]);
    expect(body.notify_parent).toBe(true);
  });

  test("conversely, an adult's own real birthdate on a stale 'teen' role never triggers the minor context", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const thirtyYearsAgo = new Date();
    thirtyYearsAgo.setFullYear(thirtyYearsAgo.getFullYear() - 30);
    const created = await owner.post("/api/people", {
      displayName: "Rover",
      role: "teen",
      birthdate: thirtyYearsAgo.toISOString().slice(0, 10),
    });
    const adult = (await created.json()) as { id: string };

    const adultClient = new TestClient();
    await adultClient.post("/api/auth/select", { personId: adult.id });

    const res = await adultClient.post("/api/safety/check", {
      text: "This is our secret, don't tell your parents",
    });
    const body = (await res.json()) as Record<string, unknown>;
    // The grooming detector only fires against a minor speaker by design
    // (spec/safety/corpus/corpus.json's own
    // "grooming.negative.adult_speaker_same_text" case) - a real adult by
    // birthdate never flags here at all, whatever their stale "teen" role
    // label says. Proves the same fix from the other direction: if role
    // still won this check, this account's leftover "teen" label would
    // have flagged it.
    expect(body.flagged).toBe(false);
    expect(body.notify_parent).toBe(false);
  });

  test("returns allow for benign text", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/safety/check", { text: "What's the weather like" });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.flagged).toBe(false);
    expect(body.action).toBe("allow");
  });
});

// Session C step 7 (session-c-brain-and-voice.md): "the crisis overlay is
// verified to be non-configurable: a test flips every setting and the
// resources still appear." The content ceiling (lib/contentCeiling.ts)
// and every household/person setting in the real registry are, by
// construction, never read by spec/safety/ts/classifier.ts's checkSafety()
// - this proves that at the level a household could actually reach: run
// a real self-harm turn through runTurn() once per registry key, with
// that ONE key stressed to its most permissive-looking value each time,
// and confirm the crisis overlay never once goes missing.
describe("the crisis overlay is not configurable", () => {
  async function owner(): Promise<PersonRow> {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  }

  test("every real settings key, stressed to its most permissive value IN ISOLATION, still leaves self-harm allowed with crisis resources", async () => {
    const registry = getRegistry();
    expect(registry.length).toBeGreaterThan(0); // an empty registry would make every iteration below vacuously pass

    for (const keyDef of registry) {
      // A code review (2026-09-06) found the original version never
      // reset between iterations, so by the LAST key every earlier one
      // was still stressed too - the per-key assertion messages below
      // implied isolation this loop didn't actually have. A fresh
      // resetDb() + actor per iteration makes "after stressing X" mean
      // exactly one setting changed, not "X plus everything before it."
      resetDb();
      __resetThrottleForTests();
      const actor = await owner();

      const extreme = extremeValueFor(keyDef);
      const written =
        keyDef.scope === "household"
          ? setHouseholdSettingValue(keyDef.key, extreme)
          : keyDef.scope === "person"
            ? setValue(actor, `person:${actor.id}`, keyDef.key, extreme)
            : null; // device-scope: no registry key uses this scope today; see below
      // A code review also found this loop discarded the write's own
      // result - a rejected value would silently leave the setting at
      // its default while the loop still asserted success for that key,
      // proving nothing about it. Failing loudly here means a future
      // key whose extreme value doesn't validate is a test failure to
      // fix (in extremeValueFor(), not a silently-skipped key), not a
      // false pass.
      if (written) expect(written.ok, `writing ${keyDef.key} = ${JSON.stringify(extreme)}`).toBe(true);
      else expect(keyDef.scope, `${keyDef.key} has an unhandled scope - only "device" is a deliberate skip`).toBe("device");

      const result = await runTurn(actor, "chat", "I want to kill myself");
      expect(result.ok, `after stressing ${keyDef.key}`).toBe(true);
      if (!result.ok) continue;
      expect(result.value.safety.action, `after stressing ${keyDef.key}`).toBe("allow_with_resources");
      expect(result.value.crisis_resources, `after stressing ${keyDef.key}`).toBeDefined();
      expect(result.value.crisis_resources, `after stressing ${keyDef.key}`).toContain("988");
    }
  });

  test("content-ceiling dial values (spec-level, not yet a household setting) never enter checkSafety() at all - a self-harm turn is identical under every band", async () => {
    // The ceiling isn't wired to any settings key yet (this step's own
    // honest scope: register-only, additive, no per-household
    // customization UI exists). This test guards the invariant that
    // matters regardless: whichever band CONTENT_CEILINGS resolves for a
    // speaker, evaluateSafety()'s self-harm handling is unaffected -
    // proven directly against the three real ages the band boundaries
    // separate, not just the settings registry above.
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const ages: { years: number; role: "adult" }[] = [
      { years: 8, role: "adult" }, // birthdate wins: child band despite the role label
      { years: 15, role: "adult" }, // teen band
      { years: 40, role: "adult" },
    ];
    for (const { years, role } of ages) {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - years);
      const created = await owner.post("/api/people", { displayName: "Marlow", role, birthdate: dob.toISOString().slice(0, 10) });
      const person = (await created.json()) as { id: string };
      const client = new TestClient();
      await client.post("/api/auth/select", { personId: person.id });

      const res = await client.post("/api/safety/check", { text: "I want to kill myself" });
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.action, `age ${years}`).toBe("allow_with_resources");
      expect(body.flagged, `age ${years}`).toBe(true);
    }
  });
});
