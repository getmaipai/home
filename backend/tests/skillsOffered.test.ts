import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { useDefaultScriptedStack } from "./stackFixture";
import { createBenchPeople, startRecordingProxy } from "../scripts/bench/conversationRunner";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { writtenChatToolIds } from "@/routes/plugins";
import { db, sqlite } from "@/db";
import { people } from "@/db/schema";
import { newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { randomSuffix } from "@/lib/id";
import type { PersonRow } from "@/types";

// SKILLS-PAGE-01: the Customize page's "Used in chat" must be the set the
// turn really offers. These run a real written turn for an adult, a teen
// and a child against a stub engine and compare the tools it was sent
// with what the page's helper reports.

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

function insertPerson(displayName: string, role: string): PersonRow {
  const id = newPersonId();
  const now = new Date().toISOString();
  sqlite
    .query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, 'bench', 0, ?, ?, ?)")
    .run(id, displayName, role, randomSuffix(12), now, now, nextHlc());
  return db.select().from(people).where(eq(people.id, id)).get()!;
}

async function toolsSentOnATurn(actor: PersonRow): Promise<string[]> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  let sent: string[] | null = null;
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request: ChatCompletionRequest) => {
      sent ??= (request.tools ?? []).map((tool) => tool.function.name).sort();
      return "Hello there.";
    },
  });
  const proxy = startRecordingProxy(stub.url);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  __resetLlmSupervisorForTests();
  try {
    const result = await runTurnNext(actor, "chat", "hello, how are you today");
    expect(result.ok).toBe(true);
  } finally {
    proxy.stop();
    await stub.stop();
  }
  return sent ?? [];
}

describe("Used in chat matches the turn", () => {
  test("for an adult, a teen and a child", async () => {
    const bench = createBenchPeople();
    const teen = insertPerson("Juniper", "teen");
    for (const person of [bench.owner, teen, bench.child]) {
      const sent = await toolsSentOnATurn(person);
      const reported = [...(await writtenChatToolIds(person))].sort();
      expect(reported, `${person.role}'s offered tools`).toEqual(sent);
    }
  });

  test("GET /api/plugins/skills marks what each person's chat offers, lists every skill kind, and says bundled", async () => {
    const client = new TestClient();
    expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
    const rows = (await (await client.get("/api/plugins/skills")).json()) as Array<{ id: string; kind: string; origin: string; used_in_chat: boolean; offer_label: string | null }>;
    const owner = db.select().from(people).where(eq(people.role, "owner")).get()!;
    const offered = await writtenChatToolIds(owner);
    expect(offered.size).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.origin).toBe("bundled");
      if (row.kind === "plugin") expect(row.used_in_chat).toBe(offered.has(row.id));
    }
    expect(rows.find((r) => r.id === "weather")?.used_in_chat).toBe(true);
    expect(rows.find((r) => r.id === "joke")?.used_in_chat).toBe(false);
    expect(rows.find((r) => r.id === "currency")?.offer_label).toBe("not offered: not measured");
    expect(rows.find((r) => r.id === "recall")?.offer_label).toBe("not offered: Memory is already supplied as context; a separate recall call duplicated retrieval.");
    // Handler, SKILL.md and plan.json packages are skills too, and a companion is not.
    expect(rows.find((r) => r.id === "almanac-date")?.used_in_chat).toBe(true);
    expect(rows.find((r) => r.id === "storytime-style")?.kind).toBe("skill");
    expect(rows.find((r) => r.id === "bedtime-storybook")?.kind).toBe("project");
    expect(rows.some((r) => r.id === "buddy")).toBe(false);

    const childRes = await client.post("/api/people", { displayName: "Sprout", role: "child" });
    const childId = ((await childRes.json()) as { id: string }).id;
    const child = new TestClient();
    await child.post("/api/auth/select", { personId: childId });
    const childRows = (await (await child.get("/api/plugins/skills")).json()) as Array<{ id: string; kind: string; used_in_chat: boolean }>;
    const childOffered = await writtenChatToolIds(db.select().from(people).where(eq(people.id, childId)).get()!);
    expect(childRows.length).toBeGreaterThan(0);
    for (const row of childRows) if (row.kind === "plugin") expect(row.used_in_chat).toBe(childOffered.has(row.id));
  });

  test("every base tool appears on an adult written request for each catalog chat model", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const owner = db.select().from(people).where(eq(people.role, "owner")).get()!;
    const { CATALOG } = await import("@/lib/modelCatalog");
    const base = ["almanac-date", "almanac-time", "convert", "math", "remember", "remind", "start_project", "timer", "weather", "websearch"];
    for (const model of CATALOG.filter((entry) => entry.role === "chat" && entry.turn_budget)) {
      setHouseholdSettingValue("chat.model_id", model.id);
      const sent = await toolsSentOnATurn(owner);
      for (const id of base) expect(sent, `${id} for ${model.id}`).toContain(id);
      expect(sent, `off policy for ${model.id}`).not.toContain("show_images");
    }
  });

  test("a package its smoke test disabled is never used in chat", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    sqlite.query("INSERT OR REPLACE INTO package_status (package_id, status, last_smoke_at, smoke_ok, smoke_message) VALUES ('weather', 'disabled', ?, 0, 'broken')").run(new Date().toISOString());
    const rows = (await (await client.get("/api/plugins/skills")).json()) as Array<{ id: string; used_in_chat: boolean }>;
    expect(rows.find((r) => r.id === "weather")?.used_in_chat).toBe(false);
  });
});
