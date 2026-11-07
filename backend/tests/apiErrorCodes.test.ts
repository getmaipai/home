import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { API_ERROR_LINES, apiError, type ApiErrorLine } from "@/lib/apiErrorCopy";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

const SRC = join(import.meta.dir, "..", "src");
const routeSources = [...readdirSync(join(SRC, "routes")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(SRC, "routes", f)), join(SRC, "app.ts")];
const libSources = readdirSync(join(SRC, "lib")).filter((f) => f.endsWith(".ts") && f !== "apiErrorCopy.ts").map((f) => join(SRC, "lib", f));
const text = (file: string) => readFileSync(file, "utf8");
// A code is "named" where a route sends `apiError("code")` or a lib builds `refusal(status, "code")` / `new UploadError(status, "code")`.
const NAMING = /(?:apiError\("|refusal\([^,()]*(?:\([^()]*\))?[^,()]*, "|new UploadError\(\d+, "|invalid\(")([a-z_]+)"/g;
const used = new Set([...routeSources, ...libSources].flatMap((file) => [...text(file).matchAll(NAMING)].map((m) => m[1]!)));
// A lib that returns a code from a callback or a config object (ownedRecordCrud users, grant tier refusals) names it as a bare string.
const quoted = new Set([...routeSources, ...libSources].flatMap((file) => [...text(file).matchAll(/"([a-z][a-z_]+)"/g)].map((m) => m[1]!)));
const lines = API_ERROR_LINES as Record<string, ApiErrorLine>;

describe("API error codes (I18N-B2)", () => {
  test("every table code with an error line is sent by a route, and every route use names a table code", () => {
    const withError = Object.entries(lines).filter(([, line]) => line.error).map(([code]) => code);
    expect(withError.filter((code) => !used.has(code) && !quoted.has(code))).toEqual([]);
    expect([...used].filter((code) => !(code in lines))).toEqual([]);
  });

  test("every printed error has a code: the lib groups the audit listed carry no sentence of their own", () => {
    // I18N-B2b. These routes and libs build user-facing refusals; each names a table code (`refusal(status, "code")`, `apiError("code")`),
    // so no `error: "sentence"` literal may remain. The allowlist is the developer-only text docs/dev/api-error-audit.md lists.
    const group = [
      "routes/alarms.ts", "routes/quickTimers.ts", "routes/worldPlaces.ts", "routes/comingUp.ts", "routes/grants.ts", "routes/lists.ts", "routes/projects.ts", "routes/files.ts", "routes/library.ts",
      "lib/alarms.ts", "lib/quickTimers.ts", "lib/worldPlaces.ts", "lib/comingUp.ts", "lib/validation.ts", "lib/passkeys.ts", "lib/grants.ts", "lib/lists.ts", "lib/ownedRecordCrud.ts",
      "lib/libraryEdit.ts", "lib/libraryTrash.ts", "lib/shares.ts", "lib/libraryAudience.ts", "lib/libraryUploadStream.ts", "lib/libraryMultipart.ts", "lib/library.ts",
      "routes/passkeys.ts",
    ];
    const developerOnly = [/Invalid shared filter/, /unknown grant action:/, /candidate\.error\.issues/, /error: error\.message/, /problems\.join/, /issues\.join/];
    const stray = group.flatMap((file) => text(join(SRC, file)).split("\n").filter((line) => /\berror: ["`]/.test(line) && !developerOnly.some((ok) => ok.test(line))).map((line) => `${file}: ${line.trim().slice(0, 100)}`));
    expect(stray).toEqual([]);
  });

  test("a lib refusal answers with its code, the table's English and the status", async () => {
    const tooShort = await new TestClient().post("/api/auth/setup", { displayName: "Sage", secret: "x" });
    expect(tooShort.status).toBe(400);
    expect(await tooShort.json()).toEqual(apiError("secret_length"));
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const alarm = await client.post("/api/alarms", { time: "not a time" });
    expect(alarm.status).toBe(400);
    expect(await alarm.json()).toEqual(apiError("alarm_invalid"));
    const gone = await client.delete("/api/alarms/alarm-none");
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual(apiError("alarm_missing"));
    const timer = await client.post("/api/quick-timers", { name: "", minutes: 5 });
    expect(await timer.json()).toEqual(apiError("quick_timer_invalid"));
    const place = await client.post("/api/world-places", { name: "Nowhere", country: "X", zone: "Not/AZone" });
    expect(await place.json()).toEqual(apiError("world_place_zone_invalid"));
    const list = await client.get("/api/lists/list-none");
    expect(list.status).toBe(404);
    expect(await list.json()).toEqual(apiError("list_missing"));
    const project = await client.get("/api/projects/project-none");
    expect(await project.json()).toEqual(apiError("project_missing"));
    const grant = await client.delete("/api/grants/grant-none");
    expect(await grant.json()).toEqual(apiError("grant_missing"));
    const file = await client.get("/api/files/file-none");
    expect(await file.json()).toEqual(apiError("file_not_in_library"));
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
