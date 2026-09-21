import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createStackClient, type StackClient } from "@/lib/stack/client";
import { StackError } from "@/lib/stack/errors";

const ENGINE = "local b10797";
const MODEL = "qwen3-8b-instruct-q4_k_m.gguf";
const REVISION = "b10797";

const IDENTITY_HEADERS: Record<string, string> = {
  "x-maipai-engine": ENGINE,
  "x-maipai-model": MODEL,
  "x-maipai-revision": REVISION,
};

const IDENTITY = { host: "local", build: "b10797", model: MODEL, healthy: null } as const;

const ROUTES: Array<[string, string, (body: unknown, form: FormData | null) => { status: number; body: unknown; headers?: Record<string, string> }]> = [
  ["/healthz", "GET", () => ({ status: 200, body: { ok: true, version: "0.1.0", uptimeSeconds: 42 } })],
  [
    "/v1/chat/completions",
    "POST",
    (body) => {
      const b = body as Record<string, unknown>;
      if (b.slow) return { status: 200, body: "slow" };
      if (b.stream) return { status: 200, body: "stream", headers: IDENTITY_HEADERS };
      if (b.fail === "400") return { status: 400, body: { error: "the model field must be a role id or an installed model id", roles: ["chat", "embed"] } };
      if (b.fail === "409") return { status: 409, body: { error: "model is unverified", model: "qwen3-8b", reason: "unverified", missing: ["checksum"] } };
      if (b.fail === "503") return { status: 503, body: { error: "the engine is offline", role: "chat", state: "offline", offline_reason: "the engine process is not running" } };
      if (b.fail === "504") return { status: 504, body: { error: "the engine took too long", role: "chat" } };
      return { status: 200, body: { id: "chatcmpl-1", object: "chat.completion", choices: [{ message: { role: "assistant", content: "hello" } }] }, headers: IDENTITY_HEADERS };
    },
  ],
  ["/v1/embeddings", "POST", () => ({ status: 200, body: { object: "list", data: [{ embedding: [0.1, 0.2] }] }, headers: IDENTITY_HEADERS })],
  ["/v1/audio/transcriptions", "POST", () => ({ status: 200, body: { text: "transcribed words" }, headers: IDENTITY_HEADERS })],
  ["/v1/audio/speech", "POST", () => ({ status: 200, body: "wav", headers: { "content-type": "audio/wav", ...IDENTITY_HEADERS } })],
  [
    "/v1/images/generations",
    "POST",
    (body) => {
      const b = body as Record<string, unknown>;
      if (b.stream) return { status: 200, body: { created: 1, job: "job-image-1", data: [{ b64_json: "aGVsbG8=" }] }, headers: IDENTITY_HEADERS };
      return { status: 202, body: { created: 1, job: "job-image-1", data: [] }, headers: IDENTITY_HEADERS };
    },
  ],
  ["/stack/v1/jobs/job-image-1", "GET", () => ({ status: 200, body: { job: jobBody("job-image-1", "done") } })],
  ["/stack/v1/jobs/job-image-1", "DELETE", () => ({ status: 200, body: { job: jobBody("job-image-1", "cancelled") } })],
  ["/stack/v1/jobs/missing", "GET", () => ({ status: 404, body: { error: "no such job" } })],
  [
    "/stack/v1/roles",
    "GET",
    () => ({
      status: 200,
      body: {
        roles: [
          {
            id: "chat",
            label: "Chat",
            wire: "chat",
            residency: "resident",
            endpoints: ["/v1/chat/completions"],
            quality: ["fast", "everyday", "best"],
            sharesModelWith: null,
            state: { state: "ready", since: "2026-09-20T00:00:00Z" },
            reason: null,
            model: { id: "qwen3-8b", sizeBytes: 1, measuredFootprintBytes: 2, measuredContextLength: 3, estimated: true },
            check: { state: "passed", at: "2026-09-20T00:00:00Z", reason: null, stale: false },
          },
        ],
      },
    }),
  ],
  [
    "/stack/v1/engines",
    "GET",
    () => ({
      status: 200,
      body: {
        engines: [
          {
            id: "llama",
            name: "llama.cpp",
            label: "llama.cpp",
            platform: "macos",
            arch: "arm64",
            verified: true,
            installed: true,
            matchesThisMachine: true,
            running: "b10797",
            currentTag: "b10797",
            newestTag: "b10797",
            current: true,
            notCurrent: false,
            needsRestart: false,
            state: "current",
            stateReason: null,
            directory: "/models",
            roleState: "ready",
            roleReason: null,
          },
        ],
      },
    }),
  ],
  [
    "/stack/v1/engines/llama/install",
    "POST",
    () => ({ status: 202, body: { job: "job-engine-1", engine: "llama", staged: true } }),
  ],
  ["/stack/v1/engines/llama/start", "POST", () => ({ status: 200, body: { ok: true, reason: "started" } })],
  ["/stack/v1/models", "GET", () => ({ status: 200, body: { models: [{ id: "qwen3-8b", roles: ["chat"], state: "installed", runtimeState: "ready", pinned: true, sizeBytes: 1 }] } })],
  ["/stack/v1/models/qwen3-8b/actions", "POST", () => ({ status: 200, body: { modelId: "qwen3-8b", ok: true, reason: "unpinned" } })],
  [
    "/stack/v1/health",
    "GET",
    () => ({
      status: 200,
      body: {
        health: [
          {
            code: "engine.crashed.chat",
            severity: "critical",
            title: "The chat engine crashed",
            text: "The chat engine process stopped.",
            since: "2026-09-20T00:00:00Z",
            cause: "the process exited",
            fix: { label: "Restart the chat engine", action: "restart_engine" },
          },
        ],
      },
    }),
  ],
  ["/stack/v1/health/engine.crashed.chat/fix", "POST", () => ({ status: 200, body: { ok: true, result: "restarted" } })],
  [
    "/stack/v1/settings",
    "GET",
    () => ({
      status: 200,
      body: {
        sections: [{ id: "stack", label: "Stack" }],
        settings: [
          {
            key: "stack.jobs.max",
            scope: "device",
            selector: "number",
            range: { min: 1, max: 4 },
            default: 1,
            label: "Max jobs",
            level: "basic",
            lives_in: "stack",
            honoured_by: ["home"],
            needs_restart: false,
            in_effect: 1,
            pending: null,
          },
        ],
      },
    }),
  ],
  [
    "/stack/v1/settings/apply",
    "POST",
    () => ({
      status: 200,
      body: {
        sections: [{ id: "stack", label: "Stack" }],
        settings: [
          {
            key: "stack.jobs.max",
            scope: "device",
            selector: "number",
            range: { min: 1, max: 4 },
            default: 1,
            label: "Max jobs",
            level: "basic",
            lives_in: "stack",
            honoured_by: ["home"],
            needs_restart: false,
            in_effect: 2,
            pending: null,
          },
        ],
      },
    }),
  ],
  [
    "/stack/v1/hardware/budget",
    "GET",
    () => ({
      status: 200,
      body: {
        totalMemoryBytes: 16_000_000_000,
        capBytes: 12_000_000_000,
        freeMemoryBytes: 4_000_000_000,
        availablePercent: 25,
        pressure: "normal",
        memoryReadingDegraded: false,
        loaded: [
          {
            id: "qwen3-8b",
            kind: "resident",
            peakBytes: 5_000_000_000,
            measured: true,
            lastUsedAt: "2026-09-20T00:00:00Z",
            idleTtlSeconds: 300,
            pinned: true,
            pid: 1234,
          },
        ],
        queue: [],
      },
    }),
  ],
  [
    "/stack/v1/hardware",
    "GET",
    () => ({
      status: 200,
      body: { hardware: { platform: "macos", arch: "arm64", totalRamGb: 16, cpuCount: 8, isAppleSilicon: true, unifiedMemoryGb: 16, cudaDevices: [] } },
    }),
  ],
  ["/stack/v1/updates", "GET", () => ({ status: 200, body: { checksEnabled: true, engines: [{ name: "llama", installed: "b10797", available: "b10797", availableKnown: true, update: null }] } })],
  ["/stack/v1/updates/check", "POST", () => ({ status: 200, body: { checksEnabled: true, engines: [{ name: "llama", installed: "b10797", available: "b10800", availableKnown: true, update: "b10800" }] } })],
  ["/stack/v1/updates/engines/llama-server/apply", "POST", () => ({ status: 200, body: { applied: true, tag: "b10800", previous: "b10797" } })],
  [
    "/stack/v1/updates/engines/llama-server/rollback",
    "POST",
    (body) => {
      const b = body as { tag?: string };
      return { status: 200, body: { ok: true, tag: b.tag } };
    },
  ],
  ["/stack/v1/storage/sweep", "POST", () => ({ status: 200, body: { removed: ["sha256:aaaa"] } })],
  [
    "/stack/v1/check",
    "POST",
    () => ({
      status: 200,
      body: {
        at: "2026-09-20T00:00:00Z",
        ok: true,
        results: [{ role: "chat", ok: true, ms: 12, reason: null, loadMs: null }],
        fitTogether: { ok: true, reason: null },
        reason: null,
        generation: 1,
      },
    }),
  ],
];

let server: ReturnType<typeof Bun.serve>;
let baseUrl = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;
      const route = ROUTES.find(([p, m]) => p === path && m === method);
      if (!route) return new Response(JSON.stringify({ error: "no such route" }), { status: 404, headers: { "content-type": "application/json" } });
      const [, , handler] = route;
      let body: unknown = null;
      let form: FormData | null = null;
      if (method === "POST") {
        const ct = req.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) body = await req.json();
        else if (ct.includes("multipart/form-data")) form = (await req.formData()) as FormData;
      }
      const { status, body: out, headers = {} } = handler(body, form);
      if (out === "wav") {
        const wav = new Uint8Array([0xff, 0x16]);
        return new Response(wav, { status, headers });
      }
      if (out === "stream") {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n'));
              controller.close();
            },
          }),
          { status, headers: { "content-type": "text/event-stream", ...headers } },
        );
      }
      if (out === "slow") {
        return new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify({ id: "chatcmpl-slow", choices: [] }), { status, headers })), 5_000));
      }
      return new Response(JSON.stringify(out), { status, headers: { "content-type": "application/json", ...headers } });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop();
});

function jobBody(id: string, state: "queued" | "running" | "done" | "failed" | "cancelled"): Record<string, unknown> {
  return {
    id,
    kind: "image",
    role: "image",
    state,
    percent: state === "done" ? 100 : 0,
    completedBytes: 0,
    totalBytes: 1_000,
    status: state === "done" ? "done" : "queued",
    position: state === "queued" ? 1 : null,
    input: { prompt: "a cat" },
    result: state === "done" ? { images: [{ b64_json: "aGVsbG8=" }] } : null,
    reason: null,
    createdAt: "2026-09-20T00:00:00Z",
    updatedAt: "2026-09-20T00:00:00Z",
  };
}

async function expectStackError(fn: () => Promise<unknown>, kind: StackError["kind"], message?: string): Promise<StackError> {
  try {
    await fn();
    throw new Error("expected a StackError");
  } catch (err) {
    if (err instanceof StackError) {
      expect(err.kind).toBe(kind);
      if (message !== undefined) expect(err.message).toBe(message);
      return err;
    }
    throw err;
  }
}

describe("createStackClient", () => {
  test("refuses a non-loopback baseUrl at creation", () => {
    try {
      createStackClient({ baseUrl: "http://10.0.0.5:8770" });
      throw new Error("expected a StackError");
    } catch (err) {
      expect(err).toBeInstanceOf(StackError);
      expect((err as StackError).kind).toBe("unexpected");
    }
  });

  test("healthz returns the Stack's version", async () => {
    const client = createStackClient({ baseUrl });
    const res = await client.healthz();
    expect(res.ok).toBe(true);
    expect(res.version).toBe("0.1.0");
    expect(res.uptimeSeconds).toBe(42);
  });

  test("a chat reply yields data plus the identity from headers", async () => {
    const client = createStackClient({ baseUrl });
    const res = await client.chat({ model: "chat", messages: [{ role: "user", content: "hi" }] });
    if ("stream" in res) throw new Error("expected a non-stream chat reply");
    expect(res.data.choices).toEqual([{ message: { role: "assistant", content: "hello" } }]);
    expect(res.identity).toEqual(IDENTITY);
  });

  test("a streamed chat reply returns the body reader and headers", async () => {
    const client = createStackClient({ baseUrl });
    const res = await client.chat({ model: "chat", stream: true });
    if (!("stream" in res)) throw new Error("expected a stream chat reply");
    expect(res.headers.get("x-maipai-engine")).toBe(ENGINE);
    expect(res.headers.get("x-maipai-model")).toBe(MODEL);
    expect(res.headers.get("x-maipai-revision")).toBe(REVISION);
    const text = await new Response(res.stream).text();
    expect(text).toContain('"content":"hi"');
  });

  test("embeddings returns data plus identity", async () => {
    const client = createStackClient({ baseUrl });
    const res = await client.embeddings({ model: "embed", input: "hello" });
    expect(res.data.data).toEqual([{ embedding: [0.1, 0.2] }]);
    expect(res.identity).toEqual(IDENTITY);
  });

  test("transcribe returns the text plus identity", async () => {
    const client = createStackClient({ baseUrl });
    const form = new FormData();
    form.append("model", "stt");
    const res = await client.transcribe(form);
    expect(res.data.text).toBe("transcribed words");
    expect(res.identity).toEqual(IDENTITY);
  });

  test("speak returns the streamed WAV Response", async () => {
    const client = createStackClient({ baseUrl });
    const form = new FormData();
    form.append("model", "tts");
    const res = await client.speak(form);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0xff);
  });

  test("a 400 maps to unknown with the Stack's own message", async () => {
    const client = createStackClient({ baseUrl });
    await expectStackError(
      () => client.chat({ model: "bogus", messages: [], fail: "400" }),
      "unknown",
      "the model field must be a role id or an installed model id",
    );
  });

  test("a 409 maps to unverified", async () => {
    const client = createStackClient({ baseUrl });
    await expectStackError(
      () => client.chat({ model: "bogus", messages: [], fail: "409" }),
      "unverified",
      "model is unverified",
    );
  });

  test("a 503 maps to offline with the Stack's own reason", async () => {
    const client = createStackClient({ baseUrl });
    const err = await expectStackError(
      () => client.chat({ model: "bogus", messages: [], fail: "503" }),
      "offline",
      "the engine is offline",
    );
    expect((err as StackError).offline_reason).toBe("the engine process is not running");
  });

  test("a 504 maps to timeout", async () => {
    const client = createStackClient({ baseUrl });
    await expectStackError(
      () => client.chat({ model: "bogus", messages: [], fail: "504" }),
      "timeout",
      "the engine took too long",
    );
  });

  test("a refused connection maps to unreachable", async () => {
    const client = createStackClient({ baseUrl: "http://127.0.0.1:1", timeoutMs: 2_000 });
    await expectStackError(() => client.healthz(), "unreachable");
  });

  test("a slow reply maps to timeout", async () => {
    const client = createStackClient({ baseUrl, timeoutMs: 200 });
    await expectStackError(
      () => client.chat({ model: "chat", messages: [], slow: true }),
      "timeout",
    );
  });

  test("an image job round-trips submit, poll, cancel", async () => {
    const client = createStackClient({ baseUrl });
    const submitted = await client.imageJob({ model: "image", stream: true });
    expect(submitted.id).toBe("job-image-1");
    expect(submitted.state).toBe("done");
    const polled = await client.job("job-image-1");
    expect(polled.id).toBe("job-image-1");
    expect(polled.state).toBe("done");
    expect(polled.result).toEqual({ images: [{ b64_json: "aGVsbG8=" }] });
    const cancelled = await client.cancelJob("job-image-1");
    expect(cancelled.id).toBe("job-image-1");
    expect(cancelled.state).toBe("cancelled");
    await expectStackError(() => client.job("missing"), "unexpected", "no such job");
  });

  test("roles, engines, models, health, settings, budget, hardware, updates all answer", async () => {
    const client = createStackClient({ baseUrl });
    expect((await client.roles()).roles[0]!.id).toBe("chat");
    expect((await client.engines()).engines[0]!.name).toBe("llama.cpp");
    expect(((await client.engineAction("llama", "start")) as { ok: boolean }).ok).toBe(true);
    expect(((await client.engineAction("llama", "install")) as { job: string }).job).toBe("job-engine-1");
    expect(((await client.models()) as { models: unknown }).models).toBeDefined();
    expect(((await client.modelAction("qwen3-8b", "unpin")) as { ok: boolean }).ok).toBe(true);
    expect((await client.health()).health[0]!.code).toBe("engine.crashed.chat");
    expect(((await client.healthFix("engine.crashed.chat")) as { ok: boolean }).ok).toBe(true);
    expect((await client.settings()).settings[0]!.key).toBe("stack.jobs.max");
    expect(((await client.applySettings({ "stack.jobs.max": 2 })) as { settings: Array<{ in_effect: unknown }> }).settings[0]!.in_effect).toBe(2);
    expect((await client.budget()).pressure).toBe("normal");
    expect(((await client.hardware()) as { hardware: { isAppleSilicon: boolean } }).hardware.isAppleSilicon).toBe(true);
    expect(((await client.updates()) as { checksEnabled: boolean }).checksEnabled).toBe(true);
    expect(((await client.checkUpdates()) as { engines: Array<{ available: string }> }).engines[0]!.available).toBe("b10800");
  });

  test("applyEngineUpdate, rollbackEngine, sweepStorage and runCheck all answer", async () => {
    const client = createStackClient({ baseUrl });
    const applied = await client.applyEngineUpdate("llama-server");
    expect(applied).toEqual({ applied: true, tag: "b10800", previous: "b10797" });
    const rolledBack = await client.rollbackEngine("llama-server", "b10797");
    expect(rolledBack).toEqual({ ok: true, tag: "b10797" });
    expect((await client.sweepStorage()).removed).toEqual(["sha256:aaaa"]);
    const run = await client.runCheck();
    expect(run.ok).toBe(true);
    expect(run.results[0]!.role).toBe("chat");
  });
});
