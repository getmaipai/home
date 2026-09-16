import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ChatModelPicker } from "./ChatModelPicker";
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

const health = { brain: "llama-server", voice: "none" };

describe("ChatModelPicker", () => {
  test("shows a reachable model and lets an owner choose it", async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/host/chat-models") return Response.json({
        models: [
          { id: "qwen3-8b-instruct-q4-k-m", label: "Qwen3 8B Instruct" },
          { id: "small-chat", label: "Small chat" },
        ],
        selectedModel: { id: "qwen3-8b-instruct-q4-k-m", label: "Qwen3 8B Instruct", available: true },
        canSelect: true,
      });
      if (url === "/api/host/models/small-chat/select") return Response.json({ modelId: "small-chat", status: "queued", phase: "queued", completedBytes: 0, totalBytes: 0, error: null, postLoadCheck: null });
      throw new Error(`unstubbed ${url}`);
    }) as unknown as typeof fetch;
    try {
      const view = render(<MemoryRouter><ChatModelPicker person={person()} health={health} /></MemoryRouter>);
      const trigger = await view.findByRole("button", { name: "Choose chat model (current: Qwen3 8B Instruct)" });
      fireEvent.click(trigger);
      expect(view.getByText("Small chat")).toBeTruthy();
      fireEvent.click(view.getByRole("button", { name: "Use this" }));
      await waitFor(() => expect(calls).toContain("POST /api/host/models/small-chat/select"));
    } finally {
      globalThis.fetch = original;
    }
  });

  test("shows one repair action when the current model is unavailable", async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/host/chat-models") return Response.json({ models: [], selectedModel: { id: "qwen3-8b-instruct-q4-k-m", label: "Qwen3 8B Instruct", available: false }, canSelect: true });
      if (url === "/api/host/models/qwen3-8b-instruct-q4-k-m/select") return Response.json({ modelId: "qwen3-8b-instruct-q4-k-m", status: "queued", phase: "queued", completedBytes: 0, totalBytes: 0, error: null, postLoadCheck: null });
      throw new Error(`unstubbed ${url}`);
    }) as unknown as typeof fetch;
    try {
      const view = render(<MemoryRouter><ChatModelPicker person={person()} health={health} /></MemoryRouter>);
      await view.findByRole("button", { name: "Choose chat model (current: Qwen3 8B Instruct)" });
      fireEvent.click(view.getByRole("button", { name: "Choose chat model (current: Qwen3 8B Instruct)" }));
      const repair = view.getByRole("link", { name: "Open AI models" });
      expect(repair).toHaveAttribute("href", "/settings/models");
      expect(view.queryAllByRole("link", { name: "Open AI models" })).toHaveLength(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("keeps model names and controls out of a child view", () => {
    const fetchSpy = mock(() => Promise.reject(new Error("should not fetch")));
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const view = render(<ChatModelPicker person={person("child")} health={health} />);
      expect(view.getByLabelText("Current chat model").textContent).toBe("MaiPai");
      expect(view.queryByText(/Qwen|model/i)).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
