// ROBOT-MEMORY-01: each robot's own memories never mix. Recall, list and the
// judge are called directly (the turn route is heavy and adds nothing here).
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { db } from "@/db";
import { people, conversationTurns, memoryRecords } from "@/db/schema";
import { remember, recall, list } from "@/lib/memory";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { judgeTurn } from "@/lib/memoryJudge";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { startStackFixture, useDefaultScriptedStack } from "./stackFixture";
import { setHouseholdSettingValue } from "@/lib/settings";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";

let fixture: ReturnType<typeof startStackFixture> | null = null;
let embeddingStub: { stop(): Promise<void> } | null = null;

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  useDefaultScriptedStack();
});

afterEach(async () => {
  fixture?.stop();
  fixture = null;
  await embeddingStub?.stop();
  embeddingStub = null;
  __resetStackEngineForTests();
  __resetLlmSupervisorForTests();
});

async function household(): Promise<{ pippa: PersonRow; oliver: PersonRow; bruno: PersonRow; rover: string; otherRobot: string }> {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Pippa", secret: "correcthorse" });
  await owner.post("/api/people", { displayName: "Oliver", role: "adult", secret: "correcthorse2" });
  await owner.post("/api/people", { displayName: "Bruno", role: "child" });
  const byName = (n: string) => db.select().from(people).where(eq(people.displayName, n)).get()!;
  const pippa = byName("Pippa");
  const rover = issueDeviceToken(pippa.id, "robot", "Rover").deviceId;
  const otherRobot = issueDeviceToken(pippa.id, "robot", "Atlas").deviceId;
  return { pippa, oliver: byName("Oliver"), bruno: byName("Bruno"), rover, otherRobot };
}

function rapport(actor: PersonRow, text: string, deviceId: string) {
  const r = remember(actor, { text, category: "fact", tier: "durable", scope: "person", person: actor.id, device_id: deviceId, source: "test", importance: 0.9 });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const texts = (matches: ReturnType<typeof recall>) => matches.map((m) => m.record.text);
const JOKE = "Pippa and the robot share a running joke about the purple walrus";

describe("recall never mixes two robots", () => {
  test("robot A's rapport with Pippa is absent from robot B's recall and from Pippa's chat recall", async () => {
    const { pippa, rover, otherRobot } = await household();
    rapport(pippa, JOKE, rover);
    expect(texts(recall(pippa, "purple walrus joke", { selfOnly: true, deviceId: rover }))).toContain(JOKE);
    expect(texts(recall(pippa, "purple walrus joke", { selfOnly: true, deviceId: otherRobot }))).not.toContain(JOKE);
    expect(texts(recall(pippa, "purple walrus joke", { selfOnly: true, deviceId: null }))).not.toContain(JOKE);
    expect(texts(recall(pippa, "purple walrus joke", { selfOnly: true }))).not.toContain(JOKE);
  });

  test("Pippa's rapport with Rover is absent from Oliver's recall on Rover", async () => {
    const { pippa, oliver, rover } = await household();
    rapport(pippa, JOKE, rover);
    expect(texts(recall(oliver, "purple walrus joke", { selfOnly: true, deviceId: rover }))).not.toContain(JOKE);
  });

  test("an unknown speaker on Rover gets no rapport", async () => {
    const { pippa, rover } = await household();
    rapport(pippa, JOKE, rover);
    expect(texts(recall(pippa, "purple walrus joke", { selfOnly: true, deviceId: rover, anonymous: true }))).not.toContain(JOKE);
  });

  test("an adult's rapport never reaches a child on the same robot", async () => {
    const { pippa, bruno, rover } = await household();
    rapport(pippa, JOKE, rover);
    expect(texts(recall(bruno, "purple walrus joke", { selfOnly: true, deviceId: rover }))).not.toContain(JOKE);
  });

  test("a person fact (no device) told on robot A is recalled on robot B", async () => {
    const { pippa, rover, otherRobot } = await household();
    const fact = remember(pippa, { text: "Pippa keeps a pet axolotl named Mopey", category: "fact", tier: "durable", scope: "person", person: pippa.id, source: "test", importance: 0.9 });
    expect(fact.ok && fact.value.device_id).toBeNull();
    expect(texts(recall(pippa, "pet axolotl Mopey", { selfOnly: true, deviceId: otherRobot }))).toContain("Pippa keeps a pet axolotl named Mopey");
    expect(texts(recall(pippa, "pet axolotl Mopey", { selfOnly: true, deviceId: rover }))).toContain("Pippa keeps a pet axolotl named Mopey");
  });

  test("the Memory page list (robotBound all) shows the person's own rapport with each robot, still through canRead", async () => {
    const { pippa, oliver, rover, otherRobot } = await household();
    rapport(pippa, JOKE, rover);
    rapport(pippa, "Pippa tells Atlas about the green giraffe", otherRobot);
    const all = list(pippa, { robotBound: "all" }).map((m) => m.text);
    expect(all).toContain(JOKE);
    expect(all).toContain("Pippa tells Atlas about the green giraffe");
    expect(list(oliver, { robotBound: "all" }).map((m) => m.text)).not.toContain(JOKE);
    expect(list(pippa).map((m) => m.text)).not.toContain(JOKE);
  });
});

describe("the memory page route", () => {
  test("GET /api/memory returns robot rapport with the robot's name", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Pippa", secret: "correcthorse" });
    const pippa = db.select().from(people).where(eq(people.displayName, "Pippa")).get()!;
    const rover = issueDeviceToken(pippa.id, "robot", "Rover").deviceId;
    rapport(pippa, JOKE, rover);
    const res = await owner.get("/api/memory");
    const body = (await res.json()) as Array<{ text: string; device_id: string | null; device_name?: string }>;
    const row = body.find((m) => m.text === JOKE)!;
    expect(row.device_id).toBe(rover);
    expect(row.device_name).toBe("Rover");
  });
});

describe("conversations on the robot surface", () => {
  test("never reuse another robot's open conversation", async () => {
    const { pippa, rover, otherRobot } = await household();
    const a = resolveOrCreateConversation(pippa, "robot", undefined, { deviceId: rover });
    const b = resolveOrCreateConversation(pippa, "robot", undefined, { deviceId: otherRobot });
    const aAgain = resolveOrCreateConversation(pippa, "robot", undefined, { deviceId: rover });
    if (!a.ok || !b.ok || !aAgain.ok) throw new Error("setup failed");
    expect(a.value.device_id).toBe(rover);
    expect(b.value.device_id).toBe(otherRobot);
    expect(b.value.id).not.toBe(a.value.id);
    expect(aAgain.value.id).toBe(a.value.id);
    // An explicit id of the other robot's conversation is refused too.
    expect(resolveOrCreateConversation(pippa, "robot", a.value.id, { deviceId: otherRobot }).ok).toBe(false);
  });
});

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };

async function judgeOnce(actor: PersonRow, surface: "robot" | "chat", deviceId: string | null, userText: string, fact: Record<string, unknown>) {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const embeddings = startStubLlmServer(0);
  embeddingStub = embeddings;
  fixture = startStackFixture({
    "POST /v1/chat/completions": async (req) => {
      const request = (await req.json()) as ChatCompletionRequest;
      const name = request.response_format?.type === "json_schema" ? request.response_format.json_schema.name : undefined;
      const value = name === "memory_extraction" ? { facts: [fact] } : name === "memory_dedupe" ? { action: "ADD" } : { text: "" };
      return Response.json({ model: "scripted-judge", choices: [{ message: { role: "assistant", content: JSON.stringify(value) } }] });
    },
    "POST /v1/embeddings": async (req) => fetch(`${embeddings.url}/v1/embeddings`, { method: "POST", headers: req.headers, body: await req.arrayBuffer() }),
  });
  __setStackClientForTests(fixture.client);
  setHouseholdSettingValue("engines.stack.url", fixture.url);
  const conv = resolveOrCreateConversation(actor, surface, undefined, surface === "robot" ? { deviceId } : {});
  if (!conv.ok) throw new Error("setup failed");
  const turnId = `turn-${Math.random().toString(36).slice(2, 12)}`;
  logTurn(actor, surface, userText, { reply: { text: "Noted." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: turnId });
  const turn = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()!;
  await judgeTurn(turn);
  return db.select().from(memoryRecords).all().filter((r) => r.source === turnId);
}

describe("the memory judge on a robot conversation", () => {
  const base = { category: "fact", importance: 0.7, valid_from: null, valid_to: null, subject: null, relation: null };

  test("rapport writes person scope with the robot's device_id", async () => {
    const { pippa, rover } = await household();
    const rows = await judgeOnce(pippa, "robot", rover, "Rover and I always tell the walrus joke at bedtime", { ...base, text: "Pippa and Rover always tell the walrus joke at bedtime", scope: "person", robot_memory: "rapport" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.scope).toBe("person");
    expect(rows[0]!.person).toBe(pippa.id);
    expect(rows[0]!.deviceId).toBe(rover);
  });

  test("own writes household scope with the device_id and the deterministic child_disclosure default", async () => {
    const { pippa, rover } = await household();
    const rows = await judgeOnce(pippa, "robot", rover, "Rover, your favourite colour is teal", { ...base, text: "Rover's favourite colour is teal", scope: "person", robot_memory: "own" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.scope).toBe("household");
    expect(rows[0]!.deviceId).toBe(rover);
    expect(rows[0]!.childDisclosure).toBe("child_ok");
  });

  test("shared writes device_id null even on a robot conversation", async () => {
    const { pippa, rover } = await household();
    const rows = await judgeOnce(pippa, "robot", rover, "my sister lives in Denver", { ...base, text: "Pippa's sister lives in Denver", scope: "person", robot_memory: "shared" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.deviceId).toBeNull();
    expect(rows[0]!.scope).toBe("person");
  });

  test("a non-robot conversation always writes null even if the model says rapport", async () => {
    const { pippa } = await household();
    const rows = await judgeOnce(pippa, "chat", null, "I tell the walrus joke at bedtime", { ...base, text: "Pippa tells the walrus joke at bedtime", scope: "person", robot_memory: "rapport" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.deviceId).toBeNull();
  });
});

describe("0121 migration", () => {
  test("existing rows get device_id null, the indexes exist, and a robot's records cascade on delete", () => {
    const sqlite = new Database(":memory:");
    sqlite.run("PRAGMA foreign_keys = ON");
    sqlite.run("CREATE TABLE devices (id text PRIMARY KEY NOT NULL)");
    sqlite.run("CREATE TABLE conversations (id text PRIMARY KEY NOT NULL, person_id text)");
    sqlite.run("CREATE TABLE memory_records (id text PRIMARY KEY NOT NULL, text text)");
    sqlite.run("INSERT INTO conversations VALUES ('c1','p1')");
    sqlite.run("INSERT INTO memory_records VALUES ('m1','an old fact')");
    const file = readdirSql();
    for (const stmt of readFileSync(file, "utf-8").split("--> statement-breakpoint")) sqlite.run(stmt);
    expect(sqlite.query("SELECT device_id FROM memory_records WHERE id='m1'").get()).toEqual({ device_id: null });
    expect(sqlite.query("SELECT device_id FROM conversations WHERE id='c1'").get()).toEqual({ device_id: null });
    const idx = sqlite.query("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => (r as { name: string }).name);
    expect(idx).toContain("memory_records_device_id_idx");
    expect(idx).toContain("conversations_device_id_idx");
    sqlite.run("INSERT INTO devices VALUES ('device-aaaaaa')");
    sqlite.run("INSERT INTO memory_records (id, text, device_id) VALUES ('m2','robot fact','device-aaaaaa')");
    sqlite.run("DELETE FROM devices WHERE id='device-aaaaaa'");
    expect(sqlite.query("SELECT id FROM memory_records ORDER BY id").all()).toEqual([{ id: "m1" }]);
  });
});

function readdirSql(): string {
  return join(import.meta.dir, "../src/db/migrations/0121_curved_payback.sql");
}
