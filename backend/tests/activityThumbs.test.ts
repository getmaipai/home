// ACTIVITY-MERGE-01: a finished picture or clip in the Activity list carries a thumbnail URL; running rows and songs do not.
import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { attachments, people, pictureJobs, videoJobs } from "@/db/schema";
import { activityForViewer } from "@/lib/activity";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

const now = () => new Date().toISOString();

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correct horse battery staple" });
  return db.select().from(people).all()[0]!;
}

const file = (id: string, personId: string) => db.insert(attachments).values({ id, ownerPersonId: personId, mediaType: "image/jpeg", size: 1, sha256: id, storagePath: `x/${id}`, provenance: "generated", createdAt: now(), hlc: "h" } as never).run();

describe("ACTIVITY-MERGE-01: thumbnails", () => {
  test("a done picture points at its first file's thumb, a done clip at its poster, a running picture at nothing", async () => {
    const sage = await owner();
    file("pf1", sage.id);
    file("vp1", sage.id);
    file("vf1", sage.id);
    db.insert(pictureJobs).values({ id: "p1", personId: sage.id, kind: "generate", state: "done", percent: 100, phase: null, prompt: "A fox", request: JSON.stringify({ size: "1024x1024", n: 1, seed: null, loras: [], source_file_id: null, audience: "all-ages" }), files: JSON.stringify([{ id: "pf1", width: 1, height: 1, seed: null, model: null, steps: null, ms: null }]), createdAt: now(), updatedAt: now(), hlc: "h" }).run();
    db.insert(pictureJobs).values({ id: "p2", personId: sage.id, kind: "generate", state: "running", percent: 40, phase: "x", prompt: "A cat", request: JSON.stringify({ size: "1024x1024", n: 1, seed: null, loras: [], source_file_id: null, audience: "all-ages" }), files: "[]", createdAt: now(), updatedAt: now(), hlc: "h" }).run();
    db.insert(videoJobs).values({ id: "v1", personId: sage.id, kind: "generate", state: "done", percent: 100, phase: null, prompt: "A lantern", request: JSON.stringify({ size: "832x480", seconds: 5, audience: "all-ages" }), files: JSON.stringify([{ id: "vf1", poster_id: "vp1", seconds: 5, width: 832, height: 480, audio: false }]), createdAt: now(), updatedAt: now(), hlc: "h" }).run();
    const byId = new Map(activityForViewer(sage).items.map((item) => [item.id, item]));
    expect(byId.get("picture:p1")?.thumbnailUrl).toBe("/api/files/pf1/thumb?w=320");
    expect(byId.get("video:v1")?.thumbnailUrl).toBe("/api/files/vp1/thumb?w=320");
    expect(byId.get("picture:p2")?.thumbnailUrl ?? null).toBeNull();
  });
});
