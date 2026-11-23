// COVER-BACKFILL-01: a backfill cover is queued below every request a person makes themselves.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeImageStack } from "./pictureFixture";
import { startPictureJob, getPictureJob } from "@/lib/pictures/jobs";
import type { PersonRow } from "@/types";

let pictures: ReturnType<typeof installFakeImageStack>;
beforeEach(() => { resetDb(); pictures = installFakeImageStack(); pictures.pollsToFinish = 1000; });
afterEach(() => pictures.restore());

test("a low priority picture job is stored flagged", async () => {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  const low = await startPictureJob({ actor, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: "a cover", body: { prompt: "a cover", size: "1024x1024", n: 1, audience: "all-ages" }, lowPriority: true } as never);
  const normal = await startPictureJob({ actor, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: "a picture", body: { prompt: "a picture", size: "1024x1024", n: 1, audience: "all-ages" } });
  expect((getPictureJob(actor, low.id)!.request as { lowPriority?: boolean }).lowPriority).toBe(true);
  expect((getPictureJob(actor, normal.id)!.request as { lowPriority?: boolean }).lowPriority).toBeUndefined();
});
