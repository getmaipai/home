import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { InstallDock, buildDock } from "./InstallDock";
import type { HomeJobView, InstallStatusView } from "@/lib/api";

afterEach(cleanup);

const item = (over: Partial<InstallStatusView["items"][number]> = {}) => ({ id: "j1", model: "muse-glimmer-30b-mlx-4bit", role: "chat", label: "muse-glimmer-30b-mlx-4bit", state: "running", completedBytes: 972_700_000, totalBytes: 19_443_246_692, reason: null, ...over });
const status = (over: Partial<InstallStatusView> = {}): InstallStatusView => ({
  state: "starter_ready", chatReady: true, complete: false, percent: 5, completedBytes: 972_700_000, totalBytes: 19_443_246_692,
  bytesPerSecond: 44_800_000, etaSeconds: 420, problem: null, items: [item()], ...over,
});
const job: HomeJobView = { id: "stack:j1", kind: "model_download", state: "running", title: "muse-glimmer-30b-mlx-4bit", actions: ["stop"], progress: { completedBytes: 972_700_000, totalBytes: 19_443_246_692, bytesPerSecond: 44_800_000, items: [{ id: "a.safetensors", label: "a.safetensors", completedBytes: 1, totalBytes: 2, state: "running" }] } };
const show = (admin: boolean, s: InstallStatusView, extra: Partial<Parameters<typeof InstallDock>[0]> = {}) =>
  render(<MemoryRouter><InstallDock admin={admin} read={async () => s} readJobs={async () => [job]} {...extra} /></MemoryRouter>);

describe("InstallDock", () => {
  test("says what is installing and why, in plain words, with the percent and time left", async () => {
    const view = show(false, status());
    await view.findByText((text) => text.replace(/\u00a0/g, " ") === "Installing a faster chat engine for Muse Glimmer (19.4 GB)");
    expect(view.container.textContent).not.toContain("muse-glimmer-30b-mlx-4bit");
    view.getByText("5%");
    view.getByText("about 7 min left · 44.8 MB/s");
  });

  test("is centred in the content area by its own structure: fixed, full-width flex row, justify-center, max 28rem", async () => {
    const view = show(true, status());
    const dock = await view.findByTestId("install-dock");
    expect(dock.className).toContain("fixed");
    expect(dock.className).toContain("justify-center");
    expect(dock.className).toContain("bottom-0");
    expect(dock.className).toContain("safe-area-inset-bottom");
    expect(view.getByTestId("install-dock-card").className).toMatch(/max-w-md/);
    expect(view.getByTestId("install-dock-card").className).toContain("w-full");
  });

  test("centres on the chat column when the page has one, else on the content beside the rail", async () => {
    const workspace = document.createElement("main");
    workspace.setAttribute("data-slot", "rail-workspace");
    workspace.getBoundingClientRect = () => ({ left: 64, right: 1000, top: 0, bottom: 0, width: 936, height: 0, x: 64, y: 0, toJSON() {} });
    document.body.append(workspace);
    const chat = document.createElement("div");
    chat.setAttribute("data-slot", "chat-pane");
    chat.getBoundingClientRect = () => ({ left: 345, right: 1000, top: 0, bottom: 0, width: 655, height: 0, x: 345, y: 0, toJSON() {} });
    document.body.append(chat);
    Object.defineProperty(document.documentElement, "clientWidth", { value: 1100, configurable: true });
    try {
      const view = show(false, status());
      const dock = await view.findByTestId("install-dock");
      await waitFor(() => expect(dock.style.left).toBe("345px"));
      expect(dock.style.right).toBe("100px");
      chat.remove();
      await waitFor(() => expect(dock.style.left).toBe("64px"));
      Object.defineProperty(document.documentElement, "clientWidth", { value: 390, configurable: true });
      await waitFor(() => expect(dock.style.left).toBe("0px"));
      expect(dock.style.right).toBe("0px");
    } finally { workspace.remove(); chat.remove(); }
  });

  test("an admin opens it like an accordion; a non-admin gets no control", async () => {
    const admin = show(true, status());
    const toggle = await admin.findByTestId("install-dock-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const details = await admin.findByTestId("install-dock-details");
    expect(details.textContent).toContain("Installing a faster chat engine for Muse Glimmer");
    expect(details.textContent).toContain("Muse Glimmer answers faster");
    expect(admin.getByRole("button", { name: /cancel/i })).toBeTruthy();
    cleanup();
    const plain = show(false, status());
    await plain.findByTestId("install-dock");
    expect(plain.queryByTestId("install-dock-toggle")).toBeNull();
    expect(plain.container.querySelector("[aria-expanded]")).toBeNull();
    expect(plain.queryByTestId("install-dock-details")).toBeNull();
  });

  test("several installs show the first with +N more and one weighted percent", () => {
    const model = buildDock(status({ items: [item({ id: "a", completedBytes: 0, totalBytes: 1_000_000_000 }), item({ id: "b", model: "flux2-klein", role: "image", completedBytes: 500_000_000, totalBytes: 1_000_000_000, state: "queued" }), item({ id: "c", model: "ddgs", completedBytes: 500_000_000, totalBytes: 1_000_000_000, state: "queued" })] }));
    expect(model.active).toHaveLength(3);
    expect(model.percent).toBe(33);
    expect(model.primary?.key).toBe("a");
  });

  test("shows +2 more beside the primary install", async () => {
    const many = status({ items: [item({ id: "a" }), item({ id: "b", model: "flux2-klein", state: "queued", completedBytes: 0 }), item({ id: "c", model: "ddgs", state: "queued", completedBytes: 0, totalBytes: 10 })] });
    const view = show(false, many);
    await view.findByText("+2 more");
  });

  test("a failure says what did not finish; admins get Try again and a Repairs link, others are told who can fix it", async () => {
    const failedStatus = status({ state: "failed", items: [item({ state: "failed", reason: "The disk is full." })], problem: "A download did not finish." });
    const calls: string[] = [];
    const admin = show(true, failedStatus, { retry: async () => { calls.push("retry"); } });
    const toggle = await admin.findByTestId("install-dock-toggle");
    fireEvent.click(toggle);
    fireEvent.click(await admin.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls).toEqual(["retry"]));
    expect(admin.getByRole("link", { name: "Repairs" }).getAttribute("href")).toBe("/repairs");
    cleanup();
    const plain = show(false, failedStatus);
    await plain.findByText("Part of your AI did not finish installing");
    expect(plain.queryByRole("button")).toBeNull();
  });

  test("announces the start once and the finish once, not each percent", async () => {
    let current = status();
    let polls = 0;
    const read = async () => { polls += 1; return current; };
    const view = render(<MemoryRouter><InstallDock admin={false} read={read} readJobs={async () => []} /></MemoryRouter>);
    const announcer = view.getByTestId("install-announcer");
    expect(announcer.getAttribute("role")).toBe("status");
    await waitFor(() => expect(announcer.textContent).toContain("has started"));
    expect(view.getByTestId("install-dock").getAttribute("aria-live")).toBeNull();
    expect(polls).toBeGreaterThan(0);
    current = status({ state: "ready", items: [item({ state: "done" })] });
  });

  test("a payload that is not an install status draws nothing and does not crash", async () => {
    const view = render(<MemoryRouter><InstallDock admin read={async () => ({}) as InstallStatusView} readJobs={async () => ({}) as unknown as HomeJobView[]} /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 20));
    expect(view.queryByTestId("install-dock")).toBeNull();
  });

  test("renders nothing visible when nothing is installing", async () => {
    const view = show(true, status({ state: "ready", items: [item({ state: "done" })] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(view.queryByTestId("install-dock")).toBeNull();
  });
});
