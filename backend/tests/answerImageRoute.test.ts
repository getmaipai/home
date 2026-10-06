import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { putAnswerImage } from "@/lib/answerImages/cache";

beforeEach(() => resetDb());
async function owner(): Promise<TestClient> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}

describe("GET /api/answer-image/:id", () => {
  test("serves a cached opaque id with safe image headers and has no URL proxy parameter", async () => {
    const client = await owner();
    const id = await putAnswerImage({ tile: new Uint8Array([1, 2]), full: new Uint8Array([3]), band: "adult" });
    const image = await client.get(`/api/answer-image/${id}?v=tile`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(image.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(image.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect((await client.get("/api/answer-image?url=https://example.com/image.png")).status).toBe(404);
  });

  test("a child gets 404 for an adult-only cache entry", async () => {
    const adult = await owner();
    const created = await adult.post("/api/people", { displayName: "Robin", role: "child", secret: "child-secret" });
    expect(created.status).toBe(201);
    const { id: personId } = await created.json() as { id: string };
    const child = new TestClient();
    await child.post("/api/auth/verify-secret", { personId, secret: "child-secret" });
    const id = await putAnswerImage({ tile: new Uint8Array([8]), full: new Uint8Array([9]), band: "adult" });
    expect((await child.get(`/api/answer-image/${id}?v=tile`)).status).toBe(404);
  });
});
