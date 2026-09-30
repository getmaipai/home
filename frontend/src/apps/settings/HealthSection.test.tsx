import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { HealthSection } from "@/apps/settings/HealthSection";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { api, type HealthStatus, type Roster } from "@/lib/api";

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

      background: { kind: "none", pid: null, alive: null },
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

  test("a failed background engine has its own named row", async () => {
    const restore = stubHealth(
      health({ ok: false, engines: { ...health().engines, background: { kind: "failed", pid: null, alive: null } } }),
    );
    try {
      const { findByText, getByText } = renderWithQuery(<HealthSection person={makePerson("adult")} />);
      expect(await findByText("Something is not answering.")).toBeInTheDocument();
      expect(getByText("Memory")).toBeInTheDocument();
      expect(getByText("Keeps stopping")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("a stalled startup has a clear failed state", async () => {
    const restore = stubHealth(
      health({ ok: false, engines: { ...health().engines, chat: { kind: "stalled", pid: null, alive: null } } }),
    );
    try {
      const { findByText } = renderWithQuery(<HealthSection person={makePerson("owner")} />);
      expect(await findByText("Something is not answering.")).toBeInTheDocument();
      expect(await findByText("Start is stuck")).toBeInTheDocument();
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

          background: { kind: "none", pid: null, alive: null },
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

  // ENGINE-PORT-01 (dev.md 2026-09-23): a live process this install did
  // not spawn already holds the engine's own port - MaiPai refuses to
  // touch it rather than kill it, so this reads as a named, actionable
  // state, never a generic "not answering."
  test("a blocked engine names what happened, not just that it's down", async () => {
    const restore = stubHealth(
      health({ ok: false, engines: { ...health().engines, chat: { kind: "blocked", pid: null, alive: null } } }),
    );
    try {
      const { findByText } = renderWithQuery(<HealthSection person={makePerson("owner")} />);
      expect(await findByText("Blocked by another program")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("only owners and admins see four engine restart buttons", async () => {
    const restore = stubHealth(health());
    try {
      const admin = renderWithQuery(<HealthSection person={makePerson("admin")} />);
      expect(await admin.findAllByRole("button", { name: "Restart" })).toHaveLength(4);
      admin.unmount();
      const adult = renderWithQuery(<HealthSection person={makePerson("adult")} />);
      await adult.findByText("Everything is running.");
      expect(adult.queryByRole("button", { name: "Restart" })).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("engine restart waits for confirmation, calls its role route, disables only that row, and refreshes health", async () => {
    const original = globalThis.fetch;
    let resolveRestart!: (response: Response) => void;
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url.includes("/api/health")) return Promise.resolve(new Response(JSON.stringify(health()), { status: 200 }));
      if (url.includes("/api/host/engines/chat/restart")) return new Promise<Response>((resolve) => { resolveRestart = resolve; });
      return Promise.reject(new Error(`unstubbed fetch: ${method} ${url}`));
    }) as unknown as typeof fetch;
    try {
      const { findAllByRole, getByRole, queryByRole } = renderWithQuery(<HealthSection person={makePerson("owner")} />);
      const buttons = await findAllByRole("button", { name: "Restart" });
      const brainButton = buttons[0];
      if (!brainButton) throw new Error("Brain restart button not found");
      const brainRow = brainButton.parentElement?.parentElement;
      if (!brainRow) throw new Error("Brain row not found");
      const otherButtons = buttons.slice(1);
      fireEvent.click(brainButton);
      expect(getByRole("alertdialog")).toHaveTextContent("Restart Brain?");
      expect(getByRole("alertdialog")).toHaveTextContent("Anything using it will pause for a moment.");
      expect(getByRole("alertdialog")).toHaveTextContent("A reply being written right now will be cut off.");
      expect(calls.some((call) => call.url.includes("/api/host/engines/chat/restart"))).toBe(false);
      fireEvent.click(within(getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(calls.some((call) => call.url.includes("/api/host/engines/chat/restart"))).toBe(false);
      fireEvent.click(brainButton);
      fireEvent.click(within(getByRole("alertdialog")).getByRole("button", { name: "Restart engine" }));
      await waitFor(() => expect(calls.some((call) => call.url.includes("/api/host/engines/chat/restart"))).toBe(true));
      expect(calls.filter((call) => call.url.includes("/api/host/engines/chat/restart"))).toEqual([
        { url: "/api/host/engines/chat/restart", method: "POST" },
      ]);
      await waitFor(() => expect(brainRow.querySelector("button")?.disabled).toBe(true));
      expect(otherButtons.every((button) => !button.hasAttribute("disabled"))).toBe(true);
      resolveRestart(new Response(JSON.stringify({ role: "chat", restarted: true }), { status: 200 }));
      await waitFor(() => expect(brainRow.querySelector("button")?.disabled).toBe(false));
      await waitFor(() => expect(calls.filter((call) => call.url.includes("/api/health"))).toHaveLength(2));
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a failed restart shows the server sentence", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/health")) return Promise.resolve(new Response(JSON.stringify(health()), { status: 200 }));
      if (url.includes("/api/host/engines/embed/restart") && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ error: "Understanding could not restart." }), { status: 503 }));
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;
    try {
      const { findAllByRole, getByRole, findByText } = renderWithQuery(<HealthSection person={makePerson("owner")} />);
      const understandingButton = (await findAllByRole("button", { name: "Restart" }))[1];
      if (!understandingButton) throw new Error("Understanding restart button not found");
      fireEvent.click(understandingButton);
      await waitFor(() => expect(getByRole("button", { name: "Restart engine" })).toBeEnabled());
      fireEvent.click(within(getByRole("alertdialog")).getByRole("button", { name: "Restart engine" }));
      expect(await findByText("Understanding could not restart.")).toBeInTheDocument();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("restartEngineRole posts to the selected engine route", async () => {
    const original = globalThis.fetch;
    let request: { url: string; method: string } | undefined;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      request = { url: typeof input === "string" ? input : input.toString(), method: init?.method ?? "GET" };
      return Promise.resolve(new Response(JSON.stringify({ role: "voice", restarted: true }), { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      expect(await api.restartEngineRole("voice")).toEqual({ role: "voice", restarted: true });
      expect(request).toEqual({ url: expect.stringContaining("/api/host/engines/voice/restart"), method: "POST" });
    } finally {
      globalThis.fetch = original;
    }
  });
});
