import { afterEach, describe, expect, spyOn, test, mock } from "bun:test";
import { runFixedTurn } from "@/apps/home/runFixedTurn";
import { ndjsonStream } from "../../../tests/ndjsonStream";
import { api } from "@/lib/api";

afterEach(() => mock.restore());

// A real bug this session found (docs/BACKLOG.md): the weather card's
// fixed utterance used to write a real conversation_turns row and an
// episode every time Home loaded, since it went through the exact same
// route a household member's own typed message does with nothing to
// tell the two apart. `ephemeral: true` is that distinction.
describe("runFixedTurn", () => {
  test("marks its own request ephemeral, so it never lands in a person's real chat history", async () => {
    const response = new Response(ndjsonStream([{ type: "done", value: { reply: { text: "Sunny." }, source: "plugin" } }]), {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });
    const streamTurn = spyOn(api, "streamTurn").mockResolvedValue(response);
    const text = await runFixedTurn("whats the weather like today");
    expect(text).toBe("Sunny.");
    expect(streamTurn).toHaveBeenCalledWith("whats the weather like today", undefined, { ephemeral: true });
  });
});
