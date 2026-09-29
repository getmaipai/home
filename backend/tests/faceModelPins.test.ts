import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { VISION_FACE_EMBEDDER } from "@/lib/visionAssets";

beforeEach(() => resetDb());

describe("shared SFace model pin", () => {
  test("biometric enrollment and browser model serving use the same sha256", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const person = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "adultpin1" });
    const { id } = (await person.json()) as { id: string };
    const created = await owner.post("/api/biometric-prints", {
      person_id: id,
      model_id: "sface-2021dec",
      embedding: Array.from({ length: 128 }, (_, i) => i / 128),
    });

    expect(created.status).toBe(201);
    const print = (await created.json()) as { model_sha256: string };
    expect(print.model_sha256).toBe(VISION_FACE_EMBEDDER.sha256);
  });
});
