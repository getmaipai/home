import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { NextPrivacyPage } from "@/next/pages/NextPrivacyPage";
import { joinNames, sourceName } from "@/apps/privacy/privacyCopy";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { PrivacyConnection } from "@/lib/api";

afterEach(cleanup);

function connection(overrides: Partial<PrivacyConnection> = {}): PrivacyConnection {
  return {
    id: "weather:open-meteo", source: "Weather", sourceKind: "plugin",
    destination: "Open-Meteo (open-meteo.com), a free public weather API",
    when: "each time the family asks for the weather somewhere",
    what: "the place name spoken in the request", who: "Open-Meteo", optIn: true,
    retention: "unknown, see Open-Meteo's own policy", direction: "outbound", ...overrides,
  };
}

function stubPrivacy(body: { connections: PrivacyConnection[]; offlinePlugins: string[] }) {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/privacy")) return Promise.resolve(Response.json(body));
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

describe("NextPrivacyPage", () => {
  test("answers when, what, who, and retention for every connection", async () => {
    const restore = stubPrivacy({ connections: [connection()], offlinePlugins: [] });
    try {
      const view = renderWithQueryClient(<NextPrivacyPage />);
      await view.findByText("Open-Meteo (open-meteo.com), a free public weather API");
      expect(view.getByText(/each time the family asks for the weather/)).toBeTruthy();
      expect(view.getByText(/the place name spoken in the request/)).toBeTruthy();
      expect(view.getByText("Who gets it:").parentElement?.textContent).toContain("Open-Meteo");
      expect(view.getByText(/unknown, see Open-Meteo's own policy/)).toBeTruthy();
    } finally { restore(); }
  });

  test("shows platform and package connections together", async () => {
    const restore = stubPrivacy({ connections: [
      connection({ id: "platform:language-models", source: "MaiPai Home", sourceKind: "platform", destination: "huggingface.co", who: "huggingface.co" }),
      connection(),
    ], offlinePlugins: [] });
    try {
      const view = renderWithQueryClient(<NextPrivacyPage />);
      const list = await view.findByRole("list", { name: "Outbound connections" });
      expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(2);
      expect(list.textContent).toContain("MaiPai Home itself");
      expect(list.textContent).toContain("Weather");
    } finally { restore(); }
  });

  test("separates inbound from outbound and labels the scope", async () => {
    const restore = stubPrivacy({ connections: [
      connection({ id: "platform:inbound-api", direction: "inbound", source: "MaiPai Home", sourceKind: "platform", destination: "your own network only - nothing leaves the house for this row" }),
      connection(),
    ], offlinePlugins: [] });
    try {
      const view = renderWithQueryClient(<NextPrivacyPage />);
      const inbound = await view.findByRole("list", { name: "Inbound connections" });
      expect(inbound.textContent).toContain("Scope:");
      expect(inbound.textContent).toContain("your own network only - nothing leaves the house for this row");
      expect(inbound.querySelector("h2")?.textContent).toBe("MaiPai Home itself");
      const outbound = await view.findByRole("list", { name: "Outbound connections" });
      expect(outbound.querySelectorAll('[role="listitem"]')).toHaveLength(1);
      expect(outbound.textContent).not.toContain("your own network only");
    } finally { restore(); }
  });

  test("omits inbound section when none exists", async () => {
    const restore = stubPrivacy({ connections: [connection()], offlinePlugins: [] });
    try {
      const view = renderWithQueryClient(<NextPrivacyPage />);
      await view.findByText("What leaves your house (1)");
      expect(view.queryByText("Can someone reach into your house?")).toBeNull();
    } finally { restore(); }
  });

  test("leads with a plain answer and counts outbound rows", async () => {
    const restore = stubPrivacy({ connections: [connection(), connection({ id: "define:dictionaryapi-dev" })], offlinePlugins: [] });
    try {
      const view = renderWithQueryClient(<NextPrivacyPage />);
      expect(await view.findByText("Can someone outside see what we say to MaiPai?")).toBeTruthy();
      expect(view.getByText(/No\. Everything you say to MaiPai, everything it remembers/)).toBeTruthy();
      expect(view.getByText("What leaves your house (2)")).toBeTruthy();
    } finally { restore(); }
  });

  test("names offline packages and omits the offline group when empty", async () => {
    const restore = stubPrivacy({ connections: [connection()], offlinePlugins: ["Remember", "Recall", "Notes"] });
    try {
      const view = renderWithQueryClient(<NextPrivacyPage />);
      expect(await view.findByText(/Remember, Recall, and Notes work entirely on this computer/)).toBeTruthy();
    } finally { restore(); }
    cleanup();
    const restoreEmpty = stubPrivacy({ connections: [connection()], offlinePlugins: [] });
    try {
      const view = renderWithQueryClient(<NextPrivacyPage />);
      await view.findByText("What leaves your house (1)");
      expect(view.queryByText("Never leaves your house")).toBeNull();
    } finally { restoreEmpty(); }
  });

  test("states the zero-phone-home promise and keeps disclosures accurate", async () => {
    const restore = stubPrivacy({ connections: [
      connection({ id: "platform:tts-model", source: "MaiPai Home", sourceKind: "platform", optIn: true }),
      connection({ id: "package:weather", optIn: true }),
    ], offlinePlugins: [] });
    try {
      const view = renderWithQueryClient(<NextPrivacyPage />);
      const list = await view.findByRole("list", { name: "Outbound connections" });
      expect(await view.findByText(/We do not collect usage information, crash reports, or statistics/)).toBeTruthy();
      expect(list.textContent).toContain("MaiPai Home itself");
      expect(within(list).getByText("Weather · only if you turn it on")).toBeTruthy();
      expect(list.textContent).not.toContain("MaiPai Home itself · only if you turn it on");
    } finally { restore(); }
  });

  test("retry refetches privacy and the loading state uses the shared loading branch", async () => {
    const original = globalThis.fetch;
    let privacyCalls = 0;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/privacy")) {
        privacyCalls += 1;
        return Promise.resolve(privacyCalls === 1
          ? new Response(JSON.stringify({ error: "nope" }), { status: 500 })
          : Response.json({ connections: [], offlinePlugins: [] }));
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextPrivacyPage />);
      fireEvent.click(await view.findByRole("button", { name: "Try again" }));
      await view.findByText("What leaves your house (0)");
      expect(privacyCalls).toBe(2);
    } finally { globalThis.fetch = original; }

    globalThis.fetch = mock(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextPrivacyPage />);
      const loading = view.getByRole("status", { name: "Loading the privacy page" });
      const skeletons = loading.querySelectorAll('[data-slot="skeleton"]');
      for (const skeleton of skeletons) {
        expect(skeleton.className).not.toMatch(/\bh-(24|48)\b/);
      }
    } finally { globalThis.fetch = original; }
  });
});

describe("privacy copy helpers", () => {
  test("joins one, two, or three offline package names as a sentence", () => {
    expect(joinNames(["Remember"])).toBe("Remember");
    expect(joinNames(["Remember", "Recall"])).toBe("Remember and Recall");
    expect(joinNames(["Remember", "Recall", "Notes"])).toBe("Remember, Recall, and Notes");
  });

  test("uses the user-facing name for platform rows", () => {
    expect(sourceName(connection({ source: "MaiPai Home", sourceKind: "platform" }))).toBe("MaiPai Home itself");
    expect(sourceName(connection())).toBe("Weather");
  });
});
