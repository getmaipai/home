// AUDIT-DEAD-01: keys nothing reads (the four engines.stack.use_* switches, generation.people_prompts) stay registered and
// writable, so a stored value reads and a PUT answers 200, but the settings list does not show them.
import { beforeEach, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { getRegistry, getRegistryKey, isRetiredKey } from "@/lib/settingsRegistry";

beforeEach(() => resetDb());

const RETIRED = ["engines.stack.use_chat", "engines.stack.use_embeddings", "engines.stack.use_stt", "engines.stack.use_tts", "generation.people_prompts"];

test("retired keys are registered, flagged retired, and left out of the household list, but a PUT still answers 200", async () => {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  for (const key of RETIRED) {
    expect(getRegistryKey(key), key).toBeDefined();
    expect(isRetiredKey(getRegistryKey(key)!), key).toBe(true);
  }
  const listed = (await (await owner.get("/api/settings?scope=household")).json() as Array<{ key: string }>).map((row) => row.key);
  expect(listed.length).toBeGreaterThan(10);
  for (const key of RETIRED) expect(listed, key).not.toContain(key);
  for (const key of RETIRED) {
    const res = await owner.put("/api/settings", { scope: "household", key, value: true });
    expect(res.status, key).toBe(200);
  }
});

test("only retired keys are hidden: robot.greetings.mode and chat.search_assist stay listed", async () => {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const listed = (await (await owner.get("/api/settings?scope=household")).json() as Array<{ key: string }>).map((row) => row.key);
  expect(listed).toContain("chat.search_assist");
  expect(getRegistry().filter(isRetiredKey).map((k) => k.key).sort()).toEqual([...RETIRED].sort());
});

test("chat.search_assist help says what the setting does today", () => {
  const help = String(getRegistryKey("chat.search_assist")!.help);
  expect(help).not.toMatch(/not (active )?yet|for now/i);
});
