import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { StatusPage } from "@/shell/pages/StatusPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { EngineComputerStatus, Roster, StatusAppsResponse, StatusHistory } from "@/lib/api";

afterEach(cleanup);

function makePerson(role: Roster["role"]): Roster {
  return { id: "person-abc123", display_name: "Nova", nickname: null, role, avatar_seed: "person-abc123", source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true } as Roster;
}

const apps: StatusAppsResponse = [
  { id: "chat", name: "Chat", state: "down", reason: "Chat isn't working right now.", needs: [{ kind: "engine", id: "chat", name: "Brain", purpose: "Chat model", state: "down", required: true }], history: Array.from({ length: 90 }, (_, index) => ({ date: `2026-07-${String((index % 30) + 1).padStart(2, "0")}`, state: index === 89 ? "down" : "operational", uptime: index === 89 ? 50 : 100, minutes: { operational: index === 89 ? 1439 : 1440, degraded: 0, outage: index === 89 ? 1 : 0, maintenance: 0 } })), uptimePercent: 99.5 },
  ...["Home", "Videos", "Music", "Podcasts"].map((name) => ({ id: name.toLowerCase(), name, state: "operational" as const, reason: null, needs: [{ kind: "engine" as const, id: "chat", name: "Brain", purpose: "Chat model", state: "operational" as const, required: true }], history: Array.from({ length: 90 }, (_, index) => ({ date: `2026-07-${String((index % 30) + 1).padStart(2, "0")}`, state: "operational" as const, uptime: 100, minutes: { operational: 1440, degraded: 0, outage: 0, maintenance: 0 } })), uptimePercent: 100 })),
];

function mockStatus(includeNeeds: boolean, history: StatusHistory = { generated_at: new Date().toISOString(), days: 90, components: [], incidents: [] }, engineComputer?: EngineComputerStatus) {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    paths.push(url.split("?")[0] ?? "");
    if (url.includes("/api/status/apps")) return Promise.resolve(Response.json(includeNeeds ? apps : apps.map(({ needs: _needs, ...app }) => app)));
    if (url.includes("/api/health-checks")) return Promise.resolve(Response.json({ running: false, last_checked_at: new Date(Date.now() - 3 * 60_000).toISOString(),
      groups: [{ group: "chat", label: "chat", state: "pass" }, { group: "tools", label: "tools", state: "pass" }, { group: "search", label: "search", state: "fail" }, { group: "voice", label: "voice", state: "unknown" }, { group: "pictures", label: "pictures", state: "pass" }],
      checks: [{ id: "chat_search_trigger", name: "Chat searches the web", group: "search", state: "fail", at: null, duration_ms: 1, first_token_ms: null, note: "Chat is up but did not search the web when asked." }] }));
    if (url.includes("/api/health")) return Promise.resolve(Response.json({
      brain: "selection", voice: "spawned", ok: true, uptimeSeconds: 60,
      engines: { chat: { kind: "selection", pid: null, alive: true }, embed: { kind: "spawned", pid: null, alive: true }, background: { kind: "spawned", pid: null, alive: true }, voice: { kind: "spawned", pid: null, alive: true } }, sidecars: [],
    }));
    if (url.includes("/api/performance/other-apps")) return Promise.resolve(Response.json({ source: "helper", apps: [{ name: "Safari", bytes: 9 * 1024 ** 3 }] }));
    if (url.includes("/api/status/history")) return Promise.resolve(Response.json(history));
    if (url.includes("/api/status/board")) return Promise.resolve(Response.json({ note: null, maintenance: [] }));
    if (url.includes("/api/status/engine-computer")) return Promise.resolve(Response.json(engineComputer ?? { configured: false, state: "not_reachable", reason: null }));
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
  return { paths, restore: () => { globalThis.fetch = original; } };
}

describe("StatusPage health checks (CANARY-01)", () => {
  test("admins see when it last checked and a pass or fail per group; members see no row", async () => {
    const { restore } = mockStatus(true);
    const base = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/health-checks")) return Promise.resolve(Response.json({ running: false, last_checked_at: new Date(Date.now() - 3 * 60_000).toISOString(),
        groups: [{ group: "chat", label: "chat", state: "pass" }, { group: "tools", label: "tools", state: "pass" }, { group: "search", label: "search", state: "fail" }, { group: "voice", label: "voice", state: "unknown" }, { group: "pictures", label: "pictures", state: "pass" }],
        checks: [{ id: "chat_search_trigger", name: "Chat searches the web", group: "search", state: "fail", at: null, duration_ms: 1, first_token_ms: null, note: "Chat is up but did not search the web when asked." }] }));
      return (base as typeof fetch)(input);
    }) as unknown as typeof fetch;
    try {
      const admin = renderWithQueryClient(<StatusPage person={makePerson("admin")} />);
      expect(await admin.findByText(/Last checked 3 minutes ago: chat, tools, search, voice, pictures/)).toBeTruthy();
      expect(admin.getByText("search: Failed")).toBeTruthy();
      expect(admin.getByText("voice: Not checked")).toBeTruthy();
      expect(admin.getByRole("button", { name: "Run checks now" })).toBeTruthy();
      cleanup();
      const member = renderWithQueryClient(<StatusPage person={makePerson("adult")} />);
      expect(await member.findByText("Apps")).toBeTruthy();
      expect(member.queryByTestId("health-checks")).toBeNull();
    } finally { globalThis.fetch = base; restore(); }
  });
});

describe("StatusPage health checks (CANARY-01)", () => {
  test("admins see when it last checked and a pass or fail per group, with the reason a check failed", async () => {
    const { restore } = mockStatus(true);
    try {
      const view = renderWithQueryClient(<StatusPage person={makePerson("admin")} />);
      expect(await view.findByText(/Last checked 3 minutes ago: chat, tools, search, voice, pictures/)).toBeTruthy();
      expect(view.getByText("search: Failed")).toBeTruthy();
      expect(view.getByText("voice: Not checked")).toBeTruthy();
      expect(view.getByText(/did not search the web when asked/)).toBeTruthy();
      expect(view.getByRole("button", { name: "Run checks now" })).toBeTruthy();
    } finally { restore(); }
  });

  test("members see no health checks row and never ask for it", async () => {
    const { paths, restore } = mockStatus(false);
    try {
      const view = renderWithQueryClient(<StatusPage person={makePerson("adult")} />);
      expect(await view.findByText("Apps")).toBeTruthy();
      expect(view.queryByTestId("health-checks")).toBeNull();
      expect(paths.some((p) => p.includes("/api/health-checks"))).toBe(false);
    } finally { restore(); }
  });
});

describe("StatusPage app-first view", () => {
  test.each([
    ["working", "Working"], ["connecting", "Connecting"], ["slow_to_answer", "Slow to answer"],
    ["reconnecting", "Reconnecting"], ["not_reachable", "Not reachable"],
  ] as const)("shows the plain-language engine computer state %s to a member", async (state, visible) => {
    const { restore } = mockStatus(false, undefined, { configured: true, state, reason: "The engine computer did not answer in time." });
    try {
      const view = renderWithQueryClient(<StatusPage person={makePerson("adult")} />);
      expect(await view.findByText(`Engine computer: ${visible}`)).toBeTruthy();
      expect(view.getByText("The engine computer did not answer in time.")).toBeTruthy();
      expect(view.queryByText(/Through your|Last probe|Stack contract/)).toBeNull();
    } finally { restore(); }
  });

  test("admins see approved connection details and members do not", async () => {
    const payload: EngineComputerStatus = { configured: true, state: "working", reason: null, details: { path: "tailnet", lastProbeAt: "2026-10-07T12:00:00.000Z", contract: "3" } };
    const adminMock = mockStatus(true, undefined, payload);
    try {
      const admin = renderWithQueryClient(<StatusPage person={makePerson("admin")} />);
      expect(await admin.findByText("Through your Tailscale network")).toBeTruthy();
      expect(admin.getByText("Stack contract:").parentElement?.textContent).toContain("3");
    } finally { adminMock.restore(); }
    const memberMock = mockStatus(false, undefined, { ...payload, details: undefined });
    try {
      const member = renderWithQueryClient(<StatusPage person={makePerson("adult")} />);
      expect(await member.findByText("Engine computer: Working")).toBeTruthy();
      const statusCard = member.container.querySelector("[data-engine-computer-status]");
      expect(statusCard?.textContent).not.toContain("Through your");
      expect(statusCard?.textContent).not.toContain("Last probe:");
      expect(statusCard?.textContent).not.toContain("Stack contract:");
    } finally { memberMock.restore(); }
  });
  test("members get app rows, reason, and bars without dependency names, controls, or raw-part requests", async () => {
    const { paths, restore } = mockStatus(false);
    try {
      const view = renderWithQueryClient(<StatusPage person={makePerson("adult")} />);
      expect(await view.findByText("Apps")).toBeTruthy();
      expect(view.getAllByText("Chat isn't working right now.").length).toBeGreaterThan(0);
      for (const name of ["Chat", "Home", "Videos", "Music", "Podcasts"]) expect(view.getAllByText(name).length).toBeGreaterThan(0);
      expect(view.getAllByText("Chat isn't working right now.").some((line) => line.closest("[data-status-banner]") !== null)).toBe(true);
      expect(view.queryByText("Needs: Brain (down)")).toBeNull();
      expect(view.queryByText("Behind the scenes")).toBeNull();
      expect(view.queryByText("Brain", { exact: true })).toBeNull();
      expect(view.queryByRole("button", { name: /Restart|Stop|Start/ })).toBeNull();
      expect(paths).toContain("/api/status/apps");
      expect(paths).not.toContain("/api/health");
      expect(paths).not.toContain("/api/status/history");
    } finally { restore(); }
  });

  test("admins get each app's needs and the original raw parts and controls below them", async () => {
    const { paths, restore } = mockStatus(true);
    try {
      const view = renderWithQueryClient(<StatusPage person={makePerson("admin")} />);
      expect(await view.findByText("Apps")).toBeTruthy();
      expect(await view.findByText("Chat isn't working: Brain isn't running.")).toBeTruthy();
      expect(await view.findByText("Needs attention")).toBeTruthy();
      expect(await view.findByText("Behind the scenes")).toBeTruthy();
      expect((await view.findAllByText("Brain", { exact: true })).length).toBeGreaterThan(0);
      expect(view.getAllByRole("button", { name: "Restart" })).toHaveLength(4);
      expect(paths).toContain("/api/health");
      expect(paths).toContain("/api/status/history");
      const appsCard = view.getByText("Apps").closest("[data-slot='card']");
      const scenesHeading = view.getByText("Behind the scenes");
      expect(appsCard !== null && Boolean(appsCard?.compareDocumentPosition(scenesHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    } finally { restore(); }
  });

  test("admin incident timeline uses only the existing status-history response", async () => {
    const history = { generated_at: "2026-09-30T12:00:00.000Z", days: 90, components: [], incidents: [
      { component: "chat", started_at: "2026-09-29T10:00:00.000Z", ended_at: null, minutes: 120, ongoing: true },
      { component: "voice", started_at: "2026-09-27T08:00:00.000Z", ended_at: "2026-09-27T08:35:00.000Z", minutes: 35, ongoing: false },
    ] } satisfies StatusHistory;
    const { paths, restore } = mockStatus(true, history);
    try {
      const view = renderWithQueryClient(<StatusPage person={makePerson("admin")} />);
      expect(await view.findByText("Recent problems")).toBeTruthy();
      expect(view.container.querySelectorAll('[data-slot="timeline"]')).toHaveLength(1);
      const timeline = view.container.querySelector('[data-slot="timeline"]')!;
      expect(timeline.textContent).toContain("Ongoing since");
      expect(timeline.textContent).toContain("2 h");
      expect(timeline.textContent).toContain("Ended");
      expect(timeline.textContent).toContain("35 min");
      expect(timeline.textContent).toContain("Brain");
      expect(timeline.textContent).toContain("Voice");
      expect(paths.filter((path) => path === "/api/status/history")).toHaveLength(1);
    } finally { restore(); }
  });

  test("an admin reads how often chat paused today and why; a member does not", async () => {
    const history = { generated_at: "2026-09-30T12:00:00.000Z", days: 90, components: [], incidents: [], chat_pauses: { count: 3, causes: { restarting: 2, memory: 1 }, line: "Chat was paused 3 times today: restarting (2), low memory (1)." } } satisfies StatusHistory;
    const admin = mockStatus(true, history);
    try {
      const view = renderWithQueryClient(<StatusPage person={makePerson("admin")} />);
      expect((await view.findByTestId("chat-pauses")).textContent).toBe("Chat was paused 3 times today: restarting (2), low memory (1).");
      view.unmount();
    } finally { admin.restore(); }
    const member = mockStatus(true, history);
    try {
      const view = renderWithQueryClient(<StatusPage person={makePerson("adult")} />);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(view.queryByTestId("chat-pauses")).toBeNull();
    } finally { member.restore(); }
  });

  test("admins see the memory ledger row and paged out warning; members do not", async () => {
    const history = { generated_at: "2026-10-25T12:00:00.000Z", days: 90, components: [], incidents: [], memory_ledger: {
      reserved_bytes: 21.5 * 1024 ** 3, warm_bytes: 15.25 * 1024 ** 3, burst_bytes: 42.75 * 1024 ** 3,
      budget_bytes: 116 * 1024 ** 3, working_margin_bytes: 20 * 1024 ** 3, free_bytes: 36.5 * 1024 ** 3,
      queue_depth: { reserved: 1, warm: 2, burst: 3 }, chat_paged_out: true,
    } } satisfies StatusHistory;
    const adminMock = mockStatus(true, history);
    try {
      const admin = renderWithQueryClient(<StatusPage person={makePerson("admin")} />);
      expect(await admin.findByTestId("memory-ledger")).toBeTruthy();
      expect(admin.getByText("Memory in use by chat and voice: 21.5 GB")).toBeTruthy();
      expect(admin.getByText("Kept ready for pictures and tools: 15.3 GB")).toBeTruthy();
      expect(admin.getByText("Running a big job: 42.8 GB")).toBeTruthy();
      expect(admin.getByText("Free for jobs: 36.5 GB")).toBeTruthy();
      expect(admin.getByText("Waiting in line: chat and voice 1, pictures and tools 2, big jobs 3")).toBeTruthy();
      expect(admin.getByText("Chat is being paged out to disk. Close big apps, or stop a big job.")).toBeTruthy();
      expect((await admin.findByTestId("other-app")).textContent).toBe("Safari is using 9.0 GB. Closing it gives big jobs more room.");
      admin.unmount();
    } finally { adminMock.restore(); }

    const memberMock = mockStatus(true, history);
    try {
      const member = renderWithQueryClient(<StatusPage person={makePerson("adult")} />);
      await member.findByText("Apps");
      expect(member.queryByTestId("memory-ledger")).toBeNull();
      expect(member.queryByTestId("other-app")).toBeNull();
      expect(memberMock.paths).not.toContain("/api/performance/other-apps");
      expect(member.queryByText(/Memory in use by chat and voice/)).toBeNull();
    } finally { memberMock.restore(); }
  });

  test("an older Stack without ledger data renders no memory row", async () => {
    const history = { generated_at: "2026-10-25T12:00:00.000Z", days: 90, components: [], incidents: [] } satisfies StatusHistory;
    const { restore } = mockStatus(true, history);
    try {
      const admin = renderWithQueryClient(<StatusPage person={makePerson("admin")} />);
      await admin.findByText("Apps");
      expect(admin.queryByTestId("memory-ledger")).toBeNull();
    } finally { restore(); }
  });
});
