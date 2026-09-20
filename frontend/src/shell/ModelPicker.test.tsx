import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ModelPicker } from "./ModelPicker";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

const person = (role: Roster["role"] = "owner"): Roster => ({
  id: "person-abc123",
  display_name: "Nova",
  nickname: null,
  role,
  avatar_seed: "person-abc123",
  source: "hub",
  local_only: false,
  created_at: "2026-09-04T00:00:00.000Z",
  updated_at: "2026-09-04T00:00:00.000Z",
  deleted_at: null,
  enabled: true,
  guest_expires_at: null,
  memorialized_at: null,
  hlc: "1788000000000:0:test",
  hasSecret: true,
});

function stubFetch(showDetails: boolean, extra?: (url: string, init?: RequestInit) => Response | null): typeof fetch {
  return mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (extra) {
      const custom = extra(url, init);
      if (custom) return custom;
    }
    if (url.startsWith("/api/settings?")) return Response.json(showDetails ? [{ scope: "person:person-abc123", key: "ui.show_turn_stats", value: true }] : []);
    if (url === "/api/host/chat-models") return Response.json({
      models: [
        { id: "qwen3-8b-instruct-q4-k-m", label: "Qwen3 8B Instruct" },
        { id: "small-chat", label: "Small chat" },
      ],
      selectedModel: { id: "qwen3-8b-instruct-q4-k-m", label: "Qwen3 8B Instruct", available: true },
      canSelect: true,
    });
    throw new Error(`unstubbed ${url}`);
  }) as unknown as typeof fetch;
}

describe("ModelPicker", () => {
  test("renders nothing off the chat page, even for an owner with Developer disclosure on", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = stubFetch(true);
    try {
      const { container } = render(<MemoryRouter initialEntries={["/"]}><ModelPicker person={person()} /></MemoryRouter>);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(container).toBeEmptyDOMElement();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("renders nothing for a child, even on the chat page", async () => {
    const fetchSpy = mock(() => Promise.reject(new Error("should not fetch")));
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { container } = render(<MemoryRouter initialEntries={["/chat"]}><ModelPicker person={person("child")} /></MemoryRouter>);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(container).toBeEmptyDOMElement();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("renders nothing for an owner on the chat page without Developer disclosure on", async () => {
    const original = globalThis.fetch;
    const fetchSpy = stubFetch(false);
    globalThis.fetch = fetchSpy;
    try {
      const { container } = render(<MemoryRouter initialEntries={["/chat"]}><ModelPicker person={person()} /></MemoryRouter>);
      await waitFor(() => expect(fetchSpy).toHaveBeenCalled()); // the disclosure fetch itself is allowed - only the model fetch/render are gated
      expect(container).toBeEmptyDOMElement();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("on the chat page, with Developer disclosure on, shows a reachable model and lets an owner choose another", async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = stubFetch(true, (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/host/models/small-chat/select") return Response.json({ modelId: "small-chat", status: "queued", phase: "queued", completedBytes: 0, totalBytes: 0, error: null, postLoadCheck: null });
      return null;
    });
    try {
      const view = render(<MemoryRouter initialEntries={["/chat"]}><ModelPicker person={person()} /></MemoryRouter>);
      const trigger = await view.findByRole("button", { name: "Chat model: Qwen3 8B Instruct" });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
      fireEvent.click(trigger);
      const item = await view.findByText("Small chat");
      fireEvent.click(item);
      await waitFor(() => expect(calls).toContain("POST /api/host/models/small-chat/select"));
    } finally {
      globalThis.fetch = original;
    }
  });

  test("shows the repair action when the current model is unavailable", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = stubFetch(true, (url) => {
      if (url === "/api/host/chat-models") return Response.json({ models: [], selectedModel: { id: "qwen3-8b-instruct-q4-k-m", label: "Qwen3 8B Instruct", available: false }, canSelect: true });
      return null;
    });
    try {
      const view = render(<MemoryRouter initialEntries={["/chat"]}><ModelPicker person={person()} /></MemoryRouter>);
      const trigger = await view.findByRole("button", { name: "Chat model: Qwen3 8B Instruct" });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
      fireEvent.click(trigger);
      await view.findByText("Open AI models");
    } finally {
      globalThis.fetch = original;
    }
  });
});
