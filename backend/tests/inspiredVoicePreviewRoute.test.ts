// VOICE-INSPIRED-02: POST /api/voice/cloned/preview returns a short shifted sample and saves nothing.
import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { clonedVoices } from "@/db/schema";
import { decodeWavClip, encodeWavClip } from "@/lib/voiceShift";

beforeEach(() => { resetDb(); });

const RATE = 24000;
function clipFile(seconds = 7): File {
  const samples = new Float32Array(RATE * seconds);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.4 * Math.sin((2 * Math.PI * 120 * i) / RATE);
  return new File([encodeWavClip({ samples, sampleRate: RATE })], "clip.wav", { type: "audio/wav" });
}
function form(fields: Record<string, string>, file: File | null = clipFile()): FormData {
  const data = new FormData();
  if (file) data.set("file", file);
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("POST /api/voice/cloned/preview", () => {
  test("a member gets about four seconds of WAV and nothing is saved", async () => {
    const owner = new TestClient();
    expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
    const created = (await (await owner.post("/api/people", { displayName: "Nova", role: "teen", secret: "0000" })).json()) as { id: string };
    const teen = new TestClient();
    expect((await teen.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" })).status).toBe(200);
    for (const client of [owner, teen]) {
      const res = await client.postForm("/api/voice/cloned/preview", form({ inspired_level: "lower" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("audio/wav");
      expect(decodeWavClip(new Uint8Array(await res.arrayBuffer()))!.samples.length).toBe(RATE * 4);
    }
    expect(db.select().from(clonedVoices).all()).toHaveLength(0);
  });

  test("a missing file, a bad level and an unknown blend voice are refused", async () => {
    const owner = new TestClient();
    expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
    expect((await owner.postForm("/api/voice/cloned/preview", form({ inspired_level: "lower" }, null))).status).toBe(400);
    expect((await owner.postForm("/api/voice/cloned/preview", form({ inspired_level: "wild" }))).status).toBe(400);
    expect((await owner.postForm("/api/voice/cloned/preview", form({ inspired_level: "lower", base_voice_id: "voice-nosuchone1" }))).status).toBe(404);
  });

  test("a signed-out request is refused", async () => {
    expect((await new TestClient().postForm("/api/voice/cloned/preview", form({ inspired_level: "lower" }))).status).toBe(401);
  });
});
