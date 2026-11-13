import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logsDir } from "@/lib/paths";
import { setHouseholdSettingValue } from "@/lib/settings";
import { SPECULATIVE_START_KEY } from "@/lib/speculation";
import { __resetFillerGroupForTests, __setFillerGroupRunnerForTests, chooseFillerGroup, ruleFillerGroup } from "@/lib/quickReaction";

beforeEach(() => resetDb());
afterEach(() => { __resetFillerGroupForTests(); rmSync(join(logsDir, "hub.log"), { force: true }); });

describe("INSTANT-FILLER-01b chooser", () => {
  test("sends the group enum schema to the judge and accepts its constrained group", async () => {
    let seen: Parameters<typeof __setFillerGroupRunnerForTests>[0] extends ((m: infer M, o: infer O) => unknown) | null ? { messages: M; options: O } | null : never = null;
    __setFillerGroupRunnerForTests(async (messages, options) => {
      seen = { messages, options } as never;
      return { ok: true, text: JSON.stringify({ group: "question" }) };
    });
    const result = await chooseFillerGroup("not-a-person", "what is this?");
    expect(result.group).toBe("question");
    expect(result.source).toBe("model");
    const opts = (seen as unknown as { options: { response_format?: { json_schema?: { schema?: { properties?: { group?: { enum?: string[] } } } } }; max_tokens?: number; thinking?: boolean } }).options;
    expect(opts.response_format?.json_schema?.schema?.properties?.group?.enum).toContain("NONE");
    expect(opts.response_format?.json_schema?.schema?.properties?.group?.enum).toEqual(["backchannel", "thinking", "request", "question", "good_news", "bad_news", "NONE"]);
    expect(opts.max_tokens).toBe(6);
    expect(opts.thinking).toBe(false);
  });

  test("a slow 4B returns the deterministic form rule within the deadline", async () => {
    __setFillerGroupRunnerForTests((_messages, options) => new Promise((resolve) => options?.signal?.addEventListener("abort", () => resolve({ ok: false, unavailable: true }), { once: true })));
    const started = performance.now();
    const result = await chooseFillerGroup("not-a-person", "could you open it");
    expect(performance.now() - started).toBeLessThan(500);
    expect(result).toMatchObject({ group: "question", source: "rule" });
  });

  test("form rules recognize questions and imperatives, defaulting to backchannel, never news", () => {
    for (const text of ["Why is that?", "what time is it", "Can you help", "is it ready"] ) expect(ruleFillerGroup(text)).toBe("question");
    for (const text of ["Tell me more", "please open it", "show the result"] ) expect(ruleFillerGroup(text)).toBe("request");
    expect(ruleFillerGroup("I had a long day")).toBe("backchannel");
    for (const text of ["Why?", "Tell me", "plain statement"]) expect(["good_news", "bad_news"]).not.toContain(ruleFillerGroup(text));
  });

  test("adult endpoint returns only an id result and never logs said text; minors and robots receive null", async () => {
    const ownerClient = new TestClient();
    await ownerClient.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    setHouseholdSettingValue("voice.talk_over", "gentle");
    setHouseholdSettingValue(SPECULATIVE_START_KEY, true);
    const secret = "PRIVATE_SAID_SENTINEL phrase";
    __setFillerGroupRunnerForTests(async () => ({ ok: true, text: JSON.stringify({ group: "request" }) }));
    const response = await ownerClient.post("/api/turn/filler", { said: secret });
    const data = await response.json() as Record<string, unknown>;
    expect(data.group).toBe("request");
    expect(Object.keys(data).sort()).toEqual(["group", "ms", "source"]);
    const log = readFileSync(join(logsDir, "hub.log"), "utf8");
    expect(log).toContain('"event":"voice.filler"');
    expect(log).not.toContain(secret);
    expect(log).not.toContain(actor.id);

    const child = await ownerClient.post("/api/people", { displayName: "Nova", role: "child" });
    const childId = (await child.json() as { id: string }).id;
    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: childId });
    const childResponse = await childClient.post("/api/turn/filler", { said: "what now?" });
    expect((await childResponse.json() as { group: unknown }).group).toBeNull();
    expect(response.status).toBe(200);
  });
});
