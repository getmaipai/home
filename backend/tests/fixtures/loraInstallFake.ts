import { __setVideosFetchForTests } from "@/lib/videos/stack";
import type { FakeVideoStack } from "../videoFixture";

export interface FakeLoraInstall {
  all: Array<Record<string, unknown>>;
  bodies: Array<Record<string, unknown>>;
  state: "running" | "done" | "failed";
  reason: string | null;
  classification: "all-ages" | "adult-only";
  refuse: { status: number; code: string; error: string; existing_id?: string } | null;
}

const sha = (char: string) => char.repeat(64);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Adds a fake Stack LoRA install route and the real wrapped `/stack/v1/jobs/{id}` reply. */
export function installFakeLoraJobs(fake: FakeVideoStack, endpoint: "/stack/v1/video/loras/install" | "/stack/v1/image/loras/install"): FakeLoraInstall {
  const state: FakeLoraInstall = { all: [], bodies: [], state: "running", reason: null, classification: "adult-only", refuse: null };
  const inner = fake.handler;
  const handler = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (init?.method === "POST" && url.pathname === endpoint) {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      state.bodies.push(body); state.all.push(body);
      if (state.refuse) return json({ error: state.refuse.error, code: state.refuse.code, ...(state.refuse.existing_id ? { existing_id: state.refuse.existing_id } : {}) }, state.refuse.status);
      return json({ job: `job-install-${state.all.length}` }, 202);
    }
    const match = /^\/stack\/v1\/jobs\/job-install-(\d+)$/.exec(url.pathname);
    if (match) {
      const body = state.all[Number(match[1]) - 1]!;
      const lora = { id: `lora-${sha("e").slice(0, 16)}`, name: String(body.name), sha256: sha("e"), bytes: 412 * 1024 * 1024, base_model: String(body.base_model), licence: "x", source_url: typeof body.source_url === "string" ? body.source_url : null, classification: state.classification, strength_default: 1, trigger_words: [], added_at: "2026-11-02T00:00:00Z" };
      if (state.state === "done") {
        fake.loras = [lora];
        return json({ job: { id: `job-install-${match[1]}`, state: "done", percent: 100, completedBytes: 1, totalBytes: 1, status: "Done", reason: null, result: { lora } } });
      }
      if (state.state === "failed") return json({ job: { id: `job-install-${match[1]}`, state: "failed", percent: 40, status: "failed", reason: state.reason, result: { code: "hash_mismatch" } } });
      return json({ job: { id: `job-install-${match[1]}`, state: "running", percent: 40, completedBytes: 40, totalBytes: 100, status: "Downloading a style", reason: null, result: null } });
    }
    return inner(input, init);
  }) as typeof fetch;
  __setVideosFetchForTests(handler);
  return state;
}
