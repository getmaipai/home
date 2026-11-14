import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "@/db";
import { people, sessions } from "@/db/schema";
import { clientErrorRoutes } from "@/routes/clientErrors";
import { resetDb } from "../../tests/reset-db";

const app = new OpenAPIHono();
app.route("/api/client-errors", clientErrorRoutes);
const now = new Date().toISOString();
function addPerson(id: string) {
  db.insert(people).values({ id, displayName: id, role: "owner", avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  const token = `client-error-${id}`;
  db.insert(sessions).values({ id: `session-${id}`, personId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
  return token;
}
async function request(token: string | null, body: string, headers: Record<string, string> = {}) {
  return app.request("http://localhost/api/client-errors", { method: "POST", headers: { "content-type": "application/json", ...(token ? { cookie: `session=${token}` } : {}), ...headers }, body });
}

beforeEach(() => resetDb());
afterEach(() => { console.error = originalConsoleError; resetDb(); });
const originalConsoleError = console.error;

describe("POST /api/client-errors", () => {
  test("requires a signed-in person", async () => {
    expect((await request(null, JSON.stringify({ kind: "error" }))).status).toBe(401);
  });

  test("caps request size at 4 KB", async () => {
    const token = addPerson("client-error-size");
    expect((await request(token, JSON.stringify({ kind: "error", message: "x".repeat(5000) }))).status).toBe(413);
  });

  test("rate limits each person to ten reports per minute", async () => {
    const token = addPerson("client-error-rate");
    console.error = () => {};
    const body = JSON.stringify({ kind: "error", message: "decode failed" });
    for (let i = 0; i < 10; i++) expect((await request(token, body)).status).toBe(204);
    expect((await request(token, body)).status).toBe(429);
  });

  test("scrubs URLs, email and tokens and never logs body text, and logs only an opaque song id and media type", async () => {
    const token = addPerson("client-error-scrub");
    let line = "";
    console.error = (...args: unknown[]) => { line += args.join(" "); };
    const body = JSON.stringify({ kind: "player", name: "MediaError", message: "failed https://home.invalid/a?key=private alice@example.com", stack: "Error: private lyric words\n at https://home.invalid/?token=abc", route: "/music/private-song?name=Secret", song_id: "private-song-id", media_type: "audio/mp4", build: "build-123" });
    expect((await request(token, body)).status).toBe(204);
    expect(line).toContain("[URL]");
    expect(line).toContain("[email]");
    expect(line).not.toContain("alice@example.com");
    expect(line).not.toContain("private lyric words");
    // An opaque song id (letters, digits, dash, underscore) is kept so a crash names the song; the id is not a title or any words (rule 6a).
    expect(line).toContain('"song_id":"private-song-id"');
    expect(line).not.toContain("Secret");
    expect(line).not.toContain("token=abc");
  });
});
