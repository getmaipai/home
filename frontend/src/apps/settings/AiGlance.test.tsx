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

describe("AiGlance first paint", () => {
  test("the page draws the last answer at once while the engine's reply is still on its way", async () => {
    localStorage.setItem("maipai.ai-choices.v1", JSON.stringify(overview));
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
      if (path.endsWith("/api/ai/tier-window")) return Promise.resolve(Response.json({ open: false, minutes_left: null, line: null, profile: null, closed_apps: [] }));
      if (path.endsWith("/api/host/hardware")) return Promise.resolve(Response.json({ platform: "darwin", totalRamGb: 24, cpuCount: 8, isAppleSilicon: true, unifiedMemoryGb: 24, cudaDevices: [] }));
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    const view = renderWithQueryClient(<MemoryRouter><AiGlance {...({ card: { copy: {} } } as unknown as Parameters<typeof AiGlance>[0])} /></MemoryRouter>);
    expect(view.getByTestId("ai-glance")).toBeTruthy();
    localStorage.removeItem("maipai.ai-choices.v1");
  });
});

describe("AiGlance Apply", () => {
  test("a staged switch shows the sticky bar and Apply posts the choice", async () => {
    const posts: string[] = [];
    let release = () => {};
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
      if (init?.method === "POST") { posts.push(`${path} ${init.body}`); return new Promise((resolve) => { release = () => resolve(Response.json({ ok: true, started: [] })); }); }
      if (path.endsWith("/api/ai/choices")) return Promise.resolve(Response.json(overview));
      if (path.endsWith("/api/ai/tier-window")) return Promise.resolve(Response.json({ open: false, minutes_left: null, line: null, profile: null, closed_apps: [] }));
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

  test("a row whose model is downloading shows the progress, and a failed one says so", async () => {
    const serve = (choice: object) => {
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
        if (path.endsWith("/api/ai/choices")) return Promise.resolve(Response.json({ ...overview, cards: [{ ...overview.cards[0]!, choices: [choice] }] }));
        if (path.endsWith("/api/ai/tier-window")) return Promise.resolve(Response.json({ open: false, minutes_left: null, line: null, profile: null, closed_apps: [] }));
        if (path.endsWith("/api/host/hardware")) return Promise.resolve(Response.json({ platform: "darwin", totalRamGb: 24, cpuCount: 8, isAppleSilicon: true, unifiedMemoryGb: 24, cudaDevices: [] }));
        if (path.includes("/api/settings")) return Promise.resolve(Response.json([]));
        return Promise.resolve(Response.json({}));
      }) as typeof fetch;
    };
    const card = { card: { copy: {} } } as unknown as Parameters<typeof AiGlance>[0];
    serve({ ...wakeChoice, state: "installing", percent: 40 });
    const downloading = renderWithQueryClient(<MemoryRouter><AiGlance {...card} /></MemoryRouter>);
    const bar = await downloading.findByRole("progressbar", { name: "Hey Jarvis progress" });
    expect(bar).toBeTruthy();
    cleanup();
    serve({ ...wakeChoice, current: true, state: "failed", failure: "The download stopped. Try again." });
    const failed = renderWithQueryClient(<MemoryRouter><AiGlance {...card} /></MemoryRouter>);
    expect(await failed.findByText("The download stopped. Try again.")).toBeTruthy();
  });

  test("the chat row carries an Uncensored badge only while the uncensored model is the one in use", async () => {
    const base = { ...wakeChoice, job: "chat", kind: "radio", recommended: false, state: "installed", action: "none", stateText: "Installed" };
    const standard = { ...base, id: "chat.standard", kind: "fixed", label: "Standard chat AI", name: "Standard chat AI", recommended: true, current: true };
    const uncensored = { ...base, id: "chat.uncensored", label: "Uncensored chat AI", name: "Uncensored chat AI", current: false };
    const serve = (choices: object[]) => {
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
        if (path.endsWith("/api/ai/choices")) return Promise.resolve(Response.json({ ...overview, cards: [{ id: "chat", title: "Chat", summary: "", chip: "", choices, notReady: false, unavailable: null }] }));
        if (path.endsWith("/api/ai/tier-window")) return Promise.resolve(Response.json({ open: false, minutes_left: null, line: null, profile: null, closed_apps: [] }));
        if (path.endsWith("/api/host/hardware")) return Promise.resolve(Response.json({ platform: "darwin", totalRamGb: 24, cpuCount: 8, isAppleSilicon: true, unifiedMemoryGb: 24, cudaDevices: [] }));
        if (path.includes("/api/settings")) return Promise.resolve(Response.json([]));
        return Promise.resolve(Response.json({}));
      }) as typeof fetch;
    };
    const card = { card: { copy: {} } } as unknown as Parameters<typeof AiGlance>[0];
    serve([standard, uncensored]);
    const before = renderWithQueryClient(<MemoryRouter><AiGlance {...card} /></MemoryRouter>);
    await before.findByTestId("ai-row-chat");
    expect(before.queryByText("Uncensored")).toBeNull();
    cleanup();
    serve([{ ...standard, current: false }, { ...uncensored, current: true }]);
    const after = renderWithQueryClient(<MemoryRouter><AiGlance {...card} /></MemoryRouter>);
    expect(await after.findByText("Uncensored")).toBeTruthy();
  });
});
