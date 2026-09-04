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
});
