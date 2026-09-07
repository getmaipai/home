import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { HealthSection } from "@/apps/settings/HealthSection";
import { ToastProvider } from "@/kit/primitives/Toast";
import type { HealthStatus, Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(role: Roster["role"]): Roster {
  return {
    id: "person-owner",
    display_name: "Sage",
    nickname: null,
    role,
    avatar_seed: "person-owner",
    source: "hub",
    local_only: false,
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
  };
}

function health(overrides: Partial<HealthStatus> = {}): HealthStatus {
  return {
    brain: "selection",
    voice: "spawned",
    ok: true,
    engines: {
      chat: { kind: "selection", pid: 4242, alive: true },
      embed: { kind: "spawned", pid: 4243, alive: true },
      voice: { kind: "spawned", pid: 4244, alive: true },
    },
    uptimeSeconds: 3_700,
    sidecars: [],
    ...overrides,
  };
}

// HealthSection reads through react-query (a 15 s refetch), so it needs
// the provider the app shell normally supplies; retries off so a failed
// stub surfaces at once instead of after react-query's own backoff.
function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

function stubHealth(body: HealthStatus) {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/health")) return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

// The 2026-09-07 question this page has to answer honestly: "why didn't
// our health page show bad health when these are down." Every state
// below comes from the backend's real probe, never from a kind label.
describe("HealthSection", () => {
  test("all engines answering reads as everything running", async () => {
    const restore = stubHealth(health());
    try {
      const { findByText, getAllByText } = renderWithQuery(<HealthSection person={makePerson("owner")} />);
      expect(await findByText("Everything is running.")).toBeInTheDocument();
      expect(getAllByText("Running")).toHaveLength(3);
    } finally {
      restore();
    }
  });

  test("a dead engine reads as not answering, and the headline says so", async () => {
    const restore = stubHealth(
      health({ ok: false, engines: { ...health().engines, chat: { kind: "selection", pid: 4242, alive: false } } }),
    );
    try {
      const { findByText, getByText } = renderWithQuery(<HealthSection person={makePerson("adult")} />);
      expect(await findByText("Something is not answering.")).toBeInTheDocument();
      expect(getByText("Not answering")).toBeInTheDocument();
      expect(getByText(/restarts a stopped engine on its own/)).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("the auto-heal's own states are named, not hidden behind 'starts when needed'", async () => {
    const restore = stubHealth(
      health({
        ok: false,
        engines: {
          chat: { kind: "restarting", pid: null, alive: null },
          embed: { kind: "failed", pid: null, alive: null },
          voice: { kind: "stub", pid: null, alive: true },
        },
      }),
    );
    try {
      const { findByText, getByText } = renderWithQuery(<HealthSection person={makePerson("owner")} />);
      expect(await findByText("Restarting")).toBeInTheDocument();
      expect(getByText("Keeps stopping")).toBeInTheDocument();
      // The built-in stand-in answers health checks but is never "Running".
      expect(getByText("Demo mode")).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});
