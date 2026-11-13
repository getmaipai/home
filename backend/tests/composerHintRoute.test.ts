// ONE-COMPOSER-2026-11-13 (COMPOSER-04): the turn routes read `composer` (spec TurnComposer) beside the words, like `page_context`.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { owner } from "./support/testAuth";
import { withEngine } from "./turnMachine/modeHarness";
import { installFakeImageStack, type FakeImageStack } from "./pictureFixture";

let fake: FakeImageStack;
beforeEach(() => { resetDb(); fake = installFakeImageStack(); });
afterEach(() => { fake.restore(); delete process.env.MAIPAI_LLAMA_SERVER_URL; });
const picture = (settings: Record<string, unknown> = {}) => ({ mode: "picture", settings });

describe("the turn routes", () => {
  test("the stream route reads `composer` and adds the one item; a malformed field is ignored and the turn runs", async () => {
    const { client } = await owner();
    await withEngine(() => "Here you go.", async (seen) => {
      const response = await client.post("/api/turn/stream", { surface: "chat", text: "a dog on a beach", composer: picture({ shape: "wide" }) });
      expect(response.status).toBe(200);
      expect((await response.text()).includes('"type":"done"')).toBe(true);
      expect(JSON.stringify(seen.map((r) => r.messages))).toContain("The person chose Picture in the composer");
    });
    await withEngine(() => "Still here.", async (seen) => {
      const response = await client.post("/api/turn/stream", { surface: "chat", text: "Hello", composer: { mode: "picture", route: "generate_video", extra: true } });
      expect(response.status).toBe(200);
      expect((await response.text()).includes('"type":"done"')).toBe(true);
      expect(JSON.stringify(seen.map((r) => r.messages))).not.toContain("The person chose");
    });
  }, 30000);
});
