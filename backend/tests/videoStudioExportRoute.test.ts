// EDIT-AUDIT-2026-11-20: the Studio's "Export for editing" button posts the plan to /api/plugins/video/actions/export-nle and gets a zip back. nleExport.test covers the
// library function; this covers the ROUTE: signed in, the plan in, a zip attachment out (EDL, FCPXML, README, the source clip), and the refusals.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { testMp4 } from "./videoFixture";
import { db } from "@/db";
import { people } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { __setVideoJobForTests } from "@/lib/videos/jobs";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { __resetStudioVoicesForTests } from "@/lib/videos/studioVoices";
import type { PersonRow } from "@/types";

beforeEach(() => { resetDb(); __resetAdultLockForTests(); __resetStudioVoicesForTests(); });

const plan = (ref: string) => ({ version: 1, film_s: 0, video: { level_db: 0, muted: false, pieces: [{ ref, in_s: 0.5, out_s: 1.5, level_db: 0, fade_in_s: 0, fade_out_s: 0 }], transitions: [] }, voice: { level_db: 0, muted: false, pieces: [] }, music: { level_db: 0, muted: false, pieces: [] } });
const entries = (zip: Uint8Array): Record<string, number> => {
  const found: Record<string, number> = {}; let offset = 0;
  while (offset + 30 < zip.length && new DataView(zip.buffer, zip.byteOffset + offset).getUint32(0, true) === 0x04034b50) {
    const view = new DataView(zip.buffer, zip.byteOffset + offset); const size = view.getUint32(18, true); const nameLength = view.getUint16(26, true); const extraLength = view.getUint16(28, true);
    found[new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLength))] = size;
    offset += 30 + nameLength + extraLength + size;
  }
  return found;
};

async function signedIn() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  const made = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: testMp4(), provenance: "video-gen:{}", retention: "kept" });
  if (!made.ok) throw new Error(made.error);
  __setVideoJobForTests({ id: "export-route-clip", personId: actor.id, conversationId: null, turnId: null, companionId: null, kind: "generate", state: "done", stackJob: null, percent: 100, phase: "ready", position: null, prompt: "Clip", request: { size: "832x480", seconds: 2, seed: null, loras: [], source_file_id: null, audience: "all-ages", stackBody: {} }, error: null, files: [{ id: made.value.id, mediaType: "video/mp4", seconds: 2, width: 832, height: 480 }], temporary: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never);
  return { client, actor, fileId: made.value.id };
}

describe("POST /api/plugins/video/actions/export-nle", () => {
  test("a signed-in person gets a zip attachment with the timeline files and the clip, marked and never cached", async () => {
    const { client, fileId } = await signedIn();
    const res = await client.post("/api/plugins/video/actions/export-nle", { clip: fileId, plan: plan(fileId) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename=".+\.zip"$/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-maipai-made-audience")).toBeTruthy();
    const files = entries(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["README.txt"]));
    expect(Object.keys(files).some((name) => name.endsWith(".edl"))).toBe(true);
    expect(Object.keys(files).some((name) => name.endsWith(".fcpxml"))).toBe(true);
    expect(Object.keys(files).some((name) => name.endsWith(".mp4") && files[name]! > 0)).toBe(true);
  });

  test("not signed in is refused, and a plan naming a clip the person does not have gets a plain refusal, not a zip", async () => {
    const { client } = await signedIn();
    const anonymous = new TestClient();
    expect((await anonymous.post("/api/plugins/video/actions/export-nle", { plan: plan("nope") })).status).toBe(401);
    const missing = await client.post("/api/plugins/video/actions/export-nle", { plan: plan("file-not-mine") });
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(missing.headers.get("content-type")).not.toBe("application/zip");
    expect(((await missing.json()) as { error: string }).error.length).toBeGreaterThan(0);
  });
});
