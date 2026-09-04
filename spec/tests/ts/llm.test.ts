// Proves the LlamaServerClient against the stub server end to end (real
// HTTP over a real loopback socket, not a mocked fetch): the same client
// code the hub's llmSupervisor.ts points at a real llama-server when one
// is configured. See spec/llm/README.md for what this pass covers.
import { describe, expect, test, afterEach } from "bun:test";
import { LlamaServerClient, LlmClientError } from "../../llm/ts/client.js";
import { startStubLlmServer, type StubLlmServerHandle } from "../../llm/ts/stubServer.js";

let handle: StubLlmServerHandle | undefined;

afterEach(() => {
  handle?.stop();
  handle = undefined;
});

describe("LlamaServerClient against the stub server", () => {
  test("health reports ready once the stub is up", async () => {
    handle = startStubLlmServer();
    const client = new LlamaServerClient(handle.url);
    expect(await client.health()).toBe(true);
  });

  test("health returns false, not a throw, when nothing is listening", async () => {
    const client = new LlamaServerClient("http://127.0.0.1:1");
    expect(await client.health()).toBe(false);
  });

  test("listModels returns the stub's one model", async () => {
    handle = startStubLlmServer();
    const client = new LlamaServerClient(handle.url);
    const models = await client.listModels();
    expect(models.map((m) => m.id)).toEqual(["stub-chat"]);
  });

  test("chatComplete echoes the last user message, clearly marked as a stub reply", async () => {
    handle = startStubLlmServer();
    const client = new LlamaServerClient(handle.url);
    const response = await client.chatComplete({
      model: "chat",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "what's for dinner" },
      ],
    });
    expect(response.choices).toHaveLength(1);
    const reply = response.choices[0]?.message.content ?? "";
    expect(reply).toContain("what's for dinner");
    expect(reply).toContain("[stub model: no real model loaded, this is a canned reply]");
  });

  test("chatComplete uses the most recent user message when several are present", async () => {
    handle = startStubLlmServer();
    const client = new LlamaServerClient(handle.url);
    const response = await client.chatComplete({
      model: "chat",
      messages: [
        { role: "user", content: "first question" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second question" },
      ],
    });
    expect(response.choices[0]?.message.content).toContain("second question");
    expect(response.choices[0]?.message.content).not.toContain("first question");
  });

  test("chatComplete rejects a request with no messages array", async () => {
    handle = startStubLlmServer();
    const client = new LlamaServerClient(handle.url);
    await expect(
      client.chatComplete({ model: "chat", messages: undefined as unknown as [] }),
    ).rejects.toThrow(LlmClientError);
  });

  test("chatComplete throws LlmClientError when the server is unreachable", async () => {
    const client = new LlamaServerClient("http://127.0.0.1:1");
    await expect(
      client.chatComplete({ model: "chat", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(LlmClientError);
  });

  test("chatCompleteStream yields real word-by-word deltas that concatenate to the same reply chatComplete gives", async () => {
    handle = startStubLlmServer();
    const client = new LlamaServerClient(handle.url);
    const deltas: string[] = [];
    for await (const delta of client.chatCompleteStream({
      model: "chat",
      messages: [{ role: "user", content: "what's for dinner" }],
    })) {
      deltas.push(delta);
    }
    // More than one delta proves this actually streamed word by word, not
    // one chunk masquerading as streaming.
    expect(deltas.length).toBeGreaterThan(1);
    const streamed = deltas.join("");

    const buffered = await client.chatComplete({
      model: "chat",
      messages: [{ role: "user", content: "what's for dinner" }],
    });
    expect(streamed).toBe(buffered.choices[0]?.message.content);
  });

  test("chatCompleteStream throws LlmClientError when the server is unreachable", async () => {
    const client = new LlamaServerClient("http://127.0.0.1:1");
    const drain = async () => {
      for await (const _delta of client.chatCompleteStream({ model: "chat", messages: [{ role: "user", content: "hi" }] })) {
        // draining is the point - the throw happens on the first read
      }
    };
    await expect(drain()).rejects.toThrow(LlmClientError);
  });

  // A code review (2026-09-04) found `chunk.choices[0]?.delta.content`
  // threw when a frame omitted `choices` entirely (not just sent it
  // empty) - a valid-JSON, non-standard SSE frame some backends emit
  // (e.g. an inline usage/error frame). That killed the whole generation
  // on one stray frame instead of skipping it, unlike a malformed-JSON
  // line two branches up, which already degrades gracefully. A raw
  // server here, not the stub, since stubServer.ts's own canned stream
  // never produces this shape - only a deliberately malformed one does.
  test("chatCompleteStream skips a well-formed SSE frame with no choices field, rather than throwing", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "x", model: "chat", usage: { total_tokens: 3 } })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "x", model: "chat", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      },
    });
    try {
      const client = new LlamaServerClient(`http://127.0.0.1:${server.port}`);
      const deltas: string[] = [];
      for await (const delta of client.chatCompleteStream({ model: "chat", messages: [{ role: "user", content: "hi" }] })) {
        deltas.push(delta);
      }
      expect(deltas).toEqual(["hi"]);
    } finally {
      server.stop(true);
    }
  });
});
