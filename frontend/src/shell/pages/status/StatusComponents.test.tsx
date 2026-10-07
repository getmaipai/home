import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { StatusComponents } from "@/shell/pages/status/StatusComponents";
import { StatusBanner } from "@/shell/pages/status/StatusBanner";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { api, type HealthStatus, type Roster } from "@/lib/api";

afterEach(cleanup);

const statusAsyncTimeout = { timeout: 10_000 };

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

// StatusComponents reads through react-query (a 15 s refetch), so it needs
// the provider the app shell normally supplies; retries off so a failed
// stub surfaces at once instead of after react-query's own backoff.
function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider><TooltipProvider>{ui}</TooltipProvider></ToastProvider>
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
describe("StatusComponents", () => {
  test("the Element info tooltip button keeps its accessible name", async () => {
    const restore = stubHealth(health());
    try {
      const { findByRole } = renderWithQuery(<StatusComponents person={makePerson("owner")} health={health()} />);
      expect(await findByRole("button", { name: "About Brain" })).toBeInTheDocument();
    } finally { restore(); }
  });

  test("all engines answering reads as everything running", async () => {
    const restore = stubHealth(health());
    try {
      const { findByText, getAllByText } = renderWithQuery(<><StatusBanner summary={{ level: "online", text: "All good", problems: [] }} uptimeSeconds={health().uptimeSeconds} /><StatusComponents person={makePerson("owner")} health={health()} /></>);
      expect(await findByText("Everything is running. Up for 1 hour 1 minute.")).toBeInTheDocument();
      expect(getAllByText("Running")).toHaveLength(4);
    } finally {
      restore();
    }
  });

  test("uptime uses readable minute, hour and day phrases", () => {
    for (const [seconds, phrase] of [[60, "1 minute"], [3_600, "1 hour"], [172_800, "2 days"]] as const) {
      const view = renderWithQuery(<StatusBanner summary={{ level: "online", text: "All good", problems: [] }} uptimeSeconds={seconds} />);
      expect(view.getByText(`Everything is running. Up for ${phrase}.`)).toBeInTheDocument();
      view.unmount();
    }
  });

  test("a dead engine reads as not answering, and the headline says so", async () => {
    const restore = stubHealth(
      health({ ok: false, engines: { ...health().engines, chat: { kind: "selection", pid: 4242, alive: false } } }),
    );
    try {
      const { findByText, getByText } = renderWithQuery(<><StatusBanner summary={{ level: "offline", text: "Something is down", problems: ["Brain"] }} /><StatusComponents person={makePerson("adult")} health={health()} /></>);
      expect(await findByText("We're having problems")).toBeInTheDocument();
      expect(getByText("Not running")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("a failed background engine has its own named row", async () => {
    const restore = stubHealth(
      health({ ok: false, engines: { ...health().engines, background: { kind: "failed", pid: null, alive: null } } }),
    );
    try {
      const { findByText, getByText } = renderWithQuery(<><StatusBanner summary={{ level: "offline", text: "Something is down", problems: ["Memory"] }} /><StatusComponents person={makePerson("adult")} health={health()} /></>);
      expect(await findByText("We're having problems")).toBeInTheDocument();
      expect(getByText("Memory", { selector: "[data-slot='card-content'] span.font-medium" })).toBeInTheDocument();
      expect(getByText("Not running")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("a stalled startup has a clear failed state", async () => {
    const restore = stubHealth(
      health({ ok: false, engines: { ...health().engines, chat: { kind: "stalled", pid: null, alive: null } } }),
    );
    try {
      const { findByText } = renderWithQuery(<><StatusBanner summary={{ level: "offline", text: "Something is down", problems: ["Brain"] }} /><StatusComponents person={makePerson("owner")} health={health()} /></>);
      expect(await findByText("We're having problems")).toBeInTheDocument();
      expect(await findByText("Not running")).toBeInTheDocument();
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
      const { findByText, getByText } = renderWithQuery(<StatusComponents person={makePerson("owner")} health={health()} />);
      expect(await findByText("Restarting")).toBeInTheDocument();
      expect(getByText("Not running")).toBeInTheDocument();
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
      const { findByText } = renderWithQuery(<StatusComponents person={makePerson("owner")} health={health()} />);
      expect(await findByText("Blocked")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("short state words cover every existing engine state", async () => {
    const cases = [
      [{ kind: "stub", pid: null, alive: true }, "Demo mode"],
      [{ kind: "blocked", pid: null, alive: null }, "Blocked"],
      [{ kind: "selection", pid: 1, alive: true }, "Running"],
      [{ kind: "selection", pid: 1, alive: false }, "Not running"],
      [{ kind: "restarting", pid: null, alive: null }, "Restarting"],
      [{ kind: "failed", pid: null, alive: null }, "Not running"],
      [{ kind: "stalled", pid: null, alive: null }, "Not running"],
      [{ kind: "starting", pid: null, alive: null }, "Starting"],
      [{ kind: "stopped", pid: null, alive: null }, "Stopped"],
      [{ kind: "none", pid: null, alive: null }, "Stopped"],
    ] as const;
    for (const [entry, label] of cases) {
      const restore = stubHealth(health({ engines: { ...health().engines, chat: entry } }));
      try {
        const view = renderWithQuery(<StatusComponents person={makePerson("child")} health={health({ engines: { ...health().engines, chat: entry } })} />);
        expect(await view.findAllByText(label)).not.toHaveLength(0);
        view.unmount();
      } finally { restore(); }
    }
  });

  test("Library appears only when kiwix-serve is registered", async () => {
    const restore = stubHealth(health({ sidecars: [{ id: "kiwix-serve", status: "running", baseUrl: "http://127.0.0.1" }] }));
    try {
      const view = renderWithQuery(<StatusComponents person={makePerson("child")} health={health({ sidecars: [{ id: "kiwix-serve", status: "running", baseUrl: "http://127.0.0.1" }] })} />);
      expect(await view.findByText("Library")).toBeInTheDocument();
      expect(view.getByText("Offline reference library.")).toBeInTheDocument();
    } finally { restore(); }
  });

  test("only owners and admins see four engine restart buttons", async () => {
    const restore = stubHealth(health());
    try {
      const admin = renderWithQuery(<StatusComponents person={makePerson("admin")} health={health()} />);
      expect(await admin.findAllByRole("button", { name: "Restart" })).toHaveLength(4);
      admin.unmount();
      const adult = renderWithQuery(<StatusComponents person={makePerson("adult")} health={health()} />);
      expect(adult.queryByRole("button", { name: "Restart" })).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("engine controls show Stop while running and Start while manually stopped", async () => {
    const stopped = health({ engines: {
      chat: { kind: "stopped", pid: null, alive: null },
      embed: { kind: "stopped", pid: null, alive: null },
      background: { kind: "stopped", pid: null, alive: null },
      voice: { kind: "stopped", pid: null, alive: null },
    } });
    const restore = stubHealth(stopped);
    try {
      const view = renderWithQuery(<StatusComponents person={makePerson("admin")} health={stopped} />);
      expect(await view.findAllByRole("button", { name: "Start" })).toHaveLength(4);
      expect(view.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
      view.unmount();
      const running = health();
      const liveRestore = stubHealth(running);
      try {
        const live = renderWithQuery(<StatusComponents person={makePerson("admin")} health={running} />);
        expect(await live.findAllByRole("button", { name: "Stop" })).toHaveLength(3);
        expect(live.getAllByRole("button", { name: "Start" })).toHaveLength(1);
        expect(live.getAllByRole("button", { name: "Restart" })).toHaveLength(4);
        live.unmount();
        const adult = renderWithQuery(<StatusComponents person={makePerson("adult")} health={running} />);
        expect(adult.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
        expect(adult.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
        expect(adult.queryByRole("button", { name: "Restart" })).not.toBeInTheDocument();
      } finally { liveRestore(); }
    } finally { restore(); }
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
      const { findAllByRole, getByRole } = renderWithQuery(<StatusComponents person={makePerson("owner")} health={health()} />);
      const buttons = await findAllByRole("button", { name: "Restart" }, statusAsyncTimeout);
      const brainButton = buttons[0];
      if (!brainButton) throw new Error("Brain restart button not found");
      const brainRow = brainButton.parentElement?.parentElement?.parentElement;
      if (!brainRow) throw new Error("Brain row not found");
      const otherButtons = buttons.slice(1);
      fireEvent.click(brainButton);
      expect(getByRole("alertdialog")).toHaveTextContent("Restart Brain?");
      expect(getByRole("alertdialog")).toHaveTextContent("Anything using it will pause for a moment.");
      expect(getByRole("alertdialog")).toHaveTextContent("A reply being written right now will be cut off.");
      expect(calls.some((call) => call.url.includes("/api/host/engines/chat/restart"))).toBe(false);
      fireEvent.click(within(getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(getByRole("alertdialog")).toHaveAttribute("data-closed"), statusAsyncTimeout);
      expect(calls.some((call) => call.url.includes("/api/host/engines/chat/restart"))).toBe(false);
      fireEvent.click(brainButton);
      fireEvent.click(within(getByRole("alertdialog")).getByRole("button", { name: "Restart" }));
      await waitFor(() => expect(calls.some((call) => call.url.includes("/api/host/engines/chat/restart"))).toBe(true), statusAsyncTimeout);
      expect(calls.filter((call) => call.url.includes("/api/host/engines/chat/restart"))).toEqual([
        { url: "/api/host/engines/chat/restart", method: "POST" },
      ]);
      await waitFor(() => expect(brainRow.querySelector<HTMLButtonElement>('button[data-slot="button"]')?.disabled).toBe(true), statusAsyncTimeout);
      expect(otherButtons.every((button) => !button.hasAttribute("disabled"))).toBe(true);
      resolveRestart(new Response(JSON.stringify({ role: "chat", restarted: true }), { status: 200 }));
      await waitFor(() => expect(brainRow.querySelector<HTMLButtonElement>('button[data-slot="button"]')?.disabled).toBe(false), statusAsyncTimeout);
      await waitFor(() => expect(calls.filter((call) => call.url.includes("/api/health"))).toHaveLength(2), statusAsyncTimeout);
    } finally {
      globalThis.fetch = original;
    }
  }, 30_000);

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
      const { findAllByRole, getByRole, findByText } = renderWithQuery(<StatusComponents person={makePerson("owner")} health={health()} />);
      const understandingButton = (await findAllByRole("button", { name: "Restart" }, statusAsyncTimeout))[1];
      if (!understandingButton) throw new Error("Understanding restart button not found");
      fireEvent.click(understandingButton);
      await waitFor(() => expect(getByRole("button", { name: "Restart" })).toBeEnabled(), statusAsyncTimeout);
      fireEvent.click(within(getByRole("alertdialog")).getByRole("button", { name: "Restart" }));
      expect(await findByText("Understanding could not restart.", undefined, statusAsyncTimeout)).toBeInTheDocument();
    } finally {
      globalThis.fetch = original;
    }
  }, 30_000);

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
