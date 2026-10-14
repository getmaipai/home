import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SetupWizard } from "@/apps/setup/SetupWizard";
import type { SetupState } from "@maipai/spec/gen/ts/setup-state.js";

afterEach(cleanup);
beforeEach(() => { sessionStorage.clear(); });

const IDS = ["welcome", "engine_location", "storage", "checks", "plan", "away", "owner", "face", "profile", "hello", "done"] as const;
function freshState(): SetupState {
  const now = new Date().toISOString();
  return { id: "setup-test", source: "wizard", steps: IDS.map((id) => ({ id, status: "pending", at: now })), phase: "computers", engine: { where: "this_computer", hardware: {} }, away: "later", plan: { option: "recommended", tier: "minimal", roles: [] }, checks: [], started_at: now, completed_at: null, hlc: "1790000000000:0:abcdef" };
}

function harness(initial = freshState()) {
  const original = globalThis.fetch;
  let state: SetupState | { done: true } = structuredClone(initial);
  const posts: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/setup/state")) return new Response(JSON.stringify(state), { status: 200 });
    if (url.includes("/api/setup/ca")) return new Response(JSON.stringify({ certificate: "public" }), { status: 200 });
    if (url.includes("/api/backups/emergency-kit")) return new Response(JSON.stringify({ hubName: "Home", hubInstanceId: "hub-1", backupKeyHex: "aabb", generatedAt: new Date().toISOString() }), { status: 200 });
    if (url.includes("/api/auth/setup")) return new Response(JSON.stringify({ person: { id: "owner-1" } }), { status: 201 });
    const match = url.match(/\/api\/setup\/([^/?]+)$/);
    if (match && init?.method === "POST" && !("done" in state)) {
      const id = decodeURIComponent(match[1]!);
      posts.push(id);
      const body = JSON.parse(String(init.body)) as { status: SetupState["steps"][number]["status"] };
      state.steps = state.steps.map((step) => step.id === id ? { ...step, status: body.status, at: new Date().toISOString() } : step);
      if (id === "done" && body.status === "done") state = { done: true };
      return new Response(JSON.stringify(state), { status: 200 });
    }
    throw new Error(`Unstubbed request ${url}`);
  }) as unknown as typeof fetch;
  return { posts, restore: () => { globalThis.fetch = original; } };
}

function view(onDone = () => {}) {
  return render(<MemoryRouter initialEntries={["/setup"]}><Routes><Route path="/setup" element={<SetupWizard onDone={onDone} />} /><Route path="/sign-in" element={<p>Sign in</p>} /></Routes></MemoryRouter>);
}

async function advanceTo(viewResult: ReturnType<typeof view>, buttonText: string, expected: string) {
  await act(async () => { fireEvent.click(viewResult.getByRole("button", { name: buttonText })); });
  await waitFor(() => expect(viewResult.container.textContent).toContain(expected));
}

describe("SetupWizard", () => {
  test("Checks screen uses persisted rows, continues on amber and holds on red", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const original = globalThis.fetch;
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/setup/state")) return new Response(JSON.stringify(state), { status: 200 });
      if (url.includes("/api/setup/checks/run")) return new Response(JSON.stringify({ rows: [{ id: "engine", title: "Engine service", state: "amber", text: "The engine is slow." }, { id: "system", title: "System", state: "red", text: "Unsupported system." }], state }), { status: 200 });
      throw new Error(`Unstubbed request ${url}`);
    }) as unknown as typeof fetch;
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("The engine is slow."));
      expect(rendered.getAllByRole("alert").some((alert) => alert.textContent?.includes("Unsupported system."))).toBe(true);
      expect(rendered.getByRole("button", { name: "Try again" }).textContent).toContain("Try again");
      expect(rendered.getByRole("button", { name: "Try again" }).hasAttribute("disabled")).toBe(true);
    } finally { globalThis.fetch = original; }
  });

  test("resumes at the first pending step from server state and ignores browser storage", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    sessionStorage.setItem("maipai:setup-wizard-step", "0");
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Here's the plan for your Home"));
      expect(rendered.container.textContent).not.toContain("What should we call your household");
    } finally { h.restore(); }
  });

  test("a refresh mid-wizard resumes from the server and each visited screen records its step", async () => {
    const h = harness();
    try {
      let rendered = view();
      await waitFor(() => expect(rendered.getByRole("button", { name: "Set up my Home" })).toBeTruthy());
      await advanceTo(rendered, "Set up my Home", "Where should Home's AI run?");
      expect(h.posts).toEqual(["welcome"]);
      rendered.unmount();
      rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Where should Home's AI run?"));
      await advanceTo(rendered, "Continue", "Where should Home keep its files?");
      expect(h.posts).toEqual(["welcome", "engine_location"]);
    } finally { h.restore(); }
  });

  test("every visible screen records its step, including deferred work", async () => {
    const h = harness();
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.getByRole("button", { name: "Set up my Home" })).toBeTruthy());
      await advanceTo(rendered, "Set up my Home", "Where should Home's AI run?");
      await advanceTo(rendered, "Continue", "Where should Home keep its files?");
      await advanceTo(rendered, "Continue", "Checking your computers");
      await advanceTo(rendered, "Continue", "Here's the plan for your Home");
      await advanceTo(rendered, "Continue", "Reach Home from anywhere");
      await advanceTo(rendered, "Set up later", "Create your owner account");
      fireEvent.change(rendered.getByLabelText("Your name"), { target: { value: "Sage" } });
      fireEvent.change(rendered.getByLabelText("PIN or password"), { target: { value: "2468" } });
      await advanceTo(rendered, "Continue", "Let Home recognise you");
      await advanceTo(rendered, "Do this later", "Hello");
      await advanceTo(rendered, "Continue", "Your Home is ready");
      expect(h.posts).toEqual(["welcome", "engine_location", "storage", "checks", "plan", "away", "owner", "face", "profile", "hello"]);
      await act(async () => { fireEvent.click(rendered.getByRole("button", { name: "Open my Home" })); });
      expect(h.posts.at(-1)).toBe("done");
      await waitFor(() => expect(rendered.container.textContent).toContain("Sign in"));
    } finally { h.restore(); }
  });

  test("screen 1 copy matches the note, including the home pitch and disclaimer", async () => {
    const h = harness();
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Welcome to MaiPai Home"));
      expect(rendered.container.textContent).toContain("Your own AI, music, videos, podcasts, maps, books, and more, on your own hardware, online or offline - for protection, privacy, and independence.");
      expect(rendered.container.textContent).toContain("Home's answers come from AI models you choose to download. They can be wrong, offensive or harmful, and they are not medical, legal or professional advice. You are responsible for how you use them.");
      const note = await Bun.file("../../home/docs/plans/install-wizard-2026-10-13.md").text();
      expect(note).toContain("Home's answers come from AI models you choose to download. They can be wrong, offensive or harmful, and they are not medical, legal or professional advice. You are responsible for how you use them.");
    } finally { h.restore(); }
  });

  test("screen 11 backup and device copy matches the note", async () => {
    const state = freshState();
    for (const step of state.steps) if (step.id !== "done") step.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Your Home is ready"));
      expect(rendered.container.textContent).toContain("If this computer breaks, this file brings your Home back on a new one. Keep it somewhere other than this computer.");
      expect(rendered.container.textContent).toContain("Add a phone or tablet");
      expect(rendered.container.textContent).toContain("Install Tailscale on it, sign in with the same account, and scan this.");
    } finally { h.restore(); }
  });

  test("after completion the setup route redirects to sign-in", async () => {
    const state = freshState();
    for (const step of state.steps) if (step.id !== "done") step.status = "done";
    const h = harness(state);
    const onDone = mock(() => {});
    try {
      const rendered = view(onDone);
      await waitFor(() => expect(rendered.getByRole("button", { name: "Open my Home" })).toBeTruthy());
      await act(async () => { fireEvent.click(rendered.getByRole("button", { name: "Open my Home" })); });
      expect(onDone).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(rendered.container.textContent).toContain("Sign in"));
    } finally { h.restore(); }
  });
});
