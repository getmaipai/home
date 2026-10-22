import { http, HttpResponse } from "msw";
import { getScenario } from "./scenarios";
import type { Scenario } from "./scenarios/types";

export function handlersFor(scenario: Scenario) {
  const state = structuredClone(scenario.state);
  let allowedTailnet = false;
  let chosenSearch = false;
  const coding = { eligible_mode: true, pieces: [{ id: "engine", label: "Coding engine", size_bytes: 12 * 1024 ** 3, state: "notInstalled" }, { id: "model", label: "Coding model", size_bytes: 64 * 1024 ** 3, state: "notInstalled" }, { id: "draft", label: "Draft model", size_bytes: 8 * 1024 ** 3, state: "notInstalled" }], total_bytes: 84 * 1024 ** 3, readiness: { ready: false, first_unmet: "pieces", checked_at: new Date().toISOString(), items: [], provenance: "preview", hlc: "1791979200000:0:abcdef" } };
  return [
    http.get("*/api/setup/state", () => HttpResponse.json(state)),
    http.get("*/api/setup/coding", () => HttpResponse.json(coding)),
    http.post("*/api/setup/coding", () => HttpResponse.json({ accepted: true })),
    http.get("*/api/jobs", () => HttpResponse.json(scenario.progress ? [{ id: "preview-download", kind: "model_download", state: scenario.progress.state, title: "Starter model download", progress: { completedBytes: Math.round(10_000_000_000 * scenario.progress.percent / 100), totalBytes: 10_000_000_000, bytesPerSecond: scenario.progress.bytesPerSecond, percent: scenario.progress.percent }, actions: [] }] : [])),
    http.get("*/api/setup/install", () => HttpResponse.json({ state: "idle", chatReady: false, complete: false, percent: 0, completedBytes: 0, totalBytes: 0, bytesPerSecond: null, etaSeconds: null, problem: null, items: [] })),
    http.post("*/api/setup/checks/run", () => HttpResponse.json({ rows: scenario.checks.map((row) => row.action === "allow_tailnet" && allowedTailnet ? { ...row, state: "green", text: "Allowed." } : row), state, searchCandidate: chosenSearch ? null : scenario.searchCandidate })),
    http.post("*/api/setup/checks/allow-tailnet", () => { allowedTailnet = true; return HttpResponse.json({ enabled: true }); }),
    http.post("*/api/setup/search/use-candidate", () => { chosenSearch = true; return HttpResponse.json({ saved: true }); }),
    http.post("*/api/setup/:step", async ({ params, request }) => {
      if (scenario.ownerConflict && params.step === "owner") return HttpResponse.json({ error: "Home is already set up. Sign in instead." }, { status: 409 });
      if ("done" in state) return HttpResponse.json(state);
      const parsed = await request.json() as { status?: string };
      if (!("done" in state)) state.steps = state.steps.map((step) => step.id === params.step ? { ...step, status: (parsed.status ?? "done") as typeof step.status, at: new Date().toISOString() } : step);
      return HttpResponse.json(state);
    }),
    http.post("*/api/auth/setup", () => scenario.ownerConflict ? HttpResponse.json({ error: "Home is already set up. Sign in instead." }, { status: 409 }) : HttpResponse.json({ person: { id: "preview-owner" } }, { status: 201 })),
    http.get("*/api/setup/ca", () => HttpResponse.json(scenario.certificate)),
    http.get("*/api/tailscale/status", () => HttpResponse.json(scenario.tailscale)),
    http.post("*/api/tailscale/enable", () => HttpResponse.json({ url: "https://home.example.com", qrPayload: "https://home.example.com" })),
    http.get("*/api/backups/emergency-kit", () => HttpResponse.json(scenario.backup)),
  ];
}

export function installFetchHandlers(scenario: Scenario, target: typeof globalThis = globalThis) {
  const original = target.fetch;
  const requests: string[] = [];
  target.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) throw new Error(`Preview blocked outbound request: ${url.href}`);
    requests.push(`${request.method} ${url.pathname}`);
    const routes = [
      [/^\/api\/setup\/state$/, "GET", () => scenario.state],
      [/^\/api\/setup\/coding$/, "GET", () => ({ eligible_mode: true, pieces: [{ id: "engine", label: "Coding engine", size_bytes: 12 * 1024 ** 3, state: "notInstalled" }, { id: "model", label: "Coding model", size_bytes: 64 * 1024 ** 3, state: "notInstalled" }, { id: "draft", label: "Draft model", size_bytes: 8 * 1024 ** 3, state: "notInstalled" }], total_bytes: 84 * 1024 ** 3, readiness: { ready: false, first_unmet: "pieces", checked_at: new Date().toISOString(), items: [], provenance: "preview", hlc: "1791979200000:0:abcdef" } })],
      [/^\/api\/setup\/install$/, "GET", () => ({ state: "idle", chatReady: false, complete: false, percent: 0, completedBytes: 0, totalBytes: 0, bytesPerSecond: null, etaSeconds: null, problem: null, items: [] })],
      [/^\/api\/setup\/checks\/run$/, "POST", () => ({ rows: scenario.checks, state: scenario.state, searchCandidate: scenario.searchCandidate })],
      [/^\/api\/setup\/ca$/, "GET", () => scenario.certificate],
      [/^\/api\/tailscale\/status$/, "GET", () => scenario.tailscale],
      [/^\/api\/backups\/emergency-kit$/, "GET", () => scenario.backup],
      [/^\/api\/auth\/setup$/, "POST", () => ({ person: { id: "preview-owner" } })],
    ] as const;
    for (const [pattern, method, body] of routes) if (request.method === method && pattern.test(url.pathname)) return Response.json(body());
    if (request.method === "POST" && url.pathname === "/api/setup/coding") return Response.json({ accepted: true });
    if (request.method === "POST" && /^\/api\/setup\/[\w-]+$/.test(url.pathname)) return Response.json(scenario.state);
    throw new Error(`Unhandled preview request: ${request.method} ${url.pathname}`);
  }) as typeof globalThis.fetch;
  return { requests, restore: () => { target.fetch = original; } };
}

export function scenarioForPage() { return getScenario(new URLSearchParams(window.location.search).get("scenario") ?? "happy-local"); }
