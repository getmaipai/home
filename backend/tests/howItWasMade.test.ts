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
  // VF-UI-04 and VF-EDIT-04: what a person sees is the words, the length and the shape; no engine, model, pixel size or seed.
  const shown = creationDetailsFor(maker, clip.fileId);
  expect(shown).toEqual(expect.arrayContaining([{ label: "Prompt", value: "A red kite crossing a quiet sky" }, { label: "Length", value: "6 seconds" }, { label: "Shape", value: "wide" }]));
  expect(shown.map((row) => row.label)).not.toEqual(expect.arrayContaining(["Engine and model"]));
  for (const label of ["Engine and model", "Size", "Seed"]) expect(shown.map((row) => row.label)).not.toContain(label);
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

test("the watch page item carries the shot notes for the maker only", async () => {
  const { mediaAppDataRaw } = await import("@/lib/media/appHost");
  const h = await household();
  const maker = h.row("Marlow");
  const clip = await clipFixture(maker);
  recordCreation(maker, {
    kind: "video", fileIds: [clip.fileId], recipe: { tool: "video", route: "text" }, words: { written: "A red kite" },
    generation: { kind: "video", job_id: "vjob-notes", task: "generate", model: { id: "ltx25-q8", revision: "unknown", licence: "unknown" }, engine: { id: "unknown", version: "unknown" }, seed: 71, duration_s: 6, bpm: null, key: null, parent_file_id: null, source_kind: "none", commercial_use: "unknown", commercial_basis: "unknown", made_at: new Date().toISOString(), tier: "standard" },
    settings: { width: 768, height: 448, seconds: 6, styles: [] },
  });
  const mine = mediaAppDataRaw(maker, "video", "item", { id: clip.fileId }) as { facts?: string } | null;
  expect(mine?.facts).toContain("Length: 6 seconds");
  expect(mine?.facts).toContain("Shape: wide");
  expect(mine?.facts).not.toContain("Seed");
  expect(mine?.facts).not.toContain("\n");
  const other = mediaAppDataRaw(h.row("Quill"), "video", "item", { id: clip.fileId }) as { facts?: string } | [] | null;
  expect((Array.isArray(other) ? "" : other?.facts) ?? "").not.toContain("Seed");
});
