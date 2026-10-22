import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import settingsFile from "@maipai/spec/settings/keys.json";
import { CodingAdminSettings } from "@/apps/settings/CodingSettings";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

const readiness = (overrides: Partial<{ ready: boolean; first_unmet: string; items: unknown[] }> = {}) => ({
  ready: true, first_unmet: null,
  checked_at: "2026-10-22T12:00:00.000Z",
  items: ["coding_enabled", "engine", "pieces", "hardware", "memory", "self_test", "client", "bench"].map((id) => ({ id, state: "done", reason_key: id, doc_anchor: id })),
  provenance: "test", hlc: "1:0:node123",
  ...overrides,
});

describe("Coding admin settings", () => {
  test("shows install and remove pending states before requests finish and reports progress", async () => {
    const original = globalThis.fetch;
    const registry = settingsFile.filter((setting) => setting.key.startsWith("coding."));
    const values = registry.map((setting) => ({ key: setting.key, value: setting.default, source: "default", label: setting.label, level: setting.level, secret: false }));
    let finish: ((response: Response) => void) | undefined;
    let finishRemove: ((response: Response) => void) | undefined;
    let current = "notInstalled";
    const makePieces = () => ({ stack: "ok", message: null, coding_enabled: false, engine: "splash", missing: null, pieces: [{ id: "model", name: "model", label: "Coding model", summary: "Runs coding requests.", state: current, size_bytes: 1024 ** 3, percent: current === "installing" ? 37 : null, failure: null, can_install: current !== "installed", install_block: null, can_remove: current === "installed", remove_block: null }] });
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/settings/registry")) return Promise.resolve(Response.json(registry));
      if (url.includes("/api/settings?scope=household")) return Promise.resolve(Response.json(values));
      if (url.endsWith("/api/people")) return Promise.resolve(Response.json([]));
      if (url.endsWith("/api/grants")) return Promise.resolve(Response.json([]));
      if (url.endsWith("/api/coding/mode")) return Promise.resolve(Response.json({ readiness: readiness(), mode: "normal", state: "ready", reason: null }));
      if (url.endsWith("/api/coding/pieces") && init?.method !== "POST" && init?.method !== "DELETE") return Promise.resolve(Response.json(makePieces()));
      if (url.endsWith("/api/coding/pieces/model/install") && init?.method === "POST") return new Promise<Response>((resolve) => { finish = resolve; });
      if (url.endsWith("/api/coding/pieces/model") && init?.method === "DELETE") return new Promise<Response>((resolve) => { finishRemove = resolve; });
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><CodingAdminSettings /></MemoryRouter>);
      fireEvent.click(await view.findByRole("button", { name: "Install" }));
      await waitFor(() => expect(view.getByRole("button", { name: "Installing" })).toBeDisabled());
      finish?.(Response.json({ error: "Download failed." }, { status: 500 }));
      expect(await view.findByRole("alert")).toHaveTextContent("Download failed.");
      expect(await view.findByRole("button", { name: "Install" })).toBeEnabled();
      current = "installing";
      await view.queryClient.invalidateQueries({ queryKey: ["coding-pieces"] });
      expect((await view.findAllByText(/37%/)).length).toBeGreaterThanOrEqual(1);
      current = "installed";
      await view.queryClient.invalidateQueries({ queryKey: ["coding-pieces"] });
      await waitFor(() => expect(view.getByRole("button", { name: "Remove" })).toBeEnabled());
      fireEvent.click(await view.findByRole("button", { name: "Remove" }));
      const removeButtons = view.getAllByRole("button", { name: "Remove" });
      fireEvent.click(removeButtons[removeButtons.length - 1]!);
      expect(await view.findByRole("button", { name: "Removing" })).toBeDisabled();
      finishRemove?.(Response.json({ piece: "model", removed: true }));
    } finally { globalThis.fetch = original; }
  }, 20000);

  test("shows the backend's refusal sentence when removal is refused", async () => {
    const original = globalThis.fetch;
    const registry = settingsFile.filter((setting) => setting.key.startsWith("coding."));
    const values = registry.map((setting) => ({ key: setting.key, value: setting.default, source: "default", label: setting.label, level: setting.level, secret: false }));
    const pieces = { stack: "ok", message: null, coding_enabled: false, engine: "splash", missing: null, pieces: [{ id: "engine", name: "splash", label: "Coding engine", summary: "Runs the model.", state: "installed", size_bytes: 1024 ** 3, percent: null, failure: null, can_install: false, install_block: null, can_remove: true, remove_block: null }] };
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/settings/registry")) return Promise.resolve(Response.json(registry));
      if (url.includes("/api/settings?scope=household")) return Promise.resolve(Response.json(values));
      if (url.endsWith("/api/people")) return Promise.resolve(Response.json([]));
      if (url.endsWith("/api/grants")) return Promise.resolve(Response.json([]));
      if (url.endsWith("/api/coding/mode")) return Promise.resolve(Response.json({ readiness: readiness(), mode: "normal", state: "ready", reason: null }));
      if (url.endsWith("/api/coding/pieces") && init?.method !== "DELETE") return Promise.resolve(Response.json(pieces));
      if (url.endsWith("/api/coding/pieces/engine") && init?.method === "DELETE") return Promise.resolve(Response.json({ error: "Turn Coding off before removing a piece." }, { status: 409 }));
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><CodingAdminSettings /></MemoryRouter>);
      fireEvent.click(await view.findByRole("button", { name: "Remove" }));
      const removeButtons = view.getAllByRole("button", { name: "Remove" });
      fireEvent.click(removeButtons[removeButtons.length - 1]!);
      expect(await view.findByRole("alert")).toHaveTextContent("Turn Coding off before removing a piece.");
    } finally { globalThis.fetch = original; }
  });

  test("disables Home mode with the first unmet reason and shows all checklist states and actions", async () => {
    const original = globalThis.fetch;
    const registry = settingsFile.filter((setting) => setting.key.startsWith("coding."));
    const values = registry.map((setting) => ({ key: setting.key, value: setting.default, source: "default", label: setting.label, level: setting.level, secret: false }));
    const items = [
      { id: "coding_enabled", state: "can_do", reason_key: "coding_enabled", doc_anchor: "coding-enabled" },
      { id: "engine", state: "manual", reason_key: "engine", doc_anchor: "engine" },
      { id: "pieces", state: "can_do", reason_key: "pieces", doc_anchor: "pieces" },
      { id: "hardware", state: "manual", reason_key: "hardware", doc_anchor: "hardware" },
      { id: "memory", state: "manual", reason_key: "memory", doc_anchor: "memory" },
      { id: "self_test", state: "can_do", reason_key: "self_test", doc_anchor: "self-test" },
      { id: "client", state: "manual", reason_key: "client", doc_anchor: "client" },
      { id: "bench", state: "done", reason_key: "bench", doc_anchor: "bench" },
    ];
    const settingStatus = 409;
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, method: init?.method });
      if (url.endsWith("/api/settings/registry")) return Promise.resolve(Response.json(registry));
      if (url.includes("/api/settings?scope=household")) return Promise.resolve(Response.json(values));
      if (url.endsWith("/api/people")) return Promise.resolve(Response.json([]));
      if (url.endsWith("/api/grants")) return Promise.resolve(Response.json([]));
      if (url.endsWith("/api/coding/mode")) return Promise.resolve(Response.json({ readiness: readiness({ ready: false, first_unmet: "pieces", items }), mode: "normal", state: "ready", reason: null }));
      if (url.endsWith("/api/coding/pieces")) return Promise.resolve(Response.json({ stack: "ok", message: null, coding_enabled: false, engine: "splash", missing: null, pieces: [{ id: "engine", name: "engine", label: "Engine", summary: "Engine", state: "notInstalled", size_bytes: 5, percent: null, failure: null, can_install: true, install_block: null, can_remove: false, remove_block: null }, { id: "model", name: "model", label: "Model", summary: "Model", state: "notInstalled", size_bytes: 5, percent: null, failure: null, can_install: true, install_block: null, can_remove: false, remove_block: null }] }));
      if (url.endsWith("/api/settings") && init?.method === "PUT") return Promise.resolve(Response.json({ error: "Coding needs setup before you can turn it on." }, { status: settingStatus }));
      if (url.endsWith("/api/coding/pieces/engine/install") || url.endsWith("/api/coding/pieces/model/install")) return Promise.resolve(Response.json({ job: "job", piece: url.includes("/engine/") ? "engine" : "model" }));
      if (url.endsWith("/api/coding/mode/self-test") && init?.method === "POST") return Promise.resolve(Response.json({ accepted: true }, { status: 202 }));
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><CodingAdminSettings /></MemoryRouter>);
      expect((await view.findAllByText("Some model files are missing, so add them and check again.")).length).toBe(2);
      expect(view.getAllByText("Needs a step from you").length).toBe(4);
      expect(view.getAllByText("Needs setup")).toHaveLength(3);
      expect(view.getByText("Ready")).toBeTruthy();
      for (const label of ["Coding is on", "Coding engine", "Coding model files", "Computer hardware", "Free memory", "Coding test", "Coding app", "Speed check"]) expect(view.getByText(label)).toBeTruthy();
      expect(view.getAllByRole("link", { name: "How" }).length).toBe(4);
      const modeRow = view.getByText("Home mode").closest("[data-setting-key]");
      expect(modeRow?.querySelector("button[role=combobox]")).toBeDisabled();
      fireEvent.click(within(view.getByLabelText("Home mode checklist")).getByRole("button", { name: "Install" }));
      await waitFor(() => expect(calls.filter((call) => call.url.includes("/coding/pieces/") && call.method === "POST").length).toBe(2));
      fireEvent.click(view.getByRole("button", { name: "Run the test" }));
      await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/coding/mode/self-test") && call.method === "POST")).toBe(true));
      fireEvent.click(view.getByRole("button", { name: "Turn coding on" }));
      await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent("Coding needs setup before you can turn it on."));
    } finally { globalThis.fetch = original; }
  });

});
