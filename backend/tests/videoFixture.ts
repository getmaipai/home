// VIDEO-GEN-05: a fake Stack video engine for tests. It answers the routes lib/videos/stack.ts calls (submit, job status
// with rising progress and phases, the mp4 and the poster, cancel, engine status, the LoRA library) and records every
// request body so a test can assert what Home sent, and that a refused request sent nothing.
import { __setVideosFetchForTests, type StackVideoLora } from "@/lib/videos/stack";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { __resetVideoJobsForTests, __setVideoPollMsForTests } from "@/lib/videos/jobs";

export interface FakeVideoJob { id: string; body: Record<string, unknown>; polls: number; state: "queued" | "running" | "done" | "failed" | "cancelled"; deleted: boolean }
export interface FakeVideoStack {
  jobs: FakeVideoJob[];
  submitted: Array<Record<string, unknown>>;
  pollsToFinish: number;
  failWith: { code: string; error: string } | null;
  refuseSubmit: { status: number; code: string; error: string } | null;
  loras: StackVideoLora[];
  restore(): void;
}

export const TEST_VIDEO_LORAS: StackVideoLora[] = [
  { id: "lora-1111111111111111", name: "Old Colour Film", sha256: "1".repeat(64), bytes: 100, base_model: "wan2.2-ti2v-5b", licence: "Apache-2.0", source_url: null, classification: "all-ages", trigger_words: ["HST style"], strength_default: 1, added_at: "2026-10-17T00:00:00Z" },
  { id: "lora-2222222222222222", name: "Boudoir Motion", sha256: "2".repeat(64), bytes: 100, base_model: "wan2.2-ti2v-5b", licence: "acknowledged", source_url: null, classification: "adult-only", trigger_words: ["boudoirmotion"], strength_default: 0.9, added_at: "2026-10-17T00:00:00Z" },
];

/** A byte string that passes Home's mp4 check (a box header with `ftyp`) and is big enough to look like a file. */
export function testMp4(): Uint8Array {
  const bytes = new Uint8Array(4096);
  bytes.set([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);
  for (let i = 32; i < bytes.length; i += 1) bytes[i] = i % 251;
  return bytes;
}
export function testJpeg(): Uint8Array {
  const bytes = new Uint8Array(512);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  for (let i = 4; i < bytes.length; i += 1) bytes[i] = (i * 7) % 253;
  return bytes;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function installFakeVideoStack(options: { pollsToFinish?: number } = {}): FakeVideoStack {
  const fake: FakeVideoStack = {
    jobs: [], submitted: [], pollsToFinish: options.pollsToFinish ?? 3, failWith: null, refuseSubmit: null, loras: [...TEST_VIDEO_LORAS],
    restore() { __setVideoPollMsForTests(null); __setVideosFetchForTests(null); __setVideoStatusForTests(undefined); __resetVideoAdapterCacheForTests(); __resetVideoJobsForTests(); },
  };
  __setVideoStatusForTests(readyVideoStatusForTests());
  __resetVideoAdapterCacheForTests();
  __setVideoPollMsForTests(20);
  __setVideosFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname;
    if (method === "POST" && path === "/v1/videos/generations") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      fake.submitted.push(body);
      if (fake.refuseSubmit) return json({ error: fake.refuseSubmit.error, code: fake.refuseSubmit.code }, fake.refuseSubmit.status);
      const job: FakeVideoJob = { id: `vjob-${fake.jobs.length + 1}`, body, polls: 0, state: "queued", deleted: false };
      fake.jobs.push(job);
      return json({ created: 1, job: job.id, data: [] }, 202);
    }
    const jobMatch = path.match(/^\/v1\/videos\/generations\/([^/]+)(?:\/(video\.mp4|poster\.jpg))?$/);
    if (jobMatch) {
      const job = fake.jobs.find((j) => j.id === jobMatch[1]);
      if (!job) return json({ error: "No such job.", code: "unknown_job" }, 404);
      if (method === "DELETE") { if (job.state === "queued" || job.state === "running") job.state = "cancelled"; job.deleted = true; return json({ ok: true }); }
      if (jobMatch[2] === "video.mp4") return new Response(testMp4(), { status: 200, headers: { "content-type": "video/mp4" } });
      if (jobMatch[2] === "poster.jpg") return new Response(testJpeg(), { status: 200, headers: { "content-type": "image/jpeg" } });
      job.polls += 1;
      if (job.state === "cancelled") return json({ job: job.id, state: "cancelled", phase: null, progress: 0, phase_progress: null, position: null, error: null, code: null, data: [] });
      if (fake.failWith) { job.state = "failed"; return json({ job: job.id, state: "failed", phase: null, progress: 0, phase_progress: null, position: null, error: fake.failWith.error, code: fake.failWith.code, data: [] }); }
      if (job.polls >= fake.pollsToFinish) {
        job.state = "done";
        return json({ job: job.id, state: "done", phase: "ready", progress: 100, phase_progress: null, position: null, error: null, code: null, data: [{ url: `/v1/videos/generations/${job.id}/video.mp4`, poster_url: `/v1/videos/generations/${job.id}/poster.jpg`, content_type: "video/mp4", width: 832, height: 480, frames: 121, fps: 24, seconds: 5, seed: 77, model: "wan2.2-ti2v-5b-fastwan-mlx", mode: "t2v", lora_ids: [], ms: 132000, bytes: 4096, poster_bytes: 512 }] });
      }
      job.state = job.polls === 1 ? "queued" : "running";
      return json({ job: job.id, state: job.state, phase: job.state === "queued" ? "waiting for memory" : "rendering", progress: job.polls * 25, phase_progress: null, position: job.state === "queued" ? 2 : null, error: null, code: null, data: [] });
    }
    if (method === "GET" && path === "/stack/v1/video") return json({ video: readyVideoStatusForTests() });
    if (method === "GET" && path === "/stack/v1/video/loras") return json({ loras: fake.loras });
    return json({ error: `The fake video engine has no route ${method} ${path}.`, code: "not_found" }, 404);
  }) as typeof fetch);
  return fake;
}
