import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import { db } from "@/db";
import { HTTPException } from "hono/http-exception";
import { app } from "@/app";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

// A signed-in request to a real route whose first database read throws.
async function failingRequest(failure: unknown): Promise<Response> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const spy = spyOn(db, "select").mockImplementation(() => { throw failure; });
  try { return await client.get("/api/auth/sessions"); } finally { spy.mockRestore(); }
}

describe("app.onError", () => {
  test("an unexpected throw answers the JSON 500 with a next step and no cause text", async () => {
    const res = await failingRequest(new Error("secret detail at /Users/example/file.ts"));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toEqual({ error: "Home hit a problem it did not expect.", next: "Try again. If it keeps happening, open Repairs.", code: "internal" });
    expect(JSON.stringify(body)).not.toContain("/Users");
  });

  test("an HTTPException keeps its own status and message", async () => {
    const res = await failingRequest(new HTTPException(418, { message: "I am a teapot" }));
    expect(res.status).toBe(418);
    expect(await res.json()).toMatchObject({ error: "I am a teapot" });
  });

  test("the log line carries method and path but not the request body", async () => {
    const lines: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { lines.push(args); };
    try {
      await failingRequest(new Error("boom"));
    } finally { console.error = original; }
    expect(String(lines.find((l) => String(l[0]).startsWith("[http]"))?.[0])).toBe("[http] GET /api/auth/sessions");
  });
});

describe("validation messages name the field", () => {
  test("POST /api/auth/verify-secret {} names personId and secret", async () => {
    const res = await new TestClient().post("/api/auth/verify-secret", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; next?: string };
    expect(body.error).toContain("personId");
    expect(body.error).toContain("secret");
    expect(body.next).toBe("Check the fields named and send it again.");
  });
});
