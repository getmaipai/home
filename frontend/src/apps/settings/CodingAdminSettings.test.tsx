import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import settingsFile from "@maipai/spec/settings/keys.json";
import { CodingAdminSettings } from "@/apps/settings/CodingSettings";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

describe("Coding admin settings", () => {
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
      if (url.endsWith("/api/coding-setup/pieces") && init?.method !== "DELETE") return Promise.resolve(Response.json(pieces));
      if (url.endsWith("/api/coding-setup/pieces/engine") && init?.method === "DELETE") return Promise.resolve(Response.json({ error: "Turn Coding off before removing a piece." }, { status: 409 }));
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
});
