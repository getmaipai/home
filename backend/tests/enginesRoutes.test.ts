import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { owner, teen } from "./support/testAuth";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { startStackFixture, offlineResponse, type StackFixture } from "./stackFixture";

beforeEach(() => {
  resetDb();
});

const ROLE_FIXTURE = {
  id: "chat",
  label: "Chat",
  wire: "chat",
  residency: "resident",
  endpoints: ["/v1/chat/completions"],
  quality: ["everyday"],
  sharesModelWith: null,
  state: { state: "ready", since: "2026-09-21T00:00:00Z" },
  reason: null,
  model: { id: "qwen3-8b-instruct-q4_k_m.gguf", sizeBytes: 4_800_000_000, measuredFootprintBytes: null, measuredContextLength: null, estimated: true },
  check: { state: "passed", at: "2026-09-21T00:00:00Z", reason: null, stale: false },
};

const ENGINE_FIXTURE = {
  id: "llama-server",
  name: "llama-server",
  label: "llama.cpp server",
  platform: "darwin",
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
  directory: "/opt/maipai/stack/engines/llama-server",
  roleState: "ready",
  roleReason: null,
};

const BUDGET_FIXTURE = {
  totalMemoryBytes: 137_438_953_472,
  capBytes: 120_000_000_000,
  freeMemoryBytes: 90_000_000_000,
  availablePercent: 65.4,
  pressure: "normal",
  memoryReadingDegraded: false,
  loaded: [],
  queue: [],
};

const STACK_SETTING_FIXTURE = {
  key: "stack.updates.enabled",
  scope: "device",
  selector: "boolean",
  default: true,
  label: "Automatic maintenance",
  level: "basic",
  lives_in: "stack",
  honoured_by: ["home"],
  needs_restart: false,
  in_effect: true,
  pending: null,
};

describe("/api/engines", () => {
  let fixture: StackFixture;

  afterEach(() => {
    fixture?.stop();
    __resetStackEngineForTests();
  });

  function configure(routes: Record<string, (req: Request) => Response | Promise<Response>>): void {
    fixture = startStackFixture(routes);
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);
  }

  test("GET / merges roles, engines and the hardware budget from the client", async () => {
    configure({
      "GET /stack/v1/roles": async () => Response.json({ roles: [ROLE_FIXTURE] }),
      "GET /stack/v1/engines": async () => Response.json({ engines: [ENGINE_FIXTURE] }),
      "GET /stack/v1/hardware/budget": async () => Response.json(BUDGET_FIXTURE),
    });
    const { client } = await owner();
    const res = await client.get("/api/engines");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roles: Array<{ id: string }>; engines: Array<{ id: string }>; budget: { pressure: string } };
    expect(body.roles[0]!.id).toBe("chat");
    expect(body.engines[0]!.id).toBe("llama-server");
    expect(body.budget.pressure).toBe("normal");
  });

  test("a signed-in non-admin is refused GET /api/engines", async () => {
    configure({});
    const { client } = await owner();
    const teenClient = await teen(client);
    const res = await teenClient.get("/api/engines");
    expect(res.status).toBe(403);
  });

  test("a signed-in non-admin is refused POST /api/engines/chat/start", async () => {
    configure({ "POST /stack/v1/engines/chat/start": async () => Response.json({ ok: true }) });
    const { client } = await owner();
    const teenClient = await teen(client);
    const res = await teenClient.post("/api/engines/chat/start");
    expect(res.status).toBe(403);
  });

  test("an unsigned request is refused", async () => {
    configure({});
    const anon = new TestClient();
    const res = await anon.get("/api/engines");
    expect(res.status).toBe(401);
  });

  test("GET /hardware passes the client's data through", async () => {
    configure({ "GET /stack/v1/hardware": async () => Response.json({ cpu: "Apple M5 Max", cores: 32 }) });
    const { client } = await owner();
    const res = await client.get("/api/engines/hardware");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cpu: string };
    expect(body.cpu).toBe("Apple M5 Max");
  });

  test("POST /{name}/{action} restarts the named engine", async () => {
    configure({ "POST /stack/v1/engines/llama-server/restart": async () => Response.json({ ok: true, restarted: true }) });
    const { client } = await owner();
    const res = await client.post("/api/engines/llama-server/restart");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { restarted: boolean };
    expect(body.restarted).toBe(true);
  });

  test("GET /models passes the client's data through", async () => {
    configure({ "GET /stack/v1/models": async () => Response.json({ models: [{ id: "qwen3-8b" }] }) });
    const { client } = await owner();
    const res = await client.get("/api/engines/models");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: Array<{ id: string }> };
    expect(body.models[0]!.id).toBe("qwen3-8b");
  });

  test("POST /models/{id}/actions loads a model, action passed through to the client", async () => {
    const seen: { action?: string } = {};
    configure({
      "POST /stack/v1/models/qwen3-8b/actions": async (req) => {
        const body = (await req.json()) as { action: string };
        seen.action = body.action;
        return Response.json({ id: "job-1", state: "queued" });
      },
    });
    const { client } = await owner();
    const res = await client.post("/api/engines/models/qwen3-8b/actions", { action: "load" });
    expect(res.status).toBe(200);
    expect(seen.action).toBe("load");
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("job-1");
  });

  test("POST /models/{id}/actions with a bad action is 400 before the client is called", async () => {
    let calls = 0;
    configure({
      "POST /stack/v1/models/qwen3-8b/actions": async () => {
        calls++;
        return Response.json({ id: "job-1" });
      },
    });
    const { client } = await owner();
    const res = await client.post("/api/engines/models/qwen3-8b/actions", { action: "explode" });
    expect(res.status).toBe(400);
    expect(calls).toBe(0);
  });

  test("GET /health passes the client's data through", async () => {
    configure({
      "GET /stack/v1/health": async () =>
        Response.json({ health: [{ code: "engine.crashed.chat", severity: "critical", title: "The chat engine crashed", text: "t", since: "2026-09-21T00:00:00Z", cause: "c" }] }),
    });
    const { client } = await owner();
    const res = await client.get("/api/engines/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { health: Array<{ code: string }> };
    expect(body.health[0]!.code).toBe("engine.crashed.chat");
  });

  test("POST /health/{code}/fix runs the Stack's own fix", async () => {
    configure({ "POST /stack/v1/health/engine.crashed.chat/fix": async () => Response.json({ ok: true, result: "restarted" }) });
    const { client } = await owner();
    const res = await client.post("/api/engines/health/engine.crashed.chat/fix");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("restarted");
  });

  test("GET /settings passes the client's data through", async () => {
    configure({ "GET /stack/v1/settings": async () => Response.json({ sections: [{ id: "chat", label: "Chat" }], settings: [STACK_SETTING_FIXTURE] }) });
    const { client } = await owner();
    const res = await client.get("/api/engines/settings");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: Array<{ key: string }> };
    expect(body.settings[0]!.key).toBe("stack.updates.enabled");
  });

  test("POST /settings/apply sends the values through and returns the new state", async () => {
    let seenBody: unknown;
    configure({
      "POST /stack/v1/settings/apply": async (req) => {
        seenBody = await req.json();
        return Response.json({ sections: [{ id: "chat", label: "Chat" }], settings: [{ ...STACK_SETTING_FIXTURE, in_effect: false }] });
      },
    });
    const { client } = await owner();
    const res = await client.post("/api/engines/settings/apply", { "stack.updates.enabled": false });
    expect(res.status).toBe(200);
    expect(seenBody).toEqual({ "stack.updates.enabled": false });
    const body = (await res.json()) as { settings: Array<{ in_effect: boolean }> };
    expect(body.settings[0]!.in_effect).toBe(false);
  });

  test("GET /updates delegates to lib/stackUpdates.ts, same as routes/updates.ts", async () => {
    configure({
      "GET /stack/v1/updates": async () =>
        Response.json({ checksEnabled: true, engines: [{ name: "llama-server", installed: "b1", available: "b2", availableKnown: true, lastChecked: "2026-09-21T00:00:00Z", notes: null }], models: { lastChecked: null, entries: [] } }),
    });
    const { client } = await owner();
    const res = await client.get("/api/engines/updates");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { engines: Array<{ name: string }> };
    expect(body.engines[0]!.name).toBe("llama-server");
  });

  test("POST /updates/check delegates to lib/stackUpdates.ts", async () => {
    configure({ "POST /stack/v1/updates/check": async () => Response.json({ checksEnabled: true, engines: [], models: { lastChecked: null, entries: [] } }) });
    const { client } = await owner();
    const res = await client.post("/api/engines/updates/check");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checksEnabled: boolean };
    expect(body.checksEnabled).toBe(true);
  });

  test("POST /updates/{name}/apply delegates to applyStackEngineUpdate", async () => {
    configure({ "POST /stack/v1/updates/engines/llama-server/apply": async () => Response.json({ applied: true, tag: "b2", previous: "b1" }) });
    const { client } = await owner();
    const res = await client.post("/api/engines/updates/llama-server/apply");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: true, tag: "b2", previous: "b1" });
  });

  test("POST /updates/{name}/rollback delegates to rollbackStackEngine with the body's tag", async () => {
    configure({
      "POST /stack/v1/updates/engines/llama-server/rollback": async (req) => {
        const { tag } = (await req.json()) as { tag: string };
        return Response.json({ ok: true, tag });
      },
    });
    const { client } = await owner();
    const res = await client.post("/api/engines/updates/llama-server/rollback", { tag: "b1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tag: "b1" });
  });

  test("POST /updates/{name}/rollback with no tag is 400 before the client is called", async () => {
    let calls = 0;
    configure({
      "POST /stack/v1/updates/engines/llama-server/rollback": async () => {
        calls++;
        return Response.json({ ok: true, tag: "b1" });
      },
    });
    const { client } = await owner();
    const res = await client.post("/api/engines/updates/llama-server/rollback", {});
    expect(res.status).toBe(400);
    expect(calls).toBe(0);
  });

  describe("each StackError kind, via GET /health", () => {
    test("offline answers 503 with the Stack's own reason", async () => {
      configure({ "GET /stack/v1/health": async () => offlineResponse("engines", "the chat role crashed on boot") });
      const { client } = await owner();
      const res = await client.get("/api/engines/health");
      expect(res.status).toBe(503);
      const body = (await res.json()) as { reason?: string };
      expect(body.reason).toBe("the chat role crashed on boot");
    });

    test("unreachable (the socket refused) answers 503", async () => {
      // Same pattern llm.test.ts's own "Stack being unreachable" test
      // uses: configure a real fixture URL, then stop the server so the
      // socket actually refuses - the connection-level failure
      // client.ts's wrapError() maps to "unreachable", distinct from a
      // scripted "offline" response above.
      configure({});
      fixture.stop();
      const { client } = await owner();
      const res = await client.get("/api/engines/health");
      expect(res.status).toBe(503);
    });

    test("unverified answers 409", async () => {
      configure({ "GET /stack/v1/health": async () => Response.json({ error: "the model is not verified" }, { status: 409 }) });
      const { client } = await owner();
      const res = await client.get("/api/engines/health");
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("the model is not verified");
    });

    test("unknown answers 400", async () => {
      configure({ "GET /stack/v1/health": async () => Response.json({ error: "bad request" }, { status: 400 }) });
      const { client } = await owner();
      const res = await client.get("/api/engines/health");
      expect(res.status).toBe(400);
    });

    test("timeout answers 504", async () => {
      configure({ "GET /stack/v1/health": async () => Response.json({ error: "gateway timeout" }, { status: 504 }) });
      const { client } = await owner();
      const res = await client.get("/api/engines/health");
      expect(res.status).toBe(504);
    });
  });
});
