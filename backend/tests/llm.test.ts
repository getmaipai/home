import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetEmbedSupervisorForTests } from "@/lib/embedSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { complete, startCompleteStream, embed, PERSON_TURN_BUDGET, type ToolSpec } from "@/lib/llm";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetEmbedSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
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

/** Session C step 2: points the chat backend at a fresh stub scripted to
 * answer a tool-call request specifically - memoryJudge.test.ts's own
 * withScriptedJudge() precedent, keyed the same way (response_format's
 * own json_schema.name, "tool_calls" here). A plain string reply falls
 * through to the default echo, matching a call that never offered
 * tools at all. */
async function withScriptedToolCall<T>(reply: (request: ChatCompletionRequest) => string, fn: () => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      if (request.response_format?.type !== "json_schema" || request.response_format.json_schema.name !== "tool_calls") return undefined;
      return reply(request);
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    stub.stop();
  }
}

const WEATHER_TOOL: ToolSpec = { id: "weather", description: "current weather for a place", args: { type: "object", required: ["place"], properties: { place: { type: "string" } } } };
const TRIVIA_TOOL: ToolSpec = { id: "trivia", description: "a trivia question", args: { type: "object", properties: {} } };

describe("lib/llm.ts complete() with tools (Session C step 2)", () => {
  test("a scripted valid tool-call reply parses into tool_calls", async () => {
    const result = await withScriptedToolCall(
      () => JSON.stringify([{ tool: "weather", args: { place: "Seattle" } }]),
      () => complete("chat", [{ role: "user", content: "what's the weather in Seattle" }], { tools: [WEATHER_TOOL] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_calls).toEqual([{ tool: "weather", args: { place: "Seattle" } }]);
  });

  test("two independent calls in one reply both parse", async () => {
    const result = await withScriptedToolCall(
      () => JSON.stringify([{ tool: "weather", args: { place: "Denver" } }, { tool: "trivia", args: {} }]),
      () => complete("chat", [{ role: "user", content: "weather in Denver and a trivia question" }], { tools: [WEATHER_TOOL, TRIVIA_TOOL] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_calls).toHaveLength(2);
  });

  test("an empty array is a real decision (no tool fits), not a parse failure", async () => {
    const result = await withScriptedToolCall(
      () => "[]",
      () => complete("chat", [{ role: "user", content: "hi there" }], { tools: [WEATHER_TOOL] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_calls).toEqual([]);
  });

  test("a reply that isn't the requested shape at all is a parse failure (undefined), never a silent drop into an empty decision", async () => {
    const result = await withScriptedToolCall(
      () => "I'm not sure, let me think about that.",
      () => complete("chat", [{ role: "user", content: "what's the weather in Seattle" }], { tools: [WEATHER_TOOL] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_calls).toBeUndefined();
  });

  test("a call naming a tool that wasn't offered is a parse failure too", async () => {
    const result = await withScriptedToolCall(
      () => JSON.stringify([{ tool: "not-offered", args: {} }]),
      () => complete("chat", [{ role: "user", content: "hi" }], { tools: [WEATHER_TOOL] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_calls).toBeUndefined();
  });

  test("more than two calls in one reply is a parse failure (the cap is enforced on the way in, not trusted from the grammar alone)", async () => {
    const result = await withScriptedToolCall(
      () => JSON.stringify([{ tool: "weather", args: { place: "A" } }, { tool: "weather", args: { place: "B" } }, { tool: "trivia", args: {} }]),
      () => complete("chat", [{ role: "user", content: "hi" }], { tools: [WEATHER_TOOL, TRIVIA_TOOL] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_calls).toBeUndefined();
  });

  test("tool_choice: required is sent through as minItems: 1 on the grammar schema", async () => {
    let seenSchema: unknown;
    await withScriptedToolCall(
      (request) => {
        if (request.response_format?.type === "json_schema") seenSchema = request.response_format.json_schema.schema;
        return "[]";
      },
      () => complete("chat", [{ role: "user", content: "hi" }], { tools: [WEATHER_TOOL], tool_choice: "required" }),
    );
    expect((seenSchema as { minItems: number }).minItems).toBe(1);
  });

  test("tool_choice: required also re-checks minItems:1 on the reply itself, not just the schema it asked for - an empty array is a parse failure here, never a real 'no tool needed' decision", async () => {
    const result = await withScriptedToolCall(
      () => "[]", // llama.cpp's lazy grammars can still let this through despite minItems:1 (upstream issue 24807)
      () => complete("chat", [{ role: "user", content: "hi" }], { tools: [WEATHER_TOOL], tool_choice: "required" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_calls).toBeUndefined();
  });

  test("no tools offered means an ordinary reply, tool_calls absent entirely", async () => {
    const result = await complete("chat", [{ role: "user", content: "good morning" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tool_calls).toBeUndefined();
  });
});

describe("lib/llm.ts startCompleteStream()", () => {
  test("chat role streams real deltas from the stub backend that concatenate to the same reply complete() gives", async () => {
    const started = await startCompleteStream("chat", [{ role: "user", content: "what's for dinner" }]);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const deltas: string[] = [];
    for await (const delta of started.tokens) deltas.push(delta);
    expect(deltas.length).toBeGreaterThan(1);
    const streamed = deltas.join("");

    const buffered = await complete("chat", [{ role: "user", content: "what's for dinner" }]);
    expect(buffered.ok).toBe(true);
    if (buffered.ok) expect(streamed).toBe(buffered.value.text);
  });

  test("an unimplemented role fails before any streaming starts, the same real gap complete() reports", async () => {
    const started = await startCompleteStream("embed", [{ role: "user", content: "hi" }]);
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.code).toBe("unsupported_role");
      expect(started.status).toBe(400);
    }
  });

  test("rejects an empty messages array before any streaming starts", async () => {
    const started = await startCompleteStream("chat", []);
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.code).toBe("invalid_input");
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

  test("shares turn.ts's per-person rate limit (Session C step 0, wave-2.md): a burst spent on /api/turn also exhausts /api/llm/chat", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    for (let i = 0; i < PERSON_TURN_BUDGET.capacity; i++) {
      expect((await owner.post("/api/turn", { text: "hi" })).status).toBe(200);
    }
    const res = await owner.post("/api/llm/chat", { messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("turn_rate_limited");
  });
});

describe("lib/llm.ts embed()", () => {
  test("returns a real vector per input, from the stub backend (no engine configured in tests)", async () => {
    const result = await embed(["hello", "world"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.vectors.length).toBe(2);
    expect(result.value.vectors[0]!.length).toBe(768);
    expect(result.value.vectors[0]).not.toEqual(result.value.vectors[1]);
  });

  test("rejects an empty array", async () => {
    const result = await embed([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });

  test("rejects an array containing an empty string", async () => {
    const result = await embed(["hello", ""]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });
});

describe("POST /api/llm/embed", () => {
  test("requires a signed-in person", async () => {
    const res = await new TestClient().post("/api/llm/embed", { texts: ["hi"] });
    expect(res.status).toBe(401);
  });

  test("returns real vectors for a signed-in person", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/llm/embed", { texts: ["good morning", "good night"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vectors: number[][]; model: string };
    expect(body.vectors.length).toBe(2);
    expect(body.vectors[0]!.length).toBe(768);
  });

  test("returns 400 for a missing texts array", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/llm/embed", {});
    expect(res.status).toBe(400);
  });

  test("also shares the per-person rate limit", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    for (let i = 0; i < PERSON_TURN_BUDGET.capacity; i++) {
      expect((await owner.post("/api/turn", { text: "hi" })).status).toBe(200);
    }
    const res = await owner.post("/api/llm/embed", { texts: ["hi"] });
    expect(res.status).toBe(429);
  });
});
