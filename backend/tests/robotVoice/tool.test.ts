// ROBOT-VOICE-01: the robot_timer and robot_announce tools, with the robot channel faked.
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceCommands, people } from "@/db/schema";
import { createDevice, type Device } from "@/lib/devices";
import { awaitDeviceCommandAck, issueDeviceCommand, retractUndeliveredDeviceCommand } from "@/lib/deviceCommands";
import { VIRTUAL_TOOL_REGISTRY } from "@/lib/projects/tool";
import { announceTargets, robotAnnounceAllowed, robotAnnounceToolSpec, robotTimerAllowed, robotTimerToolSpec, runRobotAnnounceTool, runRobotTimerTool, spokenDuration, type RobotVoiceDeps } from "@/lib/robotVoice/tool";
import { resolveTurnBudget, withTurnToolGates } from "@/lib/turnMachine/budget";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import { TestClient } from "../client";
import { resetDb } from "../reset-db";

beforeEach(() => resetDb());

const owner = { id: "p-owner", role: "owner" as const };
const adult = { id: "p-adult", role: "adult" as const };
const teen = { id: "p-teen", role: "teen" as const };
const child = { id: "p-child", role: "child" as const };

function robot(id: string, name: string, area: string | null, personId = "p-owner"): Device {
  const stamp = "2026-11-13T00:00:00.000Z";
  return { id, kind: "robot", name, area, capabilities: [], offlineScope: [], personId, watermarks: {}, lastSeenAt: null, offlineNotifiedAt: null, createdAt: stamp, updatedAt: stamp, hlc: "1:0:test" };
}
const kitchen = robot("device-k", "Kitchen", "kitchen");
const den = robot("device-d", "Den", "den");

type Sent = { deviceId: string; kind: string; payload: Record<string, unknown>; expiresInMs: number };
function fake(answer: Record<string, unknown> | null, extra: Partial<RobotVoiceDeps> = {}): { deps: RobotVoiceDeps; sent: Sent[]; audits: string[]; retracted: string[] } {
  const sent: Sent[] = [];
  const audits: string[] = [];
  const retracted: string[] = [];
  const deps: RobotVoiceDeps = {
    capable: () => true,
    setting: () => undefined,
    robots: () => [kitchen, den],
    send: (deviceId, kind, payload, expiresInMs) => { sent.push({ deviceId, kind, payload, expiresInMs }); return { id: `cmd-${sent.length}` }; },
    wait: async () => answer,
    retract: (id) => { retracted.push(id); return true; },
    audit: (row) => { audits.push(`${row.tool}:${row.action}:${row.decision}`); },
    ...extra,
  };
  return { deps, sent, audits, retracted };
}
const text = (outcome: Awaited<ReturnType<typeof runRobotTimerTool>>) => outcome.result?.reply?.text ?? outcome.userMessage ?? "";
const timer = (args: Record<string, unknown>, deps: RobotVoiceDeps, who = owner, deviceId: string | undefined = "device-k") => runRobotTimerTool({ actor: who, band: "adult", args, callId: "c1", deviceId, deps });
const announce = (args: Record<string, unknown>, deps: RobotVoiceDeps, turnDeviceId?: string, who = owner) => runRobotAnnounceTool({ actor: who, band: "adult", args, callId: "c1", ...(turnDeviceId ? { turnDeviceId } : {}), deps });

describe("the phrase fixture", () => {
  const rows = (JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", "robotVoicePhrases.json"), "utf-8")) as { rows: Array<{ say: string; tool: string; args: Record<string, unknown>; command: string; payload: Record<string, unknown>; reply: string }> }).rows;
  for (const row of rows) {
    test(`"${row.say}" becomes ${row.command} and is answered from the robot's reply`, async () => {
      const { deps, sent } = fake({ ok: true, status: "delivered", timers: [] });
      const outcome = row.tool === "robot_timer" ? await timer(row.args, deps) : await announce(row.args, deps);
      expect(outcome.status).toBe("succeeded");
      expect(sent).toHaveLength(1);
      expect(sent[0]!.kind).toBe(row.command);
      expect(sent[0]!.payload).toEqual(row.payload);
      expect(text(outcome)).toBe(row.reply);
    });
  }
});

describe("robot_timer results are the robot's own", () => {
  test("the timer goes to the turn's robot, not another", async () => {
    const { deps, sent } = fake({ ok: true, id: 1 });
    await timer({ action: "set", seconds: 60 }, deps, owner, "device-d");
    expect(sent[0]!.deviceId).toBe("device-d");
  });

  test("a refusal from the robot is spoken in its words, never as success", async () => {
    const { deps } = fake({ ok: false, error: "Timers can run for up to 24 hours. Ask for a shorter time." });
    const outcome = await timer({ action: "set", seconds: 86_400 }, deps);
    expect(text(outcome)).toBe("Timers can run for up to 24 hours. Ask for a shorter time.");
    expect(text(outcome)).not.toContain("Timer set");
  });

  test("the list reads the robot's rows", async () => {
    const { deps } = fake({ ok: true, timers: [{ id: 3, kind: "timer", label: "tea", left: 245 }, { id: 4, kind: "alarm", label: "", left: 3600 }] });
    const outcome = await timer({ action: "list" }, deps);
    expect(text(outcome)).toBe("2 running on the robot. timer tea (id 3): 4 minutes 5 seconds left; alarm (id 4): 1 hour left.");
  });

  test("an ack with no ok is not taken as success, so the household timer can be used", async () => {
    const { deps } = fake({});
    const outcome = await timer({ action: "set", seconds: 60 }, deps);
    expect(outcome.status).toBe("failed");
    expect(outcome.failureKind).toBe("unavailable");
  });

  test("no answer and not delivered: the command is withdrawn and the tool fails so the household timer can be used", async () => {
    const { deps, retracted } = fake(null);
    const outcome = await timer({ action: "set", seconds: 60 }, deps);
    expect(outcome.status).toBe("failed");
    expect(retracted).toEqual(["cmd-1"]);
    expect(text(outcome)).toContain("nothing was set");
  });

  test("no answer but delivered: says it only asked", async () => {
    const { deps } = fake(null, { retract: () => false });
    const outcome = await timer({ action: "set", seconds: 600 }, deps);
    expect(outcome.status).toBe("succeeded");
    expect(text(outcome)).toBe("I asked the robot to set a timer for 10 minutes, but it has not confirmed, so I can't say it worked.");
  });

  test("a body that is away sends nothing", async () => {
    const { deps, sent } = fake({ ok: true }, { capable: () => false });
    const outcome = await timer({ action: "set", seconds: 60 }, deps);
    expect(outcome.status).toBe("failed");
    expect(sent).toHaveLength(0);
  });

  test("timers off on the robot sends nothing", async () => {
    const { deps, sent } = fake({ ok: true }, { setting: () => false });
    expect((await timer({ action: "set", seconds: 60 }, deps)).status).toBe("failed");
    expect(sent).toHaveLength(0);
  });

  test("bad calls are rejected before anything is sent", async () => {
    const { deps, sent } = fake({ ok: true });
    for (const args of [{ action: "set" }, { action: "alarm", hour: 7 }, { action: "set", seconds: 0 }, { action: "set", seconds: 90_000 }, { action: "snooze", seconds: 4000 }, { action: "dance" }, { action: "set", seconds: 5, extra: 1 }]) {
      expect((await timer(args, deps)).status).toBe("rejected");
    }
    expect(sent).toHaveLength(0);
  });

  test("a chat turn with no robot has nothing to talk to", async () => {
    const { deps, sent } = fake({ ok: true });
    const outcome = await runRobotTimerTool({ actor: owner, band: "adult", args: { action: "set", seconds: 60 }, callId: "c1", deviceId: undefined, deps });
    expect(outcome.status).toBe("rejected");
    expect(sent).toHaveLength(0);
  });

  test("the audit row holds the action only", async () => {
    const { deps, audits } = fake({ ok: true });
    await timer({ action: "set", seconds: 60, label: "secret" }, deps);
    expect(audits).toEqual(["robot_timer:set:do"]);
  });
});

describe("robot_announce", () => {
  test("a delivered announcement says which robot", async () => {
    const { deps, sent } = fake({ status: "delivered" });
    const outcome = await announce({ text: "Dinner is ready.", robot: "kitchen" }, deps);
    expect(text(outcome)).toBe("Kitchen is showing the message and saying it now.");
    expect(sent[0]).toMatchObject({ deviceId: "device-k", kind: "announce", payload: { text: "Dinner is ready." } });
  });

  test("urgent is not sent unless the model sets it", async () => {
    const { deps, sent } = fake({ status: "delivered" });
    await announce({ text: "Hi.", robot: "Den" }, deps);
    expect(sent[0]!.payload).toEqual({ text: "Hi." });
  });

  test("spoken from a robot with no name given, it answers itself", async () => {
    const { deps, sent } = fake({ status: "delivered" });
    await announce({ text: "Dinner is ready." }, deps, "device-d");
    expect(sent[0]!.deviceId).toBe("device-d");
  });

  test("with two robots and none named it asks which", async () => {
    const { deps, sent } = fake({ status: "delivered" });
    const outcome = await announce({ text: "Dinner is ready." }, deps);
    expect(outcome.status).toBe("rejected");
    expect(text(outcome)).toContain("Which robot?");
    expect(sent).toHaveLength(0);
  });

  test("an unknown robot name is refused and the real names are given", async () => {
    const { deps } = fake({ status: "delivered" });
    const outcome = await announce({ text: "Hi.", robot: "Garage" }, deps);
    expect(outcome.status).toBe("rejected");
    expect(text(outcome)).toContain("Kitchen, Den");
  });

  test("each refusal reason is said plainly", async () => {
    for (const [reason, words] of [["muted", "it is muted"], ["quiet", "it is in quiet hours"], ["disabled", "announcements are turned off on it"], ["night", "holding back normal announcements at night"]] as const) {
      const { deps } = fake({ status: "refused", reason });
      const outcome = await announce({ text: "Hi.", robot: "Kitchen" }, deps);
      expect(outcome.status).toBe("succeeded");
      expect(text(outcome)).toContain(words);
      expect(text(outcome)).toContain("did not say it");
    }
  });

  test("no ack and delivered is 'asked', never 'said'", async () => {
    const { deps } = fake(null, { retract: () => false });
    expect(text(await announce({ text: "Hi.", robot: "Kitchen" }, deps))).toBe("I asked Kitchen to say it, but it has not confirmed, so I can't say it was heard.");
  });

  test("a child, teen or guest never speaks through a robot", async () => {
    const { deps, sent } = fake({ status: "delivered" });
    for (const band of ["child", "teen"]) {
      const outcome = await runRobotAnnounceTool({ actor: band === "child" ? child : teen, band, args: { text: "Hi." }, callId: "c1", deps });
      expect(outcome.status).toBe("rejected");
    }
    expect(sent).toHaveLength(0);
  });

  test("an adult reaches only robots they own; an owner reaches all", () => {
    const { deps } = fake(null, { robots: () => [robot("device-a", "Mine", null, "p-adult"), kitchen] });
    expect(announceTargets(adult, deps).map((r) => r.name)).toEqual(["Mine"]);
    expect(announceTargets(owner, deps).map((r) => r.name)).toEqual(["Mine", "Kitchen"]);
    expect(announceTargets(teen, deps)).toEqual([]);
  });
});

describe("offer gates", () => {
  test("robot_timer only on a robot turn from a capable body with timers on", () => {
    const { deps } = fake(null);
    const base = { actor: owner, surface: "robot", deviceId: "device-k", bare: false };
    expect(robotTimerAllowed(base, deps)).toBe(true);
    expect(robotTimerAllowed({ ...base, surface: "chat" }, deps)).toBe(false);
    expect(robotTimerAllowed({ ...base, deviceId: undefined }, deps)).toBe(false);
    expect(robotTimerAllowed(base, { ...deps, capable: () => false })).toBe(false);
    expect(robotTimerAllowed(base, { ...deps, setting: () => false })).toBe(false);
    expect(robotTimerAllowed({ ...base, actor: child }, deps)).toBe(true);
    expect(robotTimerAllowed({ ...base, actor: { role: "guest" } }, deps)).toBe(false);
  });

  test("robot_announce needs an adult and a body to speak through", () => {
    const { deps } = fake(null);
    expect(robotAnnounceAllowed({ actor: owner, band: "adult", bare: false }, deps)).toBe(true);
    expect(robotAnnounceAllowed({ actor: owner, band: "teen", bare: false }, deps)).toBe(false);
    expect(robotAnnounceAllowed({ actor: owner, band: "adult", bare: true }, deps)).toBe(false);
    expect(robotAnnounceAllowed({ actor: owner, band: "adult", bare: false }, { ...deps, capable: () => false })).toBe(false);
    expect(robotAnnounceAllowed({ actor: owner, band: "adult", bare: false }, { ...deps, setting: () => false })).toBe(false);
  });

  test("registered, and offered only when the gate passes", () => {
    for (const [id, gate] of [["robot_timer", "robotTimerAllowed"], ["robot_announce", "robotAnnounceAllowed"]] as const) {
      expect(VIRTUAL_TOOL_REGISTRY.find((tool) => tool.id === id)?.offer).toMatchObject({ mode: "conditional", gate });
    }
    const base = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult");
    expect(withTurnToolGates(base, false).tools_offered).not.toContain("robot_timer");
    const on = withTurnToolGates(base, false, false, false, false, false, false, false, false, null, false, false, false, false, false, false, false, false, true, true);
    expect(on.tools_offered).toContain("robot_timer");
    expect(on.tools_offered).toContain("robot_announce");
  });

  test("the specs are withheld until the turn is allowed them", () => {
    expect(toolSpecFor("robot_timer")).toBeNull();
    expect(toolSpecFor("robot_announce")).toBeNull();
  });

  test("the announce spec names the robots only when there is a choice", () => {
    expect((robotAnnounceToolSpec([kitchen]).args as { properties: Record<string, unknown> }).properties.robot).toBeUndefined();
    const two = robotAnnounceToolSpec([kitchen, den]).args as { properties: { robot: { enum: string[] } } };
    expect(two.properties.robot.enum).toEqual(["Kitchen", "Den"]);
    expect(robotTimerToolSpec().args).toMatchObject({ required: ["action"] });
  });
});

test("durations read in words", () => {
  expect([1, 45, 60, 600, 3600, 5400, 3660].map(spokenDuration)).toEqual(["1 second", "45 seconds", "1 minute", "10 minutes", "1 hour", "1 hour 30 minutes", "1 hour 1 minute"]);
});

describe("the channel's answer wait", () => {
  let ownerId = "";
  beforeEach(async () => {
    const client = new TestClient();
    expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
    ownerId = db.select({ id: people.id }).from(people).where(eq(people.displayName, "Sage")).get()!.id;
  });
  function realRobot(): string {
    return createDevice("robot", "Kitchen", ownerId).id;
  }

  test("an undelivered command is withdrawn and never replays; a missing answer resolves null", async () => {
    const deviceId = realRobot();
    const command = issueDeviceCommand(deviceId, "announce", { text: "Hi." });
    expect(await awaitDeviceCommandAck(command.id, 20)).toBeNull();
    expect(retractUndeliveredDeviceCommand(command.id)).toBe(true);
    expect(db.select().from(deviceCommands).where(eq(deviceCommands.id, command.id)).all()).toHaveLength(0);
    expect(retractUndeliveredDeviceCommand(command.id)).toBe(false);
  });
});
