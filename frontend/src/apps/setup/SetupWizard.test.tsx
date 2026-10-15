import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SetupWizard } from "@/apps/setup/SetupWizard";
import type { SetupState } from "@maipai/spec/gen/ts/setup-state.js";

afterEach(cleanup);
beforeEach(() => { sessionStorage.clear(); });

const IDS = ["welcome", "engine_location", "storage", "checks", "plan", "away", "owner", "face", "profile", "hello", "done"] as const;
function freshState(): SetupState {
  sessionStorage.setItem("maipai:setup-before-start-read", "true");
  const now = new Date().toISOString();
  return { id: "setup-test", source: "wizard", steps: IDS.map((id) => ({ id, status: "pending", at: now })), phase: "computers", engine: { where: "this_computer", hardware: {} }, away: "later", plan: { option: "recommended", tier: "minimal", roles: [] }, checks: [], started_at: now, completed_at: null, hlc: "1790000000000:0:abcdef" };
}

const GREEN_ROWS = [{ id: "engine", title: "Engine service", state: "green", text: "Home's AI is answering." }];
let checklistOpen = 3;
function harness(initial = freshState(), checkRows: unknown[] = GREEN_ROWS) {
  const original = globalThis.fetch;
  let state: SetupState | { done: true } = structuredClone(initial);
  const posts: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/setup/state")) return new Response(JSON.stringify(state), { status: 200 });
    if (url.includes("/api/setup/checks/run")) return new Response(JSON.stringify({ rows: checkRows, state }), { status: 200 });
    if (url.includes("/api/setup-checklist")) return new Response(JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ id: `item-${i}`, title: "Item", reason: "", done: i >= checklistOpen, open: { label: "Open", href: "/" } }))), { status: 200 });
    if (url.includes("/api/setup/storage/defaults")) return new Response(JSON.stringify({ records: "/data", models: "/data/models" }), { status: 200 });
    if (url.includes("/api/setup/folders/native")) return new Response(JSON.stringify({ status: "chosen", path: "/Volumes/Big/home-data" }), { status: 200 });
    if (url.includes("/api/setup/storage/check")) return new Response(JSON.stringify({ rows: [] }), { status: 200 });
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
      expect(rendered.container.textContent).toContain("Unsupported system.");
      expect(rendered.getByRole("button", { name: "Try again" }).hasAttribute("disabled")).toBe(false);
    } finally { globalThis.fetch = original; }
  });

  test("resumes at the first pending step from server state and ignores browser storage", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    sessionStorage.setItem("maipai:setup-wizard-step", "0");
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Your setup plan"));
      expect(rendered.container.textContent).not.toContain("What should we call your household");
    } finally { h.restore(); }
  });

  test("first run skips the legacy away step and resumes at owner setup", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks", "plan"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Create your owner account"));
      expect(rendered.container.textContent).not.toContain("Reach Home from anywhere");
    } finally { h.restore(); }
  });

  test("a refresh mid-wizard resumes from the server and each visited screen records its step", async () => {
    const h = harness();
    try {
      let rendered = view();
      await waitFor(() => expect(rendered.getByRole("button", { name: "Set up my Home" })).toBeTruthy());
      await advanceTo(rendered, "Set up my Home", "Before you start");
      expect(h.posts).toEqual([]);
      await advanceTo(rendered, "I understand", "How should Home run?");
      expect(h.posts).toEqual(["welcome"]);
      rendered.unmount();
      rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("How should Home run?"));
      await advanceTo(rendered, "Continue", "Choose where to store data");
      expect(h.posts).toEqual(["welcome", "engine_location"]);
    } finally { h.restore(); }
  });

  test("every visible screen records its step, including deferred work", async () => {
    const h = harness();
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.getByRole("button", { name: "Set up my Home" })).toBeTruthy());
      await advanceTo(rendered, "Set up my Home", "Before you start");
      await advanceTo(rendered, "I understand", "How should Home run?");
      await advanceTo(rendered, "Continue", "Choose where to store data");
      await advanceTo(rendered, "Continue", "Checking your computers");
      await advanceTo(rendered, "Continue", "Your setup plan");
      await advanceTo(rendered, "Continue", "Create your owner account");
      fireEvent.change(rendered.getByLabelText("Name"), { target: { value: "Sage" } });
      fireEvent.change(rendered.getByLabelText("PIN or password"), { target: { value: "2468" } });
      await advanceTo(rendered, "Create owner account", "Let Home greet you");
      await advanceTo(rendered, "Do this later", "Hello");
      await advanceTo(rendered, "Continue", "Save your backup key");
      await advanceTo(rendered, "Continue", "You're all set");
      expect(h.posts).toEqual(["welcome", "engine_location", "storage", "checks", "plan", "owner", "face", "profile", "hello"]);
      await act(async () => { fireEvent.click(rendered.getByRole("button", { name: "Open my Home" })); });
      expect(h.posts.at(-1)).toBe("done");
      await waitFor(() => expect(rendered.container.textContent).toContain("Sign in"));
    } finally { h.restore(); }
  });

  test("Welcome is brief and the required disclosure is the next step", async () => {
    const h = harness();
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Welcome to MaiPai Home"));
      expect(rendered.container.textContent).toContain("Your family's private AI, in your own home.");
      expect(rendered.container.textContent).not.toContain("wrong, offensive, or harmful");
      await advanceTo(rendered, "Set up my Home", "Before you start");
      expect(rendered.getByRole("button", { name: "I understand" })).toBeTruthy();
      expect(rendered.container.textContent).toContain("Home is built to protect your family and your data. Like any AI or online tool, it works best when you know a few things.");
      expect(rendered.container.textContent).toContain("AI can be wrong or say the wrong thing");
      expect(rendered.container.textContent).toContain("Kids may still see things they shouldn't");
      expect(rendered.container.textContent).toContain("People can grow attached to AI");
      expect(rendered.container.textContent).toContain("Home goes online for you");
      expect(rendered.container.textContent).toContain("Home goes online for you");
      expect(rendered.queryByText(/Answers can be inaccurate, offensive, or harmful\./)).toBeNull();
      fireEvent.click(rendered.getByRole("button", { name: "AI can be wrong or say the wrong thing" }));
      expect(rendered.container.textContent).toContain("Answers can be inaccurate, offensive, or harmful.");
      expect(rendered.container.textContent).toContain("you are responsible for how you use them.");
    } finally { h.restore(); }
  });

  test("an unfinished setup also shows the new required disclosure before resuming", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    sessionStorage.removeItem("maipai:setup-before-start-read");
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Before you start"));
      await advanceTo(rendered, "I understand", "Checking your computers");
      expect(h.posts).toEqual(["welcome"]);
    } finally { h.restore(); }
  });

  test("backup key has its own screen before the final step", async () => {
    const state = freshState();
    for (const step of state.steps) if (step.id !== "hello" && step.id !== "done") step.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Hello"));
      await advanceTo(rendered, "Continue", "Save your backup key");
      expect(rendered.container.textContent).toContain("If this computer breaks, this key restores your Home on a new one.");
    } finally { h.restore(); }
  });

  test("a red check row keeps Try again clickable and pressing it checks again", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state, [{ id: "engine", title: "Engine service", state: "red", text: "Home's AI isn't running." }]);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Needs fixing"));
      const calls = () => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((call) => String(call[0]).includes("/api/setup/checks/run")).length;
      const before = calls();
      await act(async () => { fireEvent.click(rendered.getByRole("button", { name: "Try again" })); });
      await waitFor(() => expect(calls()).toBe(before + 1));
      expect(rendered.container.textContent).not.toMatch(/\b(red|green|amber|idle)\b/);
    } finally { h.restore(); }
  });

  test("a folder chosen on the storage screen is still chosen after Continue and Back", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Choose where to store data"));
      await act(async () => { fireEvent.click(rendered.getAllByRole("button", { name: "Choose a folder" })[0]!); });
      await waitFor(() => expect(rendered.container.textContent).toContain("/Volumes/Big/home-data"));
      await advanceTo(rendered, "Continue", "Checking your computers");
      await advanceTo(rendered, "Back", "Choose where to store data");
      expect(rendered.container.textContent).toContain("/Volumes/Big/home-data");
    } finally { h.restore(); }
  });

  test("going Back from the plan reaches Checks and stays there instead of jumping forward", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Your setup plan"));
      await advanceTo(rendered, "Back", "Checking your computers");
      await waitFor(() => expect(rendered.container.textContent).toContain("Home's AI is answering."));
      await new Promise((resolve) => setTimeout(resolve, 1800));
      expect(rendered.container.textContent).toContain("Checking your computers");
      await advanceTo(rendered, "Back", "Choose where to store data");
    } finally { h.restore(); }
  });

  test("a PIN that is empty or too short shows plain copy, keeps the name and sends nothing", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks", "plan"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Create your owner account"));
      expect(rendered.getAllByRole("button", { name: /Create owner account|Continue/ })).toHaveLength(1);
      fireEvent.change(rendered.getByLabelText("Name"), { target: { value: "Sage" } });
      await act(async () => { fireEvent.click(rendered.getByRole("button", { name: "Create owner account" })); });
      expect(rendered.container.textContent).toContain("Type a PIN or password for this person so they can sign in.");
      fireEvent.change(rendered.getByLabelText("PIN or password"), { target: { value: "12" } });
      await act(async () => { fireEvent.click(rendered.getByRole("button", { name: "Create owner account" })); });
      expect(rendered.container.textContent).toContain("Use 4 to 128 characters for the PIN or password.");
      expect((rendered.getByLabelText("Name") as HTMLInputElement).value).toBe("Sage");
      expect(h.posts).toEqual([]);
    } finally { h.restore(); }
  });

  test("Back from Face skips the owner form once the owner account exists", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks", "plan", "owner"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Let Home greet you"));
      await advanceTo(rendered, "Back", "Your setup plan");
      await advanceTo(rendered, "Continue", "Let Home greet you");
    } finally { h.restore(); }
  });

  test("setup screens never show build-state placeholder copy", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks", "plan", "owner", "face", "profile"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Hello"));
      expect(rendered.container.textContent).not.toMatch(/not built|not available|isn't available|not supported/i);
    } finally { h.restore(); }
  });

  test("the Done screen's things-left number is the hub checklist's own count", async () => {
    const state = freshState();
    for (const step of state.steps) if (step.id !== "done") step.status = "done";
    checklistOpen = 3;
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("3 things left to finish setting up"));
      checklistOpen = 1;
      rendered.unmount();
      const again = view();
      await waitFor(() => expect(again.container.textContent).toContain("1 thing left to finish setting up"));
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
