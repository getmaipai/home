import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetTtsSupervisorForTests } from "@/lib/ttsSupervisor";
import { synthesizeSpeech } from "@/lib/tts";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

afterEach(() => {
  __resetTtsSupervisorForTests();
});

describe("lib/tts.ts synthesizeSpeech()", () => {
  test("returns a real WAV stream from the stub backend (no real engine in tests)", async () => {
    const result = await synthesizeSpeech("good morning");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contentType).toBe("audio/wav");
      const audio = new Uint8Array(await new Response(result.value.stream).arrayBuffer());
      expect(audio.byteLength).toBeGreaterThan(44); // header + some samples
    }
  });

  test("rejects an empty string", async () => {
    const result = await synthesizeSpeech("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });

  test("rejects a whitespace-only string", async () => {
    const result = await synthesizeSpeech("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });

  test("rejects text past the length cap", async () => {
    const result = await synthesizeSpeech("a".repeat(4_001));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });
});

describe("POST /api/tts", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.post("/api/tts", { text: "hi" });
    expect(res.status).toBe(401);
  });

  test("returns real audio/wav bytes for a signed-in person", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/tts", { text: "good morning" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 4)).toString("ascii")).toBe("RIFF");
  });

  test("returns 400 with a code for empty text", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/tts", { text: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_input");
  });
});
