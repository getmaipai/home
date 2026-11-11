import { beforeEach, describe, expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { db } from "@/db";
import { people, sessions } from "@/db/schema";
import { speechRoutes } from "@/routes/speech";
import { resetDb } from "./reset-db";

const app = new OpenAPIHono();
app.route("/api/speech", speechRoutes);
const now = new Date().toISOString();

function signIn() {
  db.insert(people).values({ id: "sp-owner", displayName: "sp-owner", role: "owner", avatarSeed: "x", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" } as never).run();
  const token = "session-sp";
  db.insert(sessions).values({ id: "sess-sp", personId: "sp-owner", tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
  return token;
}

describe("speech dictionary route", () => {
  let token = "";
  beforeEach(() => { resetDb(); token = signIn(); });

  test("needs a signed-in person", async () => {
    expect((await app.request("http://localhost/api/speech/cmu")).status).toBe(401);
  });

  test("serves the dictionary gzip with a cache header and an ETag", async () => {
    const res = await app.request("http://localhost/api/speech/cmu", { headers: { cookie: `session=${token}`, "accept-encoding": "gzip" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("cache-control")).toContain("max-age");
    const dict = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString());
    expect(dict.hello).toBe("HH AH L OW");
    expect(dict["a(2)"]).toBeUndefined();
    const again = await app.request("http://localhost/api/speech/cmu", { headers: { cookie: `session=${token}`, "if-none-match": res.headers.get("etag")! } });
    expect(again.status).toBe(304);
  });

  test("serves plain JSON when gzip is not accepted", async () => {
    const res = await app.request("http://localhost/api/speech/cmu", { headers: { cookie: `session=${token}` } });
    expect(res.headers.get("content-encoding")).toBeNull();
    expect((await res.json() as Record<string, string>).world).toBe("W ER L D");
  });
});
