// MEDIA-DETAIL-03: the lyrics lookup action route (POST /api/plugins/music/actions/lyrics in routes/mediaApps.ts).
// The lookup logic itself is tested in lib/media/lyricsAction's own tests; this covers the wire.
import { beforeEach, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => { resetDb(); });

async function signedInOwner(): Promise<TestClient> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}

test("an unknown song id answers 404 with the plain error, by id or media_id", async () => {
  const owner = await signedInOwner();
  const response = await owner.post("/api/plugins/music/actions/lyrics", { id: "media-nothing0001" });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "That song is not in the library." });
  const byMediaId = await owner.post("/api/plugins/music/actions/lyrics", { media_id: "media-nothing0001" });
  expect(byMediaId.status).toBe(404);
  expect(await byMediaId.json()).toEqual({ error: "That song is not in the library." });
});

test("an unauthenticated call is refused", async () => {
  await signedInOwner();
  expect((await new TestClient().post("/api/plugins/music/actions/lyrics", { id: "media-nothing0001" })).status).toBe(401);
});
