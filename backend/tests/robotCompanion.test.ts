// ROBOT-COMPANION-01 (owner's ruling, 2026-10-21): a robot's companion sets its band; an admin assigns the robot's controls.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { decide } from "@/lib/gate/decide";
import { effectiveBand } from "@/lib/turnContext";
import { robotCompanionBand, robotCompanionOf, companionsForControls } from "@/lib/robotCompanion";
import { PERSONAS, adaptPersonaToBand, composePersonaPrompt } from "@/lib/persona";
import { PACKAGES_DIR } from "@/lib/paths";
import { companionVoiceKey } from "@/settings/companionVoiceKeys";
import { voiceForSpeech } from "@/lib/voiceForSpeech";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import type { PersonRow } from "@/types";

beforeEach(() => resetDb());

// Two explicit companions for the pairing tests: no bundled companion is explicit, so these exist only while this file runs.
const EXPLICIT = { "zz-test-teen": "teen", "zz-test-adult": "adult" } as const;
beforeAll(() => {
  for (const [id, audience] of Object.entries(EXPLICIT)) {
    mkdirSync(join(PACKAGES_DIR, id), { recursive: true });
    const manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, "lively-adult", "manifest.json"), "utf-8"));
    writeFileSync(join(PACKAGES_DIR, id, "manifest.json"), JSON.stringify({ ...manifest, id, display: id, min_role: audience, companion: { ...manifest.companion, display_name: id === "zz-test-teen" ? "Tester Teen" : "Tester Adult", audience } }));
  }
});
afterAll(() => { for (const id of Object.keys(EXPLICIT)) rmSync(join(PACKAGES_DIR, id), { recursive: true, force: true }); });

async function setup() {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  const { deviceId } = issueDeviceToken(row.id, "robot", "StackChan");
  return { owner, row, deviceId, scope: `device:${deviceId}` };
}
const put = (client: TestClient, scope: string, key: string, value: unknown) => client.put("/api/settings", { scope, key, value });

describe("the bundled companions", () => {
  test("the lively companions and Rivet are for everyone, lively and curious, with lines for every band, none naming a voice", () => {
    const byId = (id: string) => PERSONAS.find((p) => p.id === id)!;
    for (const id of ["lively-child", "lively-teen", "lively-adult", "rivet"]) {
      const persona = byId(id);
      expect(persona.audience).toBe("all");
      expect(persona.floor).toBe("child");
      expect(persona.engagement).toBe("curious");
      expect(persona.examples?.length).toBeGreaterThanOrEqual(3);
      for (const band of ["child", "teen", "adult"] as const) expect(persona.examples_by_band?.[band]?.length).toBeGreaterThanOrEqual(2);
    }
  });
  test("the older companions read their audience from min_role (child: everyone)", () => {
    for (const id of ["default", "buddy", "tutor", "pal"]) expect(PERSONAS.find((p) => p.id === id)!.audience).toBe("all");
  });
  test("the choices follow the controls: dynamic companions anywhere, teen from teen up, adult only on adult", () => {
    const ids = (level: "child" | "teen" | "adult") => companionsForControls(level).map((p) => p.id);
    for (const level of ["child", "teen", "adult"] as const) expect(ids(level)).toEqual(expect.arrayContaining(["lively-child", "lively-teen", "lively-adult", "rivet"]));
    expect(ids("child")).not.toContain("zz-test-teen");
    expect(ids("child")).not.toContain("zz-test-adult");
    expect(ids("teen")).toContain("zz-test-teen");
    expect(ids("teen")).not.toContain("zz-test-adult");
    expect(ids("adult")).toEqual(expect.arrayContaining(["zz-test-teen", "zz-test-adult"]));
  });
});

describe("assigning controls and a companion", () => {
  test("a new robot is child controls with no companion, and the list offers only companions for everyone", async () => {
    const { owner, deviceId } = await setup();
    const body = await (await owner.get(`/api/devices/${deviceId}/companion`)).json() as { controls: string; companion_id: string; companions: Array<{ id: string; audience: string }>; home_location_set: boolean };
    expect(body).toMatchObject({ controls: "child", companion_id: "", home_location_set: false });
    expect(body.companions.length).toBeGreaterThan(0);
    expect(body.companions.every((c) => c.audience === "all")).toBe(true);
  });

  test("a child robot cannot be given an explicit companion, with a sentence that says what to do; a dynamic adult-named one is fine", async () => {
    const { owner, scope } = await setup();
    for (const id of ["zz-test-teen", "zz-test-adult"]) {
      const res = await put(owner, scope, "robot.companion.id", id);
      expect(res.status).toBe(400);
      const { error } = await res.json() as { error: string };
      expect(error).toContain("can use only all-ages companions");
      expect(error).toContain("Pick another companion, or raise this robot's controls first.");
    }
    expect((await put(owner, scope, "robot.companion.id", "lively-adult")).status).toBe(200);
    expect((await put(owner, scope, "robot.companion.id", "rivet")).status).toBe(200);
  });

  test("a teen robot takes dynamic and teen companions, not adult; an adult robot takes any", async () => {
    const { owner, scope } = await setup();
    expect((await put(owner, scope, "robot.controls", "teen")).status).toBe(200);
    expect((await put(owner, scope, "robot.companion.id", "zz-test-teen")).status).toBe(200);
    expect((await put(owner, scope, "robot.companion.id", "lively-child")).status).toBe(200);
    expect((await put(owner, scope, "robot.companion.id", "zz-test-adult")).status).toBe(400);
    expect((await put(owner, scope, "robot.controls", "adult")).status).toBe(200);
    expect((await put(owner, scope, "robot.companion.id", "zz-test-adult")).status).toBe(200);
  });

  test("lowering the controls under an explicit companion is refused until the companion changes; a dynamic one never blocks", async () => {
    const { owner, scope } = await setup();
    await put(owner, scope, "robot.controls", "adult");
    await put(owner, scope, "robot.companion.id", "zz-test-adult");
    const res = await put(owner, scope, "robot.controls", "teen");
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain("Change or clear this robot's companion first.");
    expect((await owner.post("/api/settings/reset", { scope, key: "robot.controls" })).status).toBe(400);
    expect((await put(owner, scope, "robot.companion.id", "lively-adult")).status).toBe(200);
    expect((await put(owner, scope, "robot.controls", "child")).status).toBe(200);
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

describe("the band of an unknown robot speaker is the robot's controls, never the companion", () => {
  test("no companion: child, as before; a companion: the controls level, whichever companion; the speaker stays anonymous", async () => {
    const { owner, row, deviceId, scope } = await setup();
    const band = () => effectiveBand("robot", row, null, new Date(), deviceId);
    await put(owner, scope, "robot.controls", "adult");
    expect(band()).toEqual({ band: "child", basis: "unknown_speaker_default" }); // adult controls but no companion: strictest, as before
    for (const id of ["lively-adult", "lively-teen", "lively-child", "rivet"]) {
      await put(owner, scope, "robot.companion.id", id);
      expect(band()).toEqual({ band: "adult", basis: "unknown_speaker_default" });
    }
    await put(owner, scope, "robot.controls", "teen");
    expect(band().band).toBe("teen");
    await put(owner, scope, "robot.controls", "child");
    await put(owner, scope, "robot.companion.id", "lively-adult");
    expect(band().band).toBe("child"); // an "adult"-named dynamic companion on a child robot is a child turn
  });

  test("an explicit companion above the robot's controls reads as no companion (the strictest result), and the reset route cannot make one", async () => {
    const { owner, row, deviceId, scope } = await setup();
    await put(owner, scope, "robot.controls", "adult");
    await put(owner, scope, "robot.companion.id", "zz-test-adult");
    expect((await owner.post("/api/settings/reset", { scope, key: "robot.controls" })).status).toBe(400);
    expect(robotCompanionOf(deviceId)?.id).toBe("zz-test-adult");
    expect(robotCompanionBand(undefined)).toBeNull();
    // The settings layer itself has no pairing check (the route has it), so an older database could hold a stale pair.
    const { setValue } = await import("@/lib/settings");
    expect((await setValue(row, scope, "robot.controls", "teen")).ok).toBe(true);
    expect(robotCompanionOf(deviceId)).toBeNull();
    expect(robotCompanionBand(deviceId)).toBeNull();
    expect(effectiveBand("robot", row, null, new Date(), deviceId).band).toBe("child");
  });

  test("nothing ever loosens a filter: a named speaker gets the stricter of their own band and the controls", async () => {
    const { owner, row, deviceId, scope } = await setup();
    await put(owner, scope, "robot.controls", "child");
    await put(owner, scope, "robot.companion.id", "lively-adult");
    const named = effectiveBand("robot", row, { person: row.id, basis: "voice", level: "confirmed" }, new Date(), deviceId);
    expect(named).toEqual({ band: "child", basis: "identified_profile" }); // the owner is an adult, the child controls tighten
    await put(owner, scope, "robot.controls", "adult");
    expect(effectiveBand("robot", row, { person: row.id, basis: "voice", level: "confirmed" }, new Date(), deviceId).band).toBe("adult");
  });

  test("other surfaces ignore the robot's companion", async () => {
    const { owner, row, deviceId, scope } = await setup();
    await put(owner, scope, "robot.companion.id", "lively-child");
    expect(effectiveBand("chat", row, null, new Date(), deviceId).band).toBe("adult");
  });
});

describe("a dynamic companion adapts to the band", () => {
  test("child: the child lines come first and the vocabulary is simple; adult: the adult lines and the declared dial", () => {
    const nova = PERSONAS.find((p) => p.id === "lively-adult")!;
    const asChild = adaptPersonaToBand(nova, "child");
    const asAdult = adaptPersonaToBand(nova, "adult");
    expect(asChild.complexity).toBe("simple");
    expect(asChild.examples?.slice(0, nova.examples_by_band!.child!.length)).toEqual([...nova.examples_by_band!.child!]);
    expect(asAdult.examples?.slice(0, nova.examples_by_band!.adult!.length)).toEqual([...nova.examples_by_band!.adult!]);
    expect(asAdult.complexity).toBe(nova.complexity);
    expect(asChild.examples!.length).toBeLessThanOrEqual(4);
    expect(composePersonaPrompt(asChild)).toContain(nova.examples_by_band!.child![0]!);
    expect(composePersonaPrompt(asChild)).not.toContain(nova.examples_by_band!.adult![0]!);
  });
  test("a band never loosens: a teen is never given an advanced vocabulary and nothing changes the declared persona in place", () => {
    const tutor = { ...PERSONAS.find((p) => p.id === "tutor")!, complexity: "advanced" as const };
    expect(adaptPersonaToBand(tutor, "teen").complexity).toBe("standard");
    expect(tutor.complexity).toBe("advanced");
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

describe("a child or teen robot never speaks a clip voice", () => {
  test("the robot's voice follows the household default at adult controls and falls back to the built-in voice at child and teen", async () => {
    const { owner, row, deviceId, scope } = await setup();
    setHouseholdSettingValue("tts.home_voice", "voice-abcdefghijklmnop");
    await put(owner, scope, "robot.controls", "adult");
    await put(owner, scope, "robot.companion.id", "lively-adult");
    expect(voiceForSpeech({ actor: row, deviceId })).toBe("voice-abcdefghijklmnop");
    await put(owner, scope, "robot.controls", "teen");
    expect(voiceForSpeech({ actor: row, deviceId })).not.toBe("voice-abcdefghijklmnop");
    await put(owner, scope, "robot.controls", "child");
    expect(voiceForSpeech({ actor: row, deviceId })).not.toBe("voice-abcdefghijklmnop");
  });
});

describe("a robot's voice order", () => {
  test("robot voice, then the companion's voice, then Home's default; the person's voice only with no companion", async () => {
    const { owner, row, deviceId, scope } = await setup();
    setHouseholdSettingValue("tts.home_voice", "voice-abcdefghijklmnop");
    expect(setValue(row, `person:${row.id}`, "tts.voice_id", "voice-zzzzzzzzzzzzzzzz").ok).toBe(true);
    await put(owner, scope, "robot.controls", "adult");
    // No companion yet: the person's voice, as before.
    expect(voiceForSpeech({ actor: row, deviceId })).toBe("voice-zzzzzzzzzzzzzzzz");
    // A companion with no voice of its own: Home's default voice, not the person's.
    await put(owner, scope, "robot.companion.id", "rivet");
    expect(voiceForSpeech({ actor: row, deviceId })).toBe("voice-abcdefghijklmnop");
    // The companion's own voice (a household setting) beats Home's default.
    expect(setHouseholdSettingValue(companionVoiceKey("rivet"), "voice-cccccccccccccccc").ok).toBe(true);
    expect(voiceForSpeech({ actor: row, deviceId })).toBe("voice-cccccccccccccccc");
    // The robot's own voice wins over the companion's.
    expect(setValue(row, scope, "robot.voice.id", "voice-yyyyyyyyyyyyyyyy").ok).toBe(true);
    expect(voiceForSpeech({ actor: row, deviceId })).toBe("voice-yyyyyyyyyyyyyyyy");
    // Back to "use the companion's voice".
    expect(setValue(row, scope, "robot.voice.id", "default").ok).toBe(true);
    expect(voiceForSpeech({ actor: row, deviceId })).toBe("voice-cccccccccccccccc");
    // A child robot never speaks a clip voice, even the companion's.
    await put(owner, scope, "robot.controls", "child");
    expect(voiceForSpeech({ actor: row, deviceId })).not.toBe("voice-cccccccccccccccc");
  });
  test("each installed companion has its own household voice setting, and an admin can set it", async () => {
    const { owner } = await setup();
    const key = companionVoiceKey("lively-child");
    expect(key).toBe("companion.voice.lively_child");
    const res = await owner.put("/api/settings", { scope: "household", key, value: "default" });
    expect(res.status).toBe(200);
  });
});
