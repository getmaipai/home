import { describe, expect, test } from "bun:test";
import { checkVideoPrompt } from "../src/lib/videos/promptCheck";

describe("checkVideoPrompt", () => {
  test("a plain prompt has no findings", () => {
    expect(checkVideoPrompt("A paper boat drifts down a rainy street at dusk.", { seconds: 5 })).toEqual([]);
  });
  test("dialogue longer than the clip is an error with no automatic fix", () => {
    const f = checkVideoPrompt('A man says "I have been waiting for you all night and I cannot believe you came back to the old house".', { seconds: 4 });
    expect(f[0]).toMatchObject({ code: "dialogue_too_long", level: "error", fix: null });
  });
  test("an ellipsis inside a line is mended and the words outside are kept", () => {
    const f = checkVideoPrompt('She whispers "Wait... come back." near the door...');
    const hit = f.find((x) => x.code === "dialogue_ellipsis");
    expect(hit?.fix).toBe('She whispers "Wait, come back." near the door...');
  });
  test("negatives and filler are removed by the fix", () => {
    const f = checkVideoPrompt("A beautiful fox in snow, no blur.");
    expect(f.find((x) => x.code === "unanchored_negative")?.fix).toBe("A beautiful fox in snow.");
    expect(f.find((x) => x.code === "filler_words")?.fix).toBe("A fox in snow, no blur.");
  });
  test("two camera moves warn; one does not; words in dialogue do not count", () => {
    expect(checkVideoPrompt("Slow dolly in while the camera pans left.").map((x) => x.code)).toContain("many_camera_moves");
    expect(checkVideoPrompt("Slow dolly in on a candle.")).toEqual([]);
    expect(checkVideoPrompt('He says "pan the zoom crane" and smiles.')).toEqual([]);
  });
  test("errors sort first and an over-long prompt is an error", () => {
    const f = checkVideoPrompt(`${"a ".repeat(700)}very bright`);
    expect(f[0]?.code).toBe("too_long");
  });
});

import { beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

describe("POST /api/videos/check-prompt", () => {
  let client: TestClient;
  beforeEach(async () => {
    resetDb();
    client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  });
  test("returns findings for a signed-in person and 401 for nobody", async () => {
    const res = await client.post("/api/videos/check-prompt", { prompt: "A very calm lake, no blur.", seconds: 5 });
    expect(res.status).toBe(200);
    const body = await res.json() as { findings: Array<{ code: string }> };
    expect(body.findings.map((f) => f.code).sort()).toEqual(["filler_words", "unanchored_negative"]);
    expect((await new TestClient().post("/api/videos/check-prompt", { prompt: "x" })).status).toBe(401);
  });
});
