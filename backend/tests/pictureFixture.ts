// IMGGEN-HOME-01: a fake Stack picture engine for tests. It answers the routes lib/pictures/stack.ts calls
// (generation submit, job status with rising progress, the PNG files, cancel, engine status, the style library)
// and records every request body so a test can assert what Home sent, and that a refused request sent nothing.
import sharp from "sharp";
import { __setPicturesFetchForTests, type StackLora } from "@/lib/pictures/stack";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __resetAdapterCacheForTests } from "@/lib/pictures/adapters";
import { __resetPictureJobsForTests, __setPicturePollMsForTests } from "@/lib/pictures/jobs";

export interface FakeJob { id: string; body: Record<string, unknown>; polls: number; state: "queued" | "running" | "done" | "failed" | "cancelled"; deleted: boolean }
export interface FakeImageStack {
  jobs: FakeJob[];
  submitted: Array<Record<string, unknown>>;
  /** Polls before a job is done. */
  pollsToFinish: number;
  /** When set, a job fails with this code and sentence instead of finishing. */
  failWith: { code: string; error: string } | null;
  /** When set, the submit itself is refused with this status, code and sentence. */
  refuseSubmit: { status: number; code: string; error: string } | null;
  loras: StackLora[];
  restore(): void;
}

export const TEST_LORAS: StackLora[] = [
  { id: "lora-aaaaaaaaaaaaaaaa", name: "Pixel Art", sha256: "a".repeat(64), bytes: 100, base_model: "flux2-klein-4b", licence: "Apache-2.0", source_url: null, classification: "all-ages", trigger_words: ["pixelart"], strength_default: 0.8, added_at: "2026-10-17T00:00:00Z" },
  { id: "lora-bbbbbbbbbbbbbbbb", name: "Boudoir Film", sha256: "b".repeat(64), bytes: 100, base_model: "flux2-klein-4b", licence: null, source_url: null, classification: "adult-only", trigger_words: ["boudoirfilm"], strength_default: 0.9, added_at: "2026-10-17T00:00:00Z" },
];

let pngCache: Uint8Array | null = null;
export async function testPng(): Promise<Uint8Array> {
  pngCache ??= new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 90, b: 30 } } }).png().toBuffer());
  return pngCache;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function installFakeImageStack(options: { pollsToFinish?: number } = {}): FakeImageStack {
  const fake: FakeImageStack = {
    jobs: [], submitted: [], pollsToFinish: options.pollsToFinish ?? 2, failWith: null, refuseSubmit: null, loras: [...TEST_LORAS],
    restore() { __setPicturePollMsForTests(null); __setPicturesFetchForTests(null); __setPictureStatusForTests(undefined); __resetAdapterCacheForTests(); __resetPictureJobsForTests(); },
  };
  __setPictureStatusForTests(readyStatusForTests());
  __resetAdapterCacheForTests();
  __setPicturePollMsForTests(20);
  __setPicturesFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname;
    if (method === "POST" && path === "/v1/images/generations") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      fake.submitted.push(body);
      if (fake.refuseSubmit) return json({ error: fake.refuseSubmit.error, code: fake.refuseSubmit.code }, fake.refuseSubmit.status);
      const job: FakeJob = { id: `job-${fake.jobs.length + 1}`, body, polls: 0, state: "queued", deleted: false };
      fake.jobs.push(job);
      return json({ created: 1, job: job.id, data: [] }, 202);
    }
    const jobMatch = path.match(/^\/v1\/images\/generations\/([^/]+)(?:\/(\d+)\.png)?$/);
    if (jobMatch) {
      const job = fake.jobs.find((j) => j.id === jobMatch[1]);
      if (!job) return json({ error: "No such job.", code: "not_found" }, 404);
      if (method === "DELETE") { if (job.state === "queued" || job.state === "running") job.state = "cancelled"; job.deleted = true; return json({ ok: true }); }
      if (jobMatch[2] !== undefined) return new Response(await testPng(), { status: 200, headers: { "content-type": "image/png" } });
      job.polls += 1;
      if (job.state === "cancelled") return json({ job: job.id, state: "cancelled", phase: null, progress: 0, phase_progress: null, position: null, error: null, code: null, data: [] });
      if (fake.failWith) { job.state = "failed"; return json({ job: job.id, state: "failed", phase: null, progress: 0, phase_progress: null, position: null, error: fake.failWith.error, code: fake.failWith.code, data: [] }); }
      if (job.polls >= fake.pollsToFinish) {
        job.state = "done";
        const n = typeof job.body.n === "number" ? job.body.n : 1;
        const data = Array.from({ length: n }, (_, i) => ({ url: `/v1/images/generations/${job.id}/${i}.png`, content_type: "image/png", seed: 1234 + i, width: 64, height: 64, model: "flux2-klein-4b", steps: 4, ms: 3900, lora_ids: [] }));
        return json({ job: job.id, state: "done", phase: "ready", progress: 100, phase_progress: null, position: null, error: null, code: null, data });
      }
      job.state = job.polls === 1 ? "queued" : "running";
      return json({ job: job.id, state: job.state, phase: job.state === "queued" ? "queued" : "rendering", progress: job.polls * 30, phase_progress: null, position: job.state === "queued" ? 1 : null, error: null, code: null, data: [] });
    }
    if (method === "GET" && path === "/stack/v1/image") return json({ image: readyStatusForTests() });
    if (method === "GET" && path === "/stack/v1/image/loras") return json({ loras: fake.loras });
    return json({ error: `The fake picture engine has no route ${method} ${path}.`, code: "not_found" }, 404);
  }) as typeof fetch);
  return fake;
}

/** Waits until `check` is true, polling every 25 ms. */
export async function until(check: () => boolean, ms = 8_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error("timed out waiting");
}
