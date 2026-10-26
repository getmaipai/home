// The staged banner and Apply live in a sticky bar so they are always on screen, and Apply writes what was staged.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { AiGlance } from "@/apps/settings/AiGlance";

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

const wakeChoice = { id: "wakeword.detector", job: "wakeword", kind: "switch", label: "Hey Jarvis", description: "Hey Jarvis.", name: "Hey Jarvis", rowIds: [], recommended: true, current: false, state: "notInstalled", percent: null, failure: null, downloadBytes: 3_700_000, installedBytes: 3_700_000, ramBytes: 3_700_000, ramBasis: "estimate", stateText: "", blockedReason: null, action: "get", setting: null, chosenNotReady: false, details: [] };
const overview = { stack: "ok", message: null, tier: "p128", free_disk_bytes: 1e12, installed_bytes: 0, cards: [{ id: "wakeword", title: "Wake Word", summary: "", chip: "", choices: [wakeChoice], notReady: false, unavailable: null }], alwaysOn: { bytes: 0, rowIds: [] }, recommended: null, unused_bytes: 0 };

describe("AiGlance Apply", () => {
  test("a staged switch shows the sticky bar and Apply posts the choice", async () => {
    const posts: string[] = [];
    let release = () => {};
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
      if (init?.method === "POST") { posts.push(`${path} ${init.body}`); return new Promise((resolve) => { release = () => resolve(Response.json({ ok: true, started: [] })); }); }
      if (path.endsWith("/api/ai/choices")) return Promise.resolve(Response.json(overview));
      if (path.endsWith("/api/host/hardware")) return Promise.resolve(Response.json({ platform: "darwin", totalRamGb: 24, cpuCount: 8, isAppleSilicon: true, unifiedMemoryGb: 24, cudaDevices: [] }));
      if (path.includes("/api/settings")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    }) as typeof fetch;
    const view = renderWithQueryClient(<MemoryRouter><AiGlance {...({ card: { copy: { eyebrow: "Your AI setup", title: "AI & Models", apply: "Apply changes", discard: "Discard", staged: "{count} changes staged." } } } as unknown as Parameters<typeof AiGlance>[0])} /></MemoryRouter>);
    const toggle = await view.findByRole("switch", { name: /Wake Word/ });
    fireEvent.click(toggle);
    const bar = await view.findByTestId("ai-action-bar");
    expect(bar.querySelector('[data-testid="ai-staged"]')).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(posts.length).toBeGreaterThan(0));
    expect(posts[0]).toContain("/api/ai/choices/wakeword");
    expect(posts[0]).toContain("wakeword.detector");
    expect((await view.findByRole("button", { name: "Applying…" })).hasAttribute("disabled")).toBe(true);
    expect(view.queryByText("Your AI setup")).toBeNull();
    expect(view.queryByRole("heading", { name: "AI & Models" })).toBeNull();
    release();
  });
});
