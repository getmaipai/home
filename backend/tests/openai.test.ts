import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { PERSON_TURN_BUDGET } from "@/lib/llm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
});

async function ownerWithApiToken(): Promise<{ token: string; personId: string }> {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const res = await owner.post("/api/settings/api-token", {});
  const body = (await res.json()) as { token: string };
  return { token: body.token, personId: person.id };
}

describe("POST /v1/chat/completions", () => {
  test("refuses a request with no token", async () => {
    const client = new TestClient();
    const res = await client.post("/v1/chat/completions", { messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(401);
  });

  test("refuses a garbage bearer token", async () => {
    const client = new TestClient();
    const res = await client.request("/v1/chat/completions", {
      method: "POST",
      body: { messages: [{ role: "user", content: "hi" }] },
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });

  test("a valid token gets a real, non-streaming OpenAI-shaped reply from the real turn engine", async () => {
    const { token } = await ownerWithApiToken();
    const client = new TestClient();
    const res = await client.request("/v1/chat/completions", {
      method: "POST",
      body: { model: "maipai", messages: [{ role: "user", content: "good morning" }] },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { choices: { message: { role: string; content: string } }[] };
    expect(body.choices[0]!.message.role).toBe("assistant");
    expect(body.choices[0]!.message.content).toContain("good morning");
  });

  test("takes the LAST user message, not the first, when the client sends a full history", async () => {
    const { token } = await ownerWithApiToken();
    const client = new TestClient();
    const res = await client.request("/v1/chat/completions", {
      method: "POST",
      body: {
        messages: [
          { role: "user", content: "first message" },
          { role: "assistant", content: "an earlier reply" },
          { role: "user", content: "second message" },
        ],
      },
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    expect(body.choices[0]!.message.content).toContain("second message");
    expect(body.choices[0]!.message.content).not.toContain("first message");
  });

  test("rejects a request with no user message at all", async () => {
    const { token } = await ownerWithApiToken();
    const client = new TestClient();
    const res = await client.request("/v1/chat/completions", {
      method: "POST",
      body: { messages: [{ role: "system", content: "you are helpful" }] },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });

  test("a streaming request gets a real Server-Sent Events response ending in [DONE]", async () => {
    const { token } = await ownerWithApiToken();
    const client = new TestClient();
    const res = await client.request("/v1/chat/completions", {
      method: "POST",
      body: { messages: [{ role: "user", content: "hello there" }], stream: true },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    const lines = text.trim().split("\n\n").filter((l) => l.startsWith("data: "));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.at(-1)).toBe("data: [DONE]");
    const chunks = lines.slice(0, -1).map((l) => JSON.parse(l.slice("data: ".length)) as { choices: { delta: { role?: string; content?: string } }[] });
    expect(chunks[0]!.choices[0]!.delta.role).toBe("assistant");
    const fullText = chunks.map((c) => c.choices[0]!.delta.content ?? "").join("");
    expect(fullText).toContain("hello there");
  });

  test("shares the same per-person turn rate limit as /api/turn and /api/llm/chat", async () => {
    const { token, personId } = await ownerWithApiToken();
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Bystander", secret: "correcthorse2" });
    void personId;
    for (let i = 0; i < PERSON_TURN_BUDGET.capacity; i++) {
      const client = new TestClient();
      const res = await client.request("/v1/chat/completions", {
        method: "POST",
        body: { messages: [{ role: "user", content: "hi" }] },
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    }
    const client = new TestClient();
    const res = await client.request("/v1/chat/completions", {
      method: "POST",
      body: { messages: [{ role: "user", content: "hi" }] },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(429);
  });

  test("an unimplemented surface header is refused honestly, not silently mapped to chat", async () => {
    const { token } = await ownerWithApiToken();
    const client = new TestClient();
    const res = await client.request("/v1/chat/completions", {
      method: "POST",
      body: { messages: [{ role: "user", content: "hi" }] },
      headers: { authorization: `Bearer ${token}`, "x-maipai-surface": "robot" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unsupported_surface");
  });
});

describe("API token generate/revoke (POST/DELETE /api/settings/api-token)", () => {
  test("generating a new token replaces the old one - the old one stops working", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const first = (await (await owner.post("/api/settings/api-token", {})).json()) as { token: string };
    const second = (await (await owner.post("/api/settings/api-token", {})).json()) as { token: string };
    expect(first.token).not.toBe(second.token);

    const client = new TestClient();
    const withOld = await client.request("/v1/chat/completions", {
      method: "POST",
      body: { messages: [{ role: "user", content: "hi" }] },
      headers: { authorization: `Bearer ${first.token}` },
    });
    expect(withOld.status).toBe(401);

    const withNew = await client.request("/v1/chat/completions", {
      method: "POST",
      body: { messages: [{ role: "user", content: "hi" }] },
      headers: { authorization: `Bearer ${second.token}` },
    });
    expect(withNew.status).toBe(200);
  });

  test("revoking a token makes it stop working immediately", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const { token } = (await (await owner.post("/api/settings/api-token", {})).json()) as { token: string };

    const revoke = await owner.request("/api/settings/api-token", { method: "DELETE" });
    expect(revoke.status).toBe(200);

    const client = new TestClient();
    const res = await client.request("/v1/chat/completions", {
      method: "POST",
      body: { messages: [{ role: "user", content: "hi" }] },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  test("requires a signed-in session to generate one", async () => {
    const client = new TestClient();
    const res = await client.post("/api/settings/api-token", {});
    expect(res.status).toBe(401);
  });
});
