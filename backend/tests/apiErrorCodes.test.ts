import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { API_ERROR_LINES, apiError, type ApiErrorLine } from "@/lib/apiErrorCopy";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

const SRC = join(import.meta.dir, "..", "src");
const routeSources = [...readdirSync(join(SRC, "routes")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(SRC, "routes", f)), join(SRC, "app.ts")];
const used = new Set(routeSources.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/apiError\("([a-z_]+)"/g)].map((m) => m[1]!)));
const lines = API_ERROR_LINES as Record<string, ApiErrorLine>;

describe("API error codes (I18N-B2)", () => {
  test("every table code with an error line is sent by a route, and every route use names a table code", () => {
    const withError = Object.entries(lines).filter(([, line]) => line.error).map(([code]) => code);
    expect(withError.filter((code) => !used.has(code))).toEqual([]);
    expect([...used].filter((code) => !(code in lines))).toEqual([]);
  });

  test("codes are snake_case, ids are unique, minor lines carry minor in the id, and no line has an em dash", () => {
    const ids: string[] = [];
    for (const [code, line] of Object.entries(lines)) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
      for (const part of [line.error, line.next]) {
        if (!part) continue;
        ids.push(part.id);
        expect(part.message.includes("—")).toBe(false);
      }
      if (line.minor) expect(line.error?.id).toContain("minor");
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("apiError keeps the shape additive: the English error, the code, the next line when there is one, then the route's extra fields", () => {
    expect(apiError("attempts_locked", { retryAfter: 30 })).toEqual({ error: "Too many attempts", code: "attempts_locked", retryAfter: 30 });
    expect(apiError("totp_already_on")).toEqual({ error: "Two-step sign-in is already on.", next: "Turn it off with a code first, then set it up again.", code: "totp_already_on" });
  });

  test("real routes answer with their code next to the same English", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const own = await client.get("/api/auth/sessions/away?personId=someone-else");
    expect(own.status).toBe(403);
    expect(await own.json()).toEqual({ error: "You can only view your own sessions.", code: "sessions_own_only" });

    const gone = await client.delete("/api/auth/sessions/no-such-session");
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "No such session", code: "no_such_session" });

    const trash = await client.post("/api/trash/memory/no-such-id/restore", {});
    expect(trash.status).toBe(404);
    expect(await trash.json()).toEqual({ error: "This item cannot be restored from your trash. Refresh Trash and try again.", code: "trash_restore_missing" });

    const profile = await new TestClient().post("/api/auth/select", { personId: "nobody" });
    expect(profile.status).toBe(404);
    expect(await profile.json()).toEqual({ error: "Profile not found", code: "profile_not_found" });
  });

  test("the validation hook adds its code and keeps its error and next", async () => {
    const res = await new TestClient().post("/api/auth/verify-secret", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; next: string; code: string };
    expect(body.code).toBe("invalid_input");
    expect(body.next).toBe("Check the fields named and send it again.");
    expect(body.error).toContain("personId");
  });
});
