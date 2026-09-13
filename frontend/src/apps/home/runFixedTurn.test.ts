import { describe, expect, test, mock } from "bun:test";
import { runFixedTurn } from "@/apps/home/runFixedTurn";
import { ndjsonStream } from "../../../tests/ndjsonStream";

// A real bug this session found (docs/BACKLOG.md): the weather card's
// fixed utterance used to write a real conversation_turns row and an
// episode every time Home loaded, since it went through the exact same
// route a household member's own typed message does with nothing to
// tell the two apart. `ephemeral: true` is that distinction.
describe("runFixedTurn", () => {
  test("marks its own request ephemeral, so it never lands in a person's real chat history", async () => {
    let capturedBody: { ephemeral?: boolean } | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/turn/stream")) {
        capturedBody = JSON.parse(String(init?.body ?? "{}"));
        return Promise.resolve(
          new Response(ndjsonStream([{ type: "done", value: { reply: { text: "Sunny." }, source: "plugin" } }]), {
            status: 200,
            headers: { "content-type": "application/x-ndjson" },
          }),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;
    try {
      const text = await runFixedTurn("whats the weather like today");
      expect(text).toBe("Sunny.");
      expect(capturedBody).toMatchObject({ ephemeral: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
