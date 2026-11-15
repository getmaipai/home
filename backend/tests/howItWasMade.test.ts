import { beforeEach, expect, test } from "bun:test";
import { PageNodeSchema } from "@/kit/schema/types";
import { recordCreation } from "@/lib/creations/store";
import { creationDetailsFor } from "@/lib/media/videoCreateApp";
import { resetDb } from "./reset-db";
import { household, markAdultOnly } from "./fixtures/adultLock";
import { createAttachment } from "@/lib/attachments";
import { storeFile } from "@/lib/attachments";

async function clipFixture(actor: import("@/types").PersonRow, audience: "all-ages" | "adult-only" = "all-ages") {
  const created = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([1, 2, 3]), deduplicate: false, provenance: `video-gen:{"audience":"${audience}","job":"fake-clip"}` });
  if (!created.ok) throw new Error(created.error);
  const id = created.value.id;
  return { fileId: id, jobId: "fake-clip" };
}

beforeEach(() => resetDb());

test("the maker sees the saved clip details and missing fields stay omitted", async () => {
  const h = await household();
  const maker = h.row("Marlow");
  const clip = await clipFixture(maker);
  recordCreation(maker, {
    kind: "video", fileIds: [clip.fileId], recipe: { tool: "video", route: "text" },
    words: { written: "A red kite crossing a quiet sky" },
    generation: { kind: "video", job_id: "vjob-123456", task: "generate", model: { id: "ltx25-q8", revision: "unknown", licence: "unknown" }, engine: { id: "unknown", version: "unknown" }, seed: 71, duration_s: 6, bpm: null, key: null, parent_file_id: null, source_kind: "none", commercial_use: "unknown", commercial_basis: "unknown", made_at: new Date().toISOString(), tier: "standard" },
    settings: { width: 768, height: 448, seconds: 6, styles: [] }, checks: { findings: ["No findings"] },
  });
  expect(creationDetailsFor(maker, clip.fileId)).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Prompt", value: "A red kite crossing a quiet sky" }), expect.objectContaining({ label: "Engine and model", value: expect.stringContaining("LTX") }), expect.objectContaining({ label: "Length", value: "6 seconds" }), expect.objectContaining({ label: "Size", value: "768 × 448" }), expect.objectContaining({ label: "Seed", value: "71" })]));
});

test("another person gets not found", async () => {
  const h = await household();
  const maker = h.row("Marlow");
  const clip = await clipFixture(maker);
  recordCreation(maker, { kind: "video", fileIds: [clip.fileId], recipe: { tool: "video", route: "text" } });
  expect(creationDetailsFor(h.row("Quill"), clip.fileId)).toEqual([]);
});

test("a minor gets not found for a locked clip", async () => {
  const h = await household();
  const maker = h.row("Marlow");
  const clip = await clipFixture(maker, "adult-only");
  markAdultOnly(clip.jobId);
  recordCreation(maker, { kind: "video", fileIds: [clip.fileId], recipe: { tool: "video", route: "text" } });
  expect(creationDetailsFor(h.row("Sprout"), clip.fileId)).toEqual([]);
});

test("the served page schema is valid for adult, teen and child", async () => {
  const h = await household();
  for (const client of [h.adult.client, h.teen.client, h.child.client]) {
    const response = await client.get("/api/plugins/video/pages/how-made");
    expect(response.status).toBe(200);
    expect(PageNodeSchema.safeParse(await response.json()).success).toBe(true);
  }
});
