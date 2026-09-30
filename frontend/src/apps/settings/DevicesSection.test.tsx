import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { DevicesSection } from "@/apps/settings/DevicesSection";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { DeviceInfo, SessionInfo } from "@/lib/api";

afterEach(cleanup);

function device(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    id: "device-abc123",
    kind: "phone",
    name: "Nova's phone",
    area: null,
    lastSeenAt: "2026-09-06T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    capabilities: [],
    ...overrides,
  };
}

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "sess-abc123",
    userAgent: "Safari on iPhone",
    createdAt: "2026-09-05T00:00:00.000Z",
    expiresAt: "2026-10-05T00:00:00.000Z",
    isCurrent: false,
    ...overrides,
  };
}

function renderSection() {
  return renderWithQueryClient(<DevicesSection />);
}

function stubFetch(
  devices: DeviceInfo[],
  sessions: SessionInfo[],
  onAction: (kind: "device" | "session", id: string) => void = () => {},
): () => void {
  let deviceRows = devices;
  let sessionRows = sessions;
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const deviceDelete = url.match(/\/api\/devices\/([^/]+)$/);
    if (deviceDelete && method === "DELETE") {
      onAction("device", deviceDelete[1]!);
      deviceRows = deviceRows.filter((d) => d.id !== deviceDelete[1]);
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    }
    const sessionDelete = url.match(/\/api\/auth\/sessions\/([^/]+)$/);
    if (sessionDelete && method === "DELETE") {
      onAction("session", sessionDelete[1]!);
      sessionRows = sessionRows.filter((s) => s.id !== sessionDelete[1]);
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    }
    if (url.endsWith("/api/devices")) return Promise.resolve(new Response(JSON.stringify(deviceRows), { status: 200 }));
    if (url.endsWith("/api/auth/sessions")) return Promise.resolve(new Response(JSON.stringify(sessionRows), { status: 200 }));
    throw new Error(`unstubbed fetch: ${url} (${method})`);
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

describe("DevicesSection", () => {
  test("empty devices and sessions say so, not a blank page", async () => {
    const restore = stubFetch([], []);
    try {
      const { findByText } = renderSection();
      await findByText("No devices paired to your profile yet.");
      await findByText("No active sessions.");
    } finally {
      restore();
    }
  });

  test("shows a device's kind, name and last-seen time", async () => {
    const restore = stubFetch([device({ kind: "tv", name: "Living room TV" })], []);
    try {
      const { findByText } = renderSection();
      await findByText("Living room TV");
      await findByText("TV");
    } finally {
      restore();
    }
  });

  test("the current session has no sign-out button; another session does", async () => {
    const restore = stubFetch(
      [],
      [session({ id: "sess-current", isCurrent: true, userAgent: "This browser" }), session({ id: "sess-other", userAgent: "Other browser" })],
    );
    try {
      const { findByText, queryByRole, findByRole } = renderSection();
      await findByText("This browser");
      expect(queryByRole("button", { name: /Sign out This browser/ })).toBeNull();
      await findByRole("button", { name: "Sign out Other browser" });
    } finally {
      restore();
    }
  });

  test("removing a device asks first, then calls the real revoke route", async () => {
    const actions: Array<[string, string]> = [];
    const restore = stubFetch([device({ id: "device-1", name: "Old tablet" })], [], (kind, id) => actions.push([kind, id]));
    try {
      const { findByRole, findByText } = renderSection();
      fireEvent.click(await findByRole("button", { name: "Remove Old tablet" }));
      await findByText(/Remove Old tablet\?/);
      fireEvent.click(await findByRole("button", { name: "Yes, remove it" }));
      await waitFor(() => expect(actions).toEqual([["device", "device-1"]]));
    } finally {
      restore();
    }
  });

  test("signing out a session asks first, then calls the real revoke route", async () => {
    const actions: Array<[string, string]> = [];
    const restore = stubFetch([], [session({ id: "sess-1", userAgent: "Old laptop" })], (kind, id) => actions.push([kind, id]));
    try {
      const { findByRole, findByText } = renderSection();
      fireEvent.click(await findByRole("button", { name: "Sign out Old laptop" }));
      await findByText(/Sign out Old laptop\?/);
      fireEvent.click(await findByRole("button", { name: "Yes, sign it out" }));
      await waitFor(() => expect(actions).toEqual([["session", "sess-1"]]));
    } finally {
      restore();
    }
  });

  test("a robot shows its live state on a card, not a plain row", async () => {
    const restore = stubFetch(
      [
        device({
          id: "robot-1",
          kind: "robot",
          name: "Riff",
          state: {
            activity: "listening",
            muted: true,
            tracking: false,
            on_battery: null,
            battery_level: null,
            daemon_version: "1.4.2",
            app_version: "0.1.0",
            reachable: true,
            unreachableSince: null,
          },
        }),
      ],
      [],
    );
    try {
      const { findByTestId, findByText } = renderSection();
      const card = await findByTestId("robot-card");
      await findByText("Listening");
      expect(card.textContent).toContain("Muted");
      expect(card.textContent).toContain("Level unknown");
      expect(card.textContent).toContain("MaiPai version");
      expect(card.textContent).toContain("0.1.0");
      expect(card.textContent).toContain("Body software");
      expect(card.textContent).toContain("1.4.2");
      expect(card.textContent).not.toContain("Software version");
    } finally {
      restore();
    }
  });

  test("a robot that stopped reporting says not responding and since when", async () => {
    const restore = stubFetch(
      [
        device({
          kind: "robot",
          name: "Riff",
          state: {
            activity: "idle",
            muted: false,
            tracking: true,
            battery_level: 0.5,
            daemon_version: null,
            reachable: false,
            unreachableSince: "2026-09-29T10:00:00.000Z",
          },
        }),
      ],
      [],
    );
    try {
      const { findByText, findByTestId } = renderSection();
      await findByText("Not responding");
      const card = await findByTestId("robot-card");
      expect(card.textContent).toContain("Last heard from");
      expect(card.textContent).toContain("MaiPai versionUnknown");
      expect(card.textContent).toContain("Body softwareUnknown");
      expect(card.textContent).toContain("50%");
    } finally {
      restore();
    }
  });

  test("a robot with no report yet says it is waiting", async () => {
    const restore = stubFetch([device({ kind: "robot", name: "Riff", state: null })], []);
    try {
      const { findByText } = renderSection();
      await findByText("Waiting for first report");
    } finally {
      restore();
    }
  });

  test("removing a robot from its card asks first, then calls the revoke route", async () => {
    const actions: Array<[string, string]> = [];
    const restore = stubFetch([device({ id: "robot-1", kind: "robot", name: "Riff", state: null })], [], (kind, id) => actions.push([kind, id]));
    try {
      const { findByRole } = renderSection();
      fireEvent.click(await findByRole("button", { name: "Remove Riff" }));
      fireEvent.click(await findByRole("button", { name: "Yes, remove it" }));
      await waitFor(() => expect(actions).toEqual([["device", "robot-1"]]));
    } finally {
      restore();
    }
  });
});
