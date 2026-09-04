import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { complete } from "@/lib/llm";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
});

describe("lib/llm.ts complete()", () => {
  test("chat role gets a real reply from the stub backend (no engine configured in tests)", async () => {
    const result = await complete("chat", [{ role: "user", content: "what's for dinner" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toContain("what's for dinner");
      expect(result.value.text).toContain("[stub model: no real model loaded, this is a canned reply]");
    }
  });

  test("an unimplemented role is a real, named gap, not a crash", async () => {
    const result = await complete("embed", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported_role");
      expect(result.status).toBe(400);
    }
  });

  test("rejects an empty messages array", async () => {
    const result = await complete("chat", []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });

  test("rejects a message with an invalid role", async () => {
    const result = await complete("chat", [{ role: "narrator" as never, content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });
});

describe("POST /api/llm/chat", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.post("/api/llm/chat", { messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(401);
  });

  test("returns a real chat reply for a signed-in person", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/llm/chat", {
      messages: [{ role: "user", content: "good morning" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; model: string };
    expect(body.text).toContain("good morning");
  });

  test("returns 400 for an unimplemented role, with a code the caller can branch on", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/llm/chat", {
      role: "vision",
      messages: [{ role: "user", content: "what's in this photo" }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unsupported_role");
  });

  test("returns 400 for a missing messages array", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/llm/chat", {});
    expect(res.status).toBe(400);
  });
});
