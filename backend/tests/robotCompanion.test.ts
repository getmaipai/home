// ROBOT-COMPANION-01 (owner's ruling, 2026-10-21): a robot's companion sets its band; an admin assigns the robot's controls.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { decide } from "@/lib/gate/decide";
import { effectiveBand } from "@/lib/turnContext";
import { robotCompanionBand, robotCompanionOf, companionsForControls } from "@/lib/robotCompanion";
import { PERSONAS } from "@/lib/persona";
import { voiceForSpeech } from "@/lib/voiceForSpeech";
import { setHouseholdSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";

beforeEach(() => resetDb());

async function setup() {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  const { deviceId } = issueDeviceToken(row.id, "robot", "StackChan");
  return { owner, row, deviceId, scope: `device:${deviceId}` };
}
const put = (client: TestClient, scope: string, key: string, value: unknown) => client.put("/api/settings", { scope, key, value });

describe("the bundled companions", () => {
  test("one companion per type, all lively and curious, none naming a voice", () => {
    const byId = (id: string) => PERSONAS.find((p) => p.id === id)!;
    expect(byId("lively-child").controls).toBe("child");
    expect(byId("lively-teen").controls).toBe("teen");
    expect(byId("lively-adult").controls).toBe("adult");
    for (const id of ["lively-child", "lively-teen", "lively-adult"]) {
      const persona = byId(id);
      expect(persona.engagement).toBe("curious");
      expect(persona.examples?.length).toBeGreaterThanOrEqual(3);
    }
  });
  test("the choices follow the controls: child robots only child companions, teen child and teen, adult any", () => {
    const ids = (level: "child" | "teen" | "adult") => companionsForControls(level).map((p) => p.id);
    expect(ids("child")).toContain("lively-child");
    expect(ids("child")).not.toContain("lively-teen");
    expect(ids("child")).not.toContain("lively-adult");
    expect(ids("teen")).toEqual(expect.arrayContaining(["lively-child", "lively-teen"]));
    expect(ids("teen")).not.toContain("lively-adult");
    expect(ids("adult")).toEqual(expect.arrayContaining(["lively-child", "lively-teen", "lively-adult"]));
  });
});

describe("assigning controls and a companion", () => {
  test("a new robot is child controls with no companion, and the list offers only child companions", async () => {
    const { owner, deviceId } = await setup();
    const body = await (await owner.get(`/api/devices/${deviceId}/companion`)).json() as { controls: string; companion_id: string; companions: Array<{ id: string; type: string }>; home_location_set: boolean };
    expect(body).toMatchObject({ controls: "child", companion_id: "", home_location_set: false });
    expect(body.companions.length).toBeGreaterThan(0);
    expect(body.companions.every((c) => c.type === "child")).toBe(true);
  });

  test("a child robot refuses a teen or adult companion with a sentence that says what to do", async () => {
    const { owner, scope } = await setup();
    for (const id of ["lively-teen", "lively-adult"]) {
      const res = await put(owner, scope, "robot.companion.id", id);
      expect(res.status).toBe(400);
      const { error } = await res.json() as { error: string };
      expect(error).toContain("can use only child companions");
      expect(error).toContain("Pick another companion, or raise this robot's controls first.");
    }
    expect((await put(owner, scope, "robot.companion.id", "lively-child")).status).toBe(200);
  });

  test("a teen robot takes child and teen companions, not adult; an adult robot takes any", async () => {
    const { owner, scope } = await setup();
    expect((await put(owner, scope, "robot.controls", "teen")).status).toBe(200);
    expect((await put(owner, scope, "robot.companion.id", "lively-teen")).status).toBe(200);
    expect((await put(owner, scope, "robot.companion.id", "lively-child")).status).toBe(200);
    expect((await put(owner, scope, "robot.companion.id", "lively-adult")).status).toBe(400);
    expect((await put(owner, scope, "robot.controls", "adult")).status).toBe(200);
    expect((await put(owner, scope, "robot.companion.id", "lively-adult")).status).toBe(200);
  });

  test("lowering the controls under the assigned companion is refused until the companion changes", async () => {
    const { owner, scope } = await setup();
    await put(owner, scope, "robot.controls", "adult");
    await put(owner, scope, "robot.companion.id", "lively-adult");
    const res = await put(owner, scope, "robot.controls", "teen");
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain("Change or clear this robot's companion first.");
    expect((await owner.post("/api/settings/reset", { scope, key: "robot.controls" })).status).toBe(400);
    expect((await put(owner, scope, "robot.companion.id", "")).status).toBe(200);
    expect((await put(owner, scope, "robot.controls", "teen")).status).toBe(200);
  });

  test("an unknown companion id is refused, and only an owner or admin can assign", async () => {
    const { owner, scope } = await setup();
    const res = await put(owner, scope, "robot.companion.id", "no-such-companion");
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain("not installed");
    const made = await (await owner.post("/api/people", { displayName: "Clover", role: "teen", secret: "0000" })).json() as { id: string };
    const teen = new TestClient();
    await teen.post("/api/auth/verify-secret", { personId: made.id, secret: "0000" });
    expect((await put(teen, scope, "robot.controls", "adult")).status).toBe(403);
    expect((await put(teen, scope, "robot.companion.id", "lively-child")).status).toBe(403);
  });
});

describe("the band of an unknown robot speaker", () => {
  test("no companion: child, as before; a companion: its type; the speaker stays anonymous", async () => {
    const { owner, row, deviceId, scope } = await setup();
    const band = () => effectiveBand("robot", row, null, new Date(), deviceId);
    expect(band()).toEqual({ band: "child", basis: "unknown_speaker_default" });
    await put(owner, scope, "robot.controls", "adult");
    await put(owner, scope, "robot.companion.id", "lively-adult");
    expect(band()).toEqual({ band: "adult", basis: "unknown_speaker_default" });
    await put(owner, scope, "robot.companion.id", "lively-teen");
    expect(band().band).toBe("teen");
    await put(owner, scope, "robot.companion.id", "lively-child");
    expect(band().band).toBe("child");
  });

  test("a companion above the robot's controls reads as no companion, and the reset route cannot make one", async () => {
    const { owner, row, deviceId, scope } = await setup();
    await put(owner, scope, "robot.controls", "adult");
    await put(owner, scope, "robot.companion.id", "lively-adult");
    expect((await owner.post("/api/settings/reset", { scope, key: "robot.controls" })).status).toBe(400);
    expect(robotCompanionOf(deviceId)?.id).toBe("lively-adult");
    expect(robotCompanionBand(undefined)).toBeNull();
    // The settings layer itself has no pairing check (the route has it), so an older database could hold a stale pair.
    const { setValue } = await import("@/lib/settings");
    expect((await setValue(row, scope, "robot.controls", "child")).ok).toBe(true);
    expect(robotCompanionOf(deviceId)).toBeNull();
    expect(effectiveBand("robot", row, null, new Date(), deviceId).band).toBe("child");
  });

  test("a speaker the robot names is never loosened by the companion", async () => {
    const { owner, row, deviceId, scope } = await setup();
    await put(owner, scope, "robot.controls", "adult");
    await put(owner, scope, "robot.companion.id", "lively-child");
    const named = effectiveBand("robot", row, { person: row.id, basis: "voice", level: "confirmed" }, new Date(), deviceId);
    expect(named).toEqual({ band: "child", basis: "identified_profile" }); // the owner is an adult, the child companion tightens
  });

  test("other surfaces ignore the robot's companion", async () => {
    const { owner, row, deviceId, scope } = await setup();
    await put(owner, scope, "robot.companion.id", "lively-child");
    expect(effectiveBand("chat", row, null, new Date(), deviceId).band).toBe("adult");
  });
});

describe("a companion never loosens who may approve an action", () => {
  test("an unknown speaker on an adult-companion robot is judged at the child band for effects, and still cannot reach memory", () => {
    const who = { personId: "p", role: "owner" as const, band: "adult" as const, anonymous: true };
    const lock = decide({ who, what: { capabilities: ["integration:home_assistant"], consequential: true, minRole: "teen" } });
    expect(lock.kind).not.toBe("allow");
    expect(lock.kind).not.toBe("ask_self");
    const own = decide({ who: { ...who, anonymous: false }, what: { capabilities: ["integration:home_assistant"], consequential: true, minRole: "teen" } });
    expect(own.kind).toBe("ask_self");
    // The same unknown speaker is judged exactly as a robot with no companion would judge them, for reads and lookups too.
    const none = { ...who, band: "child" as const };
    for (const capability of ["search.household_subject", "logbook:read", "camera:still", "commands.create"]) {
      expect(decide({ who, what: { capabilities: [capability] } }).kind).toBe(decide({ who: none, what: { capabilities: [capability] } }).kind);
    }
    const memory = decide({ who, what: { capabilities: ["memory:read"] } });
    expect(memory).toMatchObject({ kind: "deny", reason: "anonymous_speaker" });
    const pending = decide({ who, what: { capabilities: ["pending:lock-doors"], consequential: true } });
    expect(["ask_self", "allow"]).not.toContain(pending.kind);
  });
});

describe("a child or teen companion never speaks a clip voice", () => {
  test("the robot's voice follows the household default for an adult companion and falls back to the built-in voice for child and teen", async () => {
    const { owner, row, deviceId, scope } = await setup();
    setHouseholdSettingValue("tts.home_voice", "voice-abcdefghijklmnop");
    await put(owner, scope, "robot.controls", "adult");
    await put(owner, scope, "robot.companion.id", "lively-adult");
    expect(voiceForSpeech({ actor: row, deviceId })).toBe("voice-abcdefghijklmnop");
    await put(owner, scope, "robot.companion.id", "lively-teen");
    expect(voiceForSpeech({ actor: row, deviceId })).not.toBe("voice-abcdefghijklmnop");
    await put(owner, scope, "robot.companion.id", "lively-child");
    expect(voiceForSpeech({ actor: row, deviceId })).not.toBe("voice-abcdefghijklmnop");
  });
});
