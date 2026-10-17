// The independent safety review of the teen and child lanes (2026-10-17). Each describe block is one finding.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people as peopleTable, videoJobs } from "@/db/schema";
import { saveJob } from "@/lib/pictures/jobStore";
import { updateLive } from "@/lib/genLive";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { TestClient } from "./client";
import { testJpeg } from "./videoFixture";

const NOW = () => new Date().toISOString();
let client: TestClient;
let ownerId: string;
let seq = 0;
let picId = "";
let vidId = "";

async function signIn(): Promise<void> {
  resetDb();
  client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  ownerId = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()!.id;
}
function become(role: string): void {
  db.update(peopleTable).set({ role }).where(eq(peopleTable.id, ownerId)).run();
  invalidateSessionCacheForPerson(ownerId);
}
const status = { stage_label: "Drawing", eta_seconds: 5, step: 2, steps: 4, preview_url: "/preview?v=1", preview_step: 2 };

describe("a half-drawn frame is never served to a teen or a child", () => {
  beforeEach(signIn);
  afterEach(() => { become("owner"); });

  async function runningPicture() {
    const now = NOW();
    picId = `pj-live-${++seq}`;
    saveJob({ id: picId, personId: ownerId, conversationId: null, turnId: null, kind: "generate", state: "running", stackJob: null, percent: 40, phase: "drawing", position: null, prompt: "a friendly dragon", error: null,
      request: { size: "1024x1024", n: 1, seed: null, loras: [], source_file_id: null, audience: "all-ages" }, files: [], temporary: false, createdAt: now, updatedAt: now } as never);
    await updateLive(picId, status, async () => testJpeg());
  }
  async function runningVideo() {
    const now = NOW();
    vidId = `vj-live-${seq}`;
    db.insert(videoJobs).values({ id: vidId, personId: ownerId, conversationId: null, turnId: null, kind: "generate", state: "running", stackJob: null, percent: 60, phase: "making", position: null, prompt: "a friendly dragon",
      request: JSON.stringify({ size: "704x480", seconds: 5, seed: null, loras: [], source_file_id: null, audience: "all-ages" }), error: null, files: "[]", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
    await updateLive(vidId, status, async () => testJpeg());
  }

  test("an adult sees the preview in the card and can fetch it (the control)", async () => {
    await runningPicture(); await runningVideo();
    expect(((await (await client.get(`/api/pictures/jobs/${picId}`)).json()) as { preview_url: string | null }).preview_url).toContain("/preview?v=1");
    expect((await client.get(`/api/pictures/jobs/${picId}/preview`)).status).toBe(200);
    expect((await client.get(`/api/videos/jobs/${vidId}/preview`)).status).toBe(200);
  });

  for (const role of ["teen", "child"]) {
    test(`a ${role} gets no preview url and a 404 from the preview routes, for pictures and videos`, async () => {
      await runningPicture(); await runningVideo();
      become(role);
      const cardRes = await client.get(`/api/pictures/jobs/${picId}`);
      expect(cardRes.status).toBe(200);
      const card = await cardRes.json() as { preview_url: string | null; preview_step: number | null };
      expect(card.preview_url).toBeNull();
      expect(card.preview_step).toBeNull();
      expect((await client.get(`/api/pictures/jobs/${picId}/preview`)).status).toBe(404);
      const clip = await (await client.get(`/api/videos/jobs/${vidId}`)).json() as { items: Array<{ preview_url: string | null }> };
      expect(clip.items.map((i) => i.preview_url)).toEqual([null]);
      expect((await client.get(`/api/videos/jobs/${vidId}/preview`)).status).toBe(404);
    });
  }
});
