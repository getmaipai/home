import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BrowserAlerts, requestBrowserAlertPermission, shouldShowBrowserAlert } from "@/shell/BrowserAlerts";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";
import type { NotificationDeliveryView, Roster } from "@/lib/api";

afterEach(cleanup);

const person = { id: "person-1", display_name: "Nova", role: "adult" } as Roster;
function notification(id: string, typeId: string): NotificationDeliveryView {
  return { id, typeId, level: typeId === "engines.problem" ? "time_sensitive" : typeId === "safety.flagged_turn" ? "immediate" : "passive", text: "Engine issue", channels: ["in_app"], createdAt: "2026-09-30T00:00:00Z", readAt: null, dismissedAt: null, subjectTurnId: null, memoryIds: null, toast: true };
}

describe("browser alerts", () => {
  test("does not ask on load; asks only when explicitly enabled", async () => {
    const ask = mock(async () => "granted" as NotificationPermission);
    expect(await requestBrowserAlertPermission(ask, false)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    expect(await requestBrowserAlertPermission(ask, true)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await requestBrowserAlertPermission(async () => "denied", true)).toBe(false);
  });

  test("off, denied permission and lower levels never show", () => {
    expect(shouldShowBrowserAlert(notification("1", "engines.problem"), false, "granted")).toBe(false);
    expect(shouldShowBrowserAlert(notification("1", "engines.problem"), true, "denied")).toBe(false);
    expect(shouldShowBrowserAlert(notification("1", "repairs.new"), true, "granted")).toBe(false);
    expect(shouldShowBrowserAlert(notification("1", "engines.problem"), true, "granted")).toBe(true);
  });

  test("shows eligible notifications once per id through service worker registration", async () => {
    let resolveValues!: (value: never[]) => void;
    const values = new Promise<never[]>((resolve) => { resolveValues = resolve; });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/settings?scope=")) return values.then((body) => Response.json(body));
      if (url.includes("/api/notifications")) return Promise.resolve(Response.json([]));
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    const showNotification = mock(async (_title: string, _options: NotificationOptions) => undefined);
    const originalNotification = globalThis.Notification;
    Object.defineProperty(globalThis, "Notification", { configurable: true, value: { permission: "granted" } });
    const originalServiceWorker = navigator.serviceWorker;
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve({ showNotification }) } });
    try {
      const { queryClient } = renderWithQueryClient(<MemoryRouter><BrowserAlerts person={person} /></MemoryRouter>);
      resolveValues([{ key: "notifications.browser.enabled", value: true }] as never[]);
      await waitFor(() => expect(queryClient.getQueryData(["notifications"])).toBeDefined());
      const item = notification("same-id", "engines.problem");
      queryClient.setQueryData(["notifications"], [item]);
      await waitFor(() => expect(showNotification).toHaveBeenCalledTimes(1));
      queryClient.setQueryData(["notifications"], [item]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(showNotification).toHaveBeenCalledTimes(1);
      expect(showNotification.mock.calls[0]?.[1]).toMatchObject({ tag: "same-id", data: { url: "/status" } });
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis, "Notification", { configurable: true, value: originalNotification });
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: originalServiceWorker });
    }
  });
});
