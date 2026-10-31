// VIDEO-GEN-05: a fake Stack video engine for tests. It answers the routes lib/videos/stack.ts calls (submit, job status
// with rising progress and phases, the mp4 and the poster, cancel, engine status, the LoRA library) and records every
// request body so a test can assert what Home sent, and that a refused request sent nothing.
import { __setVideosFetchForTests, type StackVideoLora } from "@/lib/videos/stack";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { __resetVideoJobsForTests, __setVideoPollMsForTests } from "@/lib/videos/jobs";

export interface FakeVideoJob { id: string; body: Record<string, unknown>; polls: number; state: "queued" | "running" | "done" | "failed" | "cancelled"; deleted: boolean }
export interface FakeVideoStack {
  /** Titles the Stack was asked to write into a messaging copy (the x-title header, decoded). */
  converted: string[];
  jobs: FakeVideoJob[];
  submitted: Array<Record<string, unknown>>;
  pollsToFinish: number;
  /** Polls that report the job queued ("waiting for memory"); a test that reads the queued card raises it so the job cannot pass that phase between checks. */
  queuedPolls: number;
  failWith: { code: string; error: string } | null;
  /** The Stack's memory watchdog stopped the job: cancelled, code no_memory, phase "paused: low memory". */
  pausedForMemory: boolean;
  refuseSubmit: { status: number; code: string; error: string } | null;
  /** GENPREVIEW-01: when set, running polls carry the stage, ETA and a preview (the first-frame preview shows from the second running poll). */
  live: { stage_label: string; eta_seconds: number } | null;
  previewFetches: number;
  loras: StackVideoLora[];
  /** VIDEO-LTX-01: what the Stack says about Detailed videos (undefined: an older Stack with Quick only). */
  detailed: "installed" | "missing" | undefined;
  quickMissing: boolean;
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
/** The same bytes with a sound track's handler box in them, as the Stack's messaging copy has. */
export function testMp4WithSound(): Uint8Array {
  const bytes = testMp4();
  bytes.set([0, 0, 0, 33, 0x68, 0x64, 0x6c, 0x72, 0, 0, 0, 0, 0, 0, 0, 0, 0x73, 0x6f, 0x75, 0x6e], 100);
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
    jobs: [], submitted: [], converted: [], pollsToFinish: options.pollsToFinish ?? 3, queuedPolls: 1, failWith: null, pausedForMemory: false, refuseSubmit: null, live: null, previewFetches: 0, loras: TEST_VIDEO_LORAS.map((lora) => ({ ...lora })), detailed: undefined, quickMissing: false,
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
    if (method === "POST" && path === "/v1/videos/messages") {
      fake.converted.push(decodeURIComponent(new Headers(init?.headers).get("x-title") ?? ""));
      return new Response(testMp4WithSound(), { status: 200, headers: { "content-type": "video/mp4" } });
    }
    const jobMatch = path.match(/^\/v1\/videos\/generations\/([^/]+)(?:\/(video\.mp4|poster\.jpg|preview\.jpg))?$/);
    if (jobMatch) {
      const job = fake.jobs.find((j) => j.id === jobMatch[1]);
      if (!job) return json({ error: "No such job.", code: "unknown_job" }, 404);
      if (method === "DELETE") { if (job.state === "queued" || job.state === "running") job.state = "cancelled"; job.deleted = true; return json({ ok: true }); }
      if (jobMatch[2] === "video.mp4") return new Response(testMp4(), { status: 200, headers: { "content-type": "video/mp4" } });
      if (jobMatch[2] === "preview.jpg") { fake.previewFetches += 1; return new Response(testJpeg(), { status: 200, headers: { "content-type": "image/jpeg" } }); }
      if (jobMatch[2] === "poster.jpg") return new Response(testJpeg(), { status: 200, headers: { "content-type": "image/jpeg" } });
      job.polls += 1;
      if (job.state === "cancelled") return json({ job: job.id, state: "cancelled", phase: null, progress: 0, phase_progress: null, position: null, error: null, code: null, data: [] });
      if (fake.pausedForMemory) { job.state = "cancelled"; return json({ job: job.id, state: "cancelled", phase: "paused: low memory", progress: 0, phase_progress: null, position: null, error: "Paused: this computer is low on memory.", code: "no_memory", data: [] }); }
      if (fake.failWith) { job.state = "failed"; return json({ job: job.id, state: "failed", phase: null, progress: 0, phase_progress: null, position: null, error: fake.failWith.error, code: fake.failWith.code, data: [] }); }
      if (job.polls >= fake.pollsToFinish) {
        job.state = "done";
        return json({ job: job.id, state: "done", phase: "ready", progress: 100, phase_progress: null, position: null, error: null, code: null, data: [{ url: `/v1/videos/generations/${job.id}/video.mp4`, poster_url: `/v1/videos/generations/${job.id}/poster.jpg`, content_type: "video/mp4", ...(job.body.model === "detailed" ? { width: 768, height: 448, frames: Number(job.body.seconds ?? 5) * 24 + 1, seconds: Number(job.body.seconds ?? 5), quality: "detailed", audio: true, model: "ltx-2-3-distilled-mlx" } : { width: 832, height: 480, frames: 121, seconds: 5, quality: "quick", audio: false, model: "wan2.2-ti2v-5b-fastwan-mlx" }), fps: 24, seed: 77, mode: "t2v", lora_ids: [], ms: 132000, bytes: 4096, poster_bytes: 512 }] });
      }
      job.state = job.polls <= fake.queuedPolls ? "queued" : "running";
      const liveFields = fake.live && job.state === "running" ? { progress_fraction: job.polls / 4, stage: "frames", stage_label: fake.live.stage_label, step: null, steps: null, eta_seconds: fake.live.eta_seconds, preview_url: job.polls >= 3 ? `/v1/videos/generations/${job.id}/preview.jpg?v=1` : null } : {};
      return json({ job: job.id, state: job.state, phase: job.state === "queued" ? "waiting for memory" : "rendering", progress: job.polls * 25, phase_progress: null, position: job.state === "queued" ? 2 : null, error: null, code: null, data: [], ...liveFields });
    }
    if (method === "GET" && path === "/stack/v1/video") return json({ video: readyVideoStatusForTests({ ...(fake.detailed ? { detailed: fake.detailed } : {}), ...(fake.quickMissing ? { quickMissing: true } : {}) }) });
    if (method === "GET" && path === "/stack/v1/video/loras") return json({ loras: fake.loras });
    if (method === "POST" && path === "/stack/v1/video/loras") {
      const form = init?.body as FormData;
      const added: StackVideoLora = { id: "lora-3333333333333333", name: String(form.get("name")), sha256: "3".repeat(64), bytes: 100, base_model: "wan2.2-ti2v-5b", licence: String(form.get("licence")), source_url: null, classification: form.get("classification") === "all-ages" ? "all-ages" : "adult-only", trigger_words: [], strength_default: 1, added_at: "2026-10-17T00:00:00Z" };
      fake.loras.push(added);
      return json(added);
    }
    return json({ error: `The fake video engine has no route ${method} ${path}.`, code: "not_found" }, 404);
  }) as typeof fetch);
  return fake;
}
