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
  /** The fields of each POST /v1/images/edits (files as "file:<bytes>"). */
  edits: Array<Record<string, unknown>>;
  /** Polls before a job is done. */
  pollsToFinish: number;
  /** When set, a job fails with this code and sentence instead of finishing. */
  failWith: { code: string; error: string } | null;
  /** When set, the submit itself is refused with this status, code and sentence. */
  refuseSubmit: { status: number; code: string; error: string } | null;
  /** GENPREVIEW-01: when set, running polls carry the step, stage and ETA, and a preview from the third poll. */
  live: { stage_label: string; eta_seconds: number } | null;
  previewFetches: number;
  loras: StackLora[];
  /** The fields of each LoRA add (files as "file:<bytes>"). */
  loraAdds: Array<Record<string, unknown>>;
  /** When set, a LoRA file add is refused with this code and sentence. */
  loraRefusal: { code: string; error: string } | null;
  restore(): void;
}

// Frozen on purpose: the fake stack PATCHes its own copies (below), never these. A shallow copy once let picturesAdmin turn
// "Boudoir Film" all-ages for every later file in the same process, which failed teenLane only in the gate's shard order.
const TEST_LORA_SOURCE: StackLora[] = [
  { id: "lora-aaaaaaaaaaaaaaaa", name: "Pixel Art", sha256: "a".repeat(64), bytes: 100, base_model: "flux2-klein-4b", licence: "Apache-2.0", source_url: null, classification: "all-ages", trigger_words: ["pixelart"], strength_default: 0.8, added_at: "2026-10-17T00:00:00Z" },
  { id: "lora-bbbbbbbbbbbbbbbb", name: "Boudoir Film", sha256: "b".repeat(64), bytes: 100, base_model: "flux2-klein-4b", licence: null, source_url: null, classification: "adult-only", trigger_words: ["boudoirfilm"], strength_default: 0.9, added_at: "2026-10-17T00:00:00Z" },
];
export const TEST_LORAS: readonly StackLora[] = TEST_LORA_SOURCE.map((l) => Object.freeze({ ...l, trigger_words: Object.freeze([...l.trigger_words]) as unknown as string[] }));

let pngCache: Uint8Array | null = null;
export async function testPng(): Promise<Uint8Array> {
  pngCache ??= new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 90, b: 30 } } }).png().toBuffer());
  return pngCache;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function installFakeImageStack(options: { pollsToFinish?: number } = {}): FakeImageStack {
  const fake: FakeImageStack = {
    jobs: [], submitted: [], edits: [], pollsToFinish: options.pollsToFinish ?? 2, failWith: null, refuseSubmit: null, live: null, previewFetches: 0, loras: TEST_LORAS.map((l) => ({ ...l, trigger_words: [...l.trigger_words] })), loraAdds: [], loraRefusal: null,
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
    if (method === "POST" && path === "/v1/images/edits") {
      const form = init?.body as FormData;
      const body: Record<string, unknown> = { edit: true };
      for (const [key, value] of form.entries()) body[key] = typeof value === "string" ? value : `file:${(value as File).size}`;
      fake.edits.push(body);
      if (fake.refuseSubmit) return json({ error: fake.refuseSubmit.error, code: fake.refuseSubmit.code }, fake.refuseSubmit.status);
      const job: FakeJob = { id: `job-${fake.jobs.length + 1}`, body: { ...body, n: 1 }, polls: 0, state: "queued", deleted: false };
      fake.jobs.push(job);
      return json({ created: 1, job: job.id, data: [] }, 202);
    }
    const jobMatch = path.match(/^\/v1\/images\/generations\/([^/]+)(?:\/(\d+\.png|preview\.jpg))?$/);
    if (jobMatch) {
      const job = fake.jobs.find((j) => j.id === jobMatch[1]);
      if (!job) return json({ error: "No such job.", code: "not_found" }, 404);
      if (method === "DELETE") { if (job.state === "queued" || job.state === "running") job.state = "cancelled"; job.deleted = true; return json({ ok: true }); }
      if (jobMatch[2] === "preview.jpg") { fake.previewFetches += 1; return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }); }
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
      const liveFields = fake.live && job.state === "running" ? { progress_fraction: job.polls / 10, stage: "steps", stage_label: fake.live.stage_label, step: 2, steps: 4, eta_seconds: fake.live.eta_seconds, preview_url: job.polls >= 3 ? `/v1/images/generations/${job.id}/preview.jpg?v=2` : null, preview_step: job.polls >= 3 ? 2 : null } : {};
      return json({ job: job.id, state: job.state, phase: job.state === "queued" ? "queued" : "rendering", progress: job.polls * 30, phase_progress: null, position: job.state === "queued" ? 1 : null, error: null, code: null, data: [], ...liveFields });
    }
    if (method === "GET" && path === "/stack/v1/image") return json({ image: readyStatusForTests() });
    if (method === "GET" && path === "/stack/v1/image/loras") return json({ loras: fake.loras, base_models: ["flux2-klein-4b", "z-image-turbo"], max_per_picture: 3 });
    if (method === "POST" && path === "/stack/v1/image/loras") {
      const form = init?.body as FormData;
      fake.loraAdds.push(Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `file:${(v as File).size}`])));
      if (fake.loraRefusal) return json({ error: fake.loraRefusal.error, code: fake.loraRefusal.code }, 422);
      const record: StackLora = { id: "lora-dddddddddddddddd", name: String(form.get("name")), sha256: "d".repeat(64), bytes: 1234, base_model: "flux2-klein-4b", licence: String(form.get("licence")), source_url: null, classification: String(form.get("classification")) as StackLora["classification"], trigger_words: JSON.parse(String(form.get("trigger_words") ?? "[]")), strength_default: 1, added_at: "2026-10-17T00:00:00Z" };
      fake.loras.push(record);
      return json(record);
    }
    if (method === "POST" && path === "/stack/v1/image/loras/install") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      fake.loraAdds.push(body);
      return json({ job: "lora-job-1" }, 202);
    }
    if (method === "GET" && path === "/stack/v1/jobs/lora-job-1") {
      const record: StackLora = { id: "lora-eeeeeeeeeeeeeeee", name: "From Link", sha256: "e".repeat(64), bytes: 99, base_model: "z-image-turbo", licence: "unknown", source_url: "https://huggingface.co/x/y/resolve/main/a.safetensors", classification: "adult-only", trigger_words: [], strength_default: 1, added_at: "2026-10-17T00:00:00Z" };
      fake.loras.push(record);
      return json({ job: { id: "lora-job-1", state: "done", percent: 100, result: { lora: record } } });
    }
    const patchMatch = path.match(/^\/stack\/v1\/image\/loras\/([^/]+)$/);
    if (patchMatch && method === "PATCH") {
      const lora = fake.loras.find((l) => l.id === patchMatch[1]);
      if (!lora) return json({ error: "No such LoRA in the library.", code: "unknown_lora" }, 404);
      Object.assign(lora, JSON.parse(String(init?.body)));
      return json(lora);
    }
    if (patchMatch && method === "DELETE") {
      const at = fake.loras.findIndex((l) => l.id === patchMatch[1]);
      if (at < 0) return json({ error: "No such LoRA in the library.", code: "unknown_lora" }, 404);
      fake.loras.splice(at, 1);
      return json({ ok: true });
    }
    if (method === "POST" && path === "/stack/v1/image/install") return json({ job: "install-job-1", family: "flux2-klein-4b", joined: false }, 202);
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
