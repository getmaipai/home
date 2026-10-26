import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SetupWizard, checksTitle, checksSummary } from "@/apps/setup/SetupWizard";
import type { SetupState } from "@maipai/spec/gen/ts/setup-state.js";

afterEach(cleanup);
beforeEach(() => { sessionStorage.clear(); });

const IDS = ["welcome", "engine_location", "storage", "checks", "plan", "away", "owner", "face", "profile", "hello", "backup_key", "done"] as const;
type TestStep = { id: string; status: SetupState["steps"][number]["status"]; at: string };
function setStepStatus(state: SetupState, id: string, status: SetupState["steps"][number]["status"]) {
  const steps = state.steps as TestStep[];
  state.steps = steps.map((step) => step.id === id ? { ...step, status, at: new Date().toISOString() } : step) as SetupState["steps"];
}
function freshState(): SetupState {
  sessionStorage.setItem("maipai:setup-before-start-read", "true");
  const now = new Date().toISOString();
  return { id: "setup-test", source: "wizard", steps: [...IDS.slice(0, 7).map((id) => ({ id, status: "pending" as const, at: now })), { id: "coding_mode", status: "pending" as const, at: now }, ...IDS.slice(7).map((id) => ({ id, status: "pending" as const, at: now }))], phase: "computers", engine: { where: "this_computer", hardware: {} }, away: "later", plan: { option: "recommended", tier: "minimal", roles: [] }, checks: [], started_at: now, completed_at: null, hlc: "1790000000000:0:abcdef" } as unknown as SetupState;
}

const GREEN_ROWS = [{ id: "engine", title: "Engine service", state: "green", text: "Home's AI is answering." }];
let checklistOpen = 3;
const RECOMMENDED_PLAN = { plan: {}, wording: { level: "recommended", headline: "Recommended setup for this computer", detail: "Fits.", gets: ["Chat with Home"], needsMemoryAnswer: false, sizeLine: "Download: 40 GB", diskLine: null } };
/** `plan` is what GET /api/setup/plan answers: the recommended plan by default, or "unreachable" for an engine that is not answering. */
let jobRows: unknown[] = [];
const SILENT_PLAN = { plan: null, wording: { level: "unknown", headline: "Home can't see this computer's AI yet", detail: "The AI engine isn't answering. Wait a minute and press Check again.", gets: [], needsMemoryAnswer: false, sizeLine: null, diskLine: null } };
function harness(initial = freshState(), checkRows: unknown[] = GREEN_ROWS, plan: "recommended" | "unreachable" | "silent" = "recommended", eligibleMode = false, codingPieceState = "notInstalled") {
  const original = globalThis.fetch;
  let state: SetupState | { done: true } = structuredClone(initial);
  let currentCodingPieceState = codingPieceState;
  const posts: string[] = [];
  const licenceAccepts: string[] = [];
  const bodies: Record<string, { engine?: { where: string } }> = {};
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/setup/licences/accept")) { licenceAccepts.push("accepted"); return new Response(JSON.stringify({ accepted: true }), { status: 200 }); }
    if (url.includes("/api/setup/state")) return new Response(JSON.stringify(state), { status: 200 });
    if (url.includes("/api/setup/plan") && init?.method !== "POST") {
      if (plan === "unreachable") return new Response(JSON.stringify({ error: "The AI engine isn't answering yet.", next: "Wait a minute and press Check again." }), { status: 503 });
      // The real route answers 200 with level "unknown" when the engine is silent.
      if (plan === "silent") return new Response(JSON.stringify(SILENT_PLAN), { status: 200 });
      return new Response(JSON.stringify(RECOMMENDED_PLAN), { status: 200 });
    }
    if (url.includes("/api/jobs")) return new Response(JSON.stringify(jobRows), { status: 200 });
    if (url.includes("/api/setup/install") && init?.method !== "POST") return new Response(JSON.stringify({ state: "downloading", chatReady: false, complete: false, percent: 30, completedBytes: 3, totalBytes: 10, bytesPerSecond: null, etaSeconds: null, problem: null, items: [] }), { status: 200 });
    if (url.includes("/api/setup/install") && init?.method === "POST" && !("done" in state)) {
      // The real route records the plan step itself when it starts the downloads.
      state.steps = state.steps.map((step) => step.id === "plan" ? { ...step, status: "done", at: new Date().toISOString() } : step);
      return new Response(JSON.stringify({ started: true, models: 2 }), { status: 200 });
    }
    if (url.includes("/api/setup/checks/run")) return new Response(JSON.stringify({ rows: checkRows, state }), { status: 200 });
    if (url.includes("/api/setup-checklist")) return new Response(JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ id: `item-${i}`, title: "Item", reason: "", done: i >= checklistOpen, open: { label: "Open", href: "/" } }))), { status: 200 });
    if (url.includes("/api/setup/storage/defaults")) return new Response(JSON.stringify({ records: "/data", models: "/data/models" }), { status: 200 });
    if (url.includes("/api/setup/folders/native")) return new Response(JSON.stringify({ status: "chosen", path: "/Volumes/Big/home-data" }), { status: 200 });
    if (url.includes("/api/setup/storage/check")) return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    if (url.includes("/api/setup/ca")) return new Response(JSON.stringify({ certificate: "public" }), { status: 200 });
    if (url.includes("/api/backups/emergency-kit")) return new Response(JSON.stringify({ hubName: "Home", hubInstanceId: "hub-1", backupKeyHex: "aabb", generatedAt: new Date().toISOString() }), { status: 200 });
    if (url.endsWith("/api/setup/coding") && init?.method !== "POST") return new Response(JSON.stringify({ eligible_mode: eligibleMode, pieces: [{ id: "engine", label: "Coding engine", size_bytes: 1024 ** 3, state: currentCodingPieceState }, { id: "model", label: "Coding model", size_bytes: 4 * 1024 ** 3, state: currentCodingPieceState }], total_bytes: 5 * 1024 ** 3, readiness: { ...codingReadiness, ready: false, first_unmet: "pieces" } }), { status: 200 });
    if (url.endsWith("/api/setup/coding") && init?.method === "POST") {
      const choice = JSON.parse(String(init.body)) as { choice: "set_up" | "later" };
      posts.push(`coding:${choice.choice}`);
      if (choice.choice === "set_up") currentCodingPieceState = "installed";
      if (choice.choice === "later" && !("done" in state)) setStepStatus(state, "coding_mode", "skipped");
      return new Response(JSON.stringify({ accepted: true }), { status: 200 });
    }
    if (url.endsWith("/api/coding/mode/self-test") && init?.method === "POST") return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    if (url.endsWith("/api/settings/api-keys") && init?.method === "POST") return new Response(JSON.stringify({ key: { hint: "ABCD" }, secret: "maipai_key_once" }), { status: 201 });
    if (url.includes("/api/auth/setup")) return new Response(JSON.stringify({ person: { id: "owner-1" } }), { status: 201 });
    const match = url.match(/\/api\/setup\/([^/?]+)$/);
    if (match && init?.method === "POST" && !("done" in state)) {
      const id = decodeURIComponent(match[1]!);
      posts.push(id);
      const body = JSON.parse(String(init.body)) as { status: SetupState["steps"][number]["status"]; engine?: { where: string } };
      bodies[id] = body;
      state.steps = state.steps.map((step) => step.id === id ? { ...step, status: body.status, at: new Date().toISOString() } : step);
      if (id === "done" && body.status === "done") state = { done: true };
      return new Response(JSON.stringify(state), { status: 200 });
    }
    throw new Error(`Unstubbed request ${url}`);
  }) as unknown as typeof fetch;
  return { posts, bodies, licenceAccepts, restore: () => { globalThis.fetch = original; } };
}

const codingReadiness = { ready: false, first_unmet: "pieces", checked_at: new Date().toISOString(), items: ["coding_enabled", "engine", "pieces", "hardware", "memory", "self_test", "client", "bench"].map((id) => ({ id, state: "can_do", reason_key: id, doc_anchor: id })), provenance: "test", hlc: "1790000000000:0:abcdef" };

function view(onDone = () => {}, initialScreen?: "coding_mode") {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/setup"]}><Routes><Route path="/setup" element={<SetupWizard onDone={onDone} initialScreen={initialScreen} />} /><Route path="/sign-in" element={<p>Sign in</p>} /></Routes></MemoryRouter></QueryClientProvider>);
}

async function advanceTo(viewResult: ReturnType<typeof view>, buttonText: string, expected: string) {
  await act(async () => { fireEvent.click(viewResult.getByRole("button", { name: buttonText })); });
  await waitFor(() => expect(viewResult.container.textContent).toContain(expected));
}

describe("SetupWizard", () => {
  test("the This computer step shows after storage only when the Mac offers tuning, records nothing and never blocks", async () => {
    for (const supported of [true, false]) {
      const state = freshState();
      for (const id of ["welcome", "engine_location"] as const) state.steps.find((step) => step.id === id)!.status = "done";
      const h = harness(state);
      const inner = globalThis.fetch;
      globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith("/api/setup/host-tune")
        ? new Response(JSON.stringify({ supported, items: [{ id: "a", title: "Keep the Mac awake", why: "Sleep stops downloads.", mode: "auto", state: "needs", current: "off", proposed: "on" }] }), { status: 200 })
        : inner(input, init)) as unknown as typeof fetch;
      try {
        const rendered = view();
        await waitFor(() => expect(rendered.container.textContent).toContain("Choose where to store data"));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
        await advanceTo(rendered, "Continue", supported ? "Tune this computer" : "Checking your computer");
        if (supported) {
          await waitFor(() => expect(rendered.container.textContent).toContain("Keep the Mac awake"));
          await advanceTo(rendered, "Continue", "Checking your computer");
          expect(h.posts).toEqual(["storage"]);
          await advanceTo(rendered, "Back", "Tune this computer");
        } else expect(h.posts).toEqual(["storage"]);
      } finally { globalThis.fetch = inner; h.restore(); }
      cleanup();
    }
  });

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

  test("amber results show a plain summary and the normal Continue defers checks", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state, [{ id: "engine", title: "Engine service", state: "amber", text: "The engine is slow." }]);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("The engine is slow."));
      expect(rendered.container.textContent).toContain("1 thing to look at. You can continue, but it may not work.");
      expect(rendered.queryByRole("button", { name: "Continue anyway" })).toBeNull();
      await advanceTo(rendered, "Continue", "Your setup plan");
      expect(h.bodies["checks"]).toMatchObject({ status: "deferred" });
    } finally { h.restore(); }
  });

  test("all green stays on Checks, says so, and waits for Continue", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Everything looks ready."));
      await new Promise((resolve) => setTimeout(resolve, 1800));
      expect(rendered.container.textContent).toContain("Checking your computer");
      expect(rendered.container.textContent).not.toContain("Your setup plan");
    } finally { h.restore(); }
  });

  test("the Checks title is plural only for two computers", () => {
    expect(checksTitle("this_computer")).toBe("Checking your computer");
    expect(checksTitle("another_computer")).toBe("Checking your computers");
    expect(checksSummary([{ id: "a", title: "A", state: "red", text: "x" }])).toContain("Try again");
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

  test("the licences are named inside the existing internet item (no new item), and I understand records the acknowledgement before the step", async () => {
    const h = harness();
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.getByRole("button", { name: "Set up my Home" })).toBeTruthy());
      await advanceTo(rendered, "Set up my Home", "Before you start");
      fireEvent.click(rendered.getByRole("button", { name: "Home goes online for you" }));
      expect(rendered.container.textContent).toContain("You also accept the licences of the AI models and tools Home installs for you.");
      expect(rendered.getAllByRole("button", { name: /AI can be wrong|AI decides|A little care|Kids may still|People can grow|Home goes online/ }).length).toBe(6);
      expect(h.licenceAccepts).toEqual([]);
      await advanceTo(rendered, "I understand", "How should Home run?");
      expect(h.licenceAccepts).toEqual(["accepted"]);
      expect(h.posts).toEqual(["welcome"]);
    } finally { h.restore(); }
  });

  test("Continue on the engine question sends the answer, which is what makes Home install the AI engine (INSTALL-SPLIT-01)", async () => {
    const state = freshState();
    state.steps.find((step) => step.id === "welcome")!.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("How should Home run?"));
      await advanceTo(rendered, "Continue", "Choose where to store data");
      expect(h.bodies.engine_location?.engine?.where).toBe("this_computer");
    } finally { h.restore(); }
  });

  test("every visible screen records its step, including deferred work", async () => {
    const h = harness();
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.getByRole("button", { name: "Set up my Home" })).toBeTruthy());
      expect(rendered.container.textContent).toContain("Your Home");
      await advanceTo(rendered, "Set up my Home", "Before you start");
      await advanceTo(rendered, "I understand", "How should Home run?");
      await advanceTo(rendered, "Continue", "Choose where to store data");
      await advanceTo(rendered, "Continue", "Checking your computer");
      await advanceTo(rendered, "Continue", "Your setup plan");
      await waitFor(() => expect(rendered.getByRole("button", { name: "Install and continue" })).toBeTruthy());
      await advanceTo(rendered, "Install and continue", "Create your owner account");
      expect(rendered.container.textContent).toContain("Your AI");
      fireEvent.change(rendered.getByLabelText("Name"), { target: { value: "Sage" } });
      fireEvent.change(rendered.getByLabelText("PIN or password"), { target: { value: "2468" } });
      fireEvent.change(rendered.getByLabelText("Confirm passcode"), { target: { value: "2468" } });
      await advanceTo(rendered, "Create owner account", "Coding on this Home");
      await advanceTo(rendered, "Not now", "Save your backup key");
      const createUrl = URL.createObjectURL; const revoke = URL.revokeObjectURL;
      URL.createObjectURL = () => "blob:test"; URL.revokeObjectURL = () => {};
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = () => {};
      try {
        await waitFor(() => expect(rendered.getByRole("button", { name: "Download" }).hasAttribute("disabled")).toBe(false));
        await act(async () => { fireEvent.click(rendered.getByRole("button", { name: "Download" })); });
      } finally { URL.createObjectURL = createUrl; URL.revokeObjectURL = revoke; HTMLAnchorElement.prototype.click = click; }
      await advanceTo(rendered, "Continue", "You're all set");
      expect(h.posts).toEqual(["welcome", "engine_location", "storage", "checks", "plan", "owner", "coding:later", "backup_key"]);
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

  test("uses the Your Home and Your AI phases and records the backup key acknowledgement", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks", "plan", "owner", "coding_mode", "face", "profile", "hello"] as const) {
      setStepStatus(state, id, "done");
    }
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Save your backup key"));
      expect(rendered.container.textContent).toContain("Your AI");
      expect(rendered.container.textContent).toContain("Download your backup key to continue.");
      expect(rendered.queryByRole("button", { name: "Print" })).toBeNull();
      expect(rendered.queryByRole("button", { name: "I saved my backup key" })).toBeNull();
      expect(rendered.container.textContent).not.toContain("aabb");
      expect(rendered.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
      const createUrl = URL.createObjectURL; const revoke = URL.revokeObjectURL;
      URL.createObjectURL = () => "blob:test"; URL.revokeObjectURL = () => {};
      const click = HTMLAnchorElement.prototype.click; let saved = "";
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { saved = this.download; };
      try {
        await waitFor(() => expect(rendered.getByRole("button", { name: "Download" }).hasAttribute("disabled")).toBe(false));
        await act(async () => { fireEvent.click(rendered.getByRole("button", { name: "Download" })); });
      } finally { URL.createObjectURL = createUrl; URL.revokeObjectURL = revoke; HTMLAnchorElement.prototype.click = click; }
      expect(saved).toBe("maipai-home-emergency-backup-key.txt");
      await waitFor(() => expect(rendered.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false));
      expect(rendered.container.textContent).not.toContain("aabb");
      await waitFor(() => expect(h.posts).toContain("backup_key"));
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
      await advanceTo(rendered, "I understand", "Checking your computer");
      expect(h.posts).toEqual(["welcome"]);
    } finally { h.restore(); }
  });

  test("backup key has its own screen before the final step", async () => {
    const state = freshState();
    for (const step of state.steps) if (step.id !== "backup_key" && step.id !== "done") step.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Save your backup key"));
      expect(rendered.container.textContent).toContain("If this computer breaks, this key restores your Home on a new one.");
    } finally { h.restore(); }
  });

  test("resumes at Coding on this Home between the owner and backup steps", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks", "plan", "owner"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Coding on this Home"));
      await advanceTo(rendered, "Not now", "Save your backup key");
      expect(h.posts).toContain("coding:later");
    } finally { h.restore(); }
  });

  test("eligible coding setup starts, runs the test, creates one key, and finishes", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks", "plan", "owner"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    for (const step of state.steps as TestStep[]) if (step.id !== "coding_mode" && step.id !== "backup_key" && step.id !== "done") step.status = "done";
    const h = harness(state, GREEN_ROWS, "recommended", true);
    try {
      const rendered = view(() => {}, "coding_mode");
      await waitFor(() => expect(rendered.getByRole("button", { name: "Set up coding" })).toBeTruthy());
      await act(async () => { fireEvent.click(rendered.getByRole("button", { name: "Set up coding" })); });
      expect(h.posts).toContain("coding:set_up");
      expect(await rendered.findByRole("button", { name: "Create my key" })).toBeTruthy();
      await act(async () => { fireEvent.click(rendered.getByRole("button", { name: "Run the test" })); });
      await waitFor(() => expect(rendered.getByRole("button", { name: "Run the test" })).toBeTruthy());
      await act(async () => { fireEvent.click(rendered.getByRole("button", { name: "Create my key" })); });
      await waitFor(() => expect(rendered.getAllByDisplayValue("maipai_key_once")).toHaveLength(1));
      fireEvent.click(rendered.getByRole("button", { name: "Setup lines for your tool" }));
      expect(rendered.getAllByDisplayValue("maipai_key_once")).toHaveLength(1);
      await advanceTo(rendered, "Finish", "Save your backup key");
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
      await advanceTo(rendered, "Continue", "Checking your computer");
      await advanceTo(rendered, "Back", "Choose where to store data");
      expect(rendered.container.textContent).toContain("/Volumes/Big/home-data");
    } finally { h.restore(); }
  });

  test("the plan screen's Continue is blocked while Install is the way forward", async () => {
    // Found auditing the Mac Studio install: Continue sat beside "Install and
    // continue", recorded the plan as deferred and started no download.
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Your setup plan"));
      expect(rendered.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
      await waitFor(() => expect(rendered.getByRole("button", { name: "Install and continue" })).toBeTruthy());
      expect(rendered.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
      await advanceTo(rendered, "Install and continue", "Create your owner account");
      expect(h.posts).toEqual(["plan"]);
    } finally { h.restore(); }
  });

  test("the plan screen's Continue opens once the engine cannot build a plan, so setup is never stuck", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state, GREEN_ROWS, "unreachable");
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Home couldn't reach the AI engine to build a plan."));
      await waitFor(() => expect(rendered.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false));
      expect(rendered.queryByRole("button", { name: "Install and continue" })).toBeNull();
      await advanceTo(rendered, "Continue", "Create your owner account");
      expect(h.posts).toEqual(["plan"]);
    } finally { h.restore(); }
  });

  test("the Web search screen follows the plan only when Home's own search is not ready; an empty address and Continue turn DuckDuckGo on for adults and go on", async () => {
    for (const searchNeeded of [true, false]) {
      const state = freshState();
      for (const id of ["welcome", "engine_location", "storage"] as const) state.steps.find((step) => step.id === id)!.status = "done";
      const h = harness(state, GREEN_ROWS, "unreachable");
      const inner = globalThis.fetch;
      const searchBodies: unknown[] = [];
      globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/setup/checks/run")) return new Response(JSON.stringify({ rows: GREEN_ROWS, state, searchCandidate: null, searchNeeded }), { status: 200 });
        if (url.includes("/api/setup/search/use-candidate")) { searchBodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ saved: true }), { status: 200 }); }
        return inner(input, init);
      }) as unknown as typeof fetch;
      try {
        const rendered = view();
        await waitFor(() => expect(rendered.container.textContent).toContain("Engine service"));
        await advanceTo(rendered, "Continue", "Your setup plan");
        await waitFor(() => expect(rendered.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false));
        if (!searchNeeded) { await advanceTo(rendered, "Continue", "Create your owner account"); expect(searchBodies).toEqual([]); continue; }
        await advanceTo(rendered, "Continue", "Turn on web search");
        expect(rendered.container.textContent).toContain("SearXNG address");
        await advanceTo(rendered, "Continue", "Create your owner account");
        expect(searchBodies).toEqual([{ ddgs_default: true }]);
        expect(h.posts).not.toContain("web_search");
      } finally { h.restore(); cleanup(); }
    }
  });

  test("going Back from the plan reaches Checks and stays there instead of jumping forward", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Your setup plan"));
      await advanceTo(rendered, "Back", "Checking your computer");
      await waitFor(() => expect(rendered.container.textContent).toContain("Engine service"));
      await new Promise((resolve) => setTimeout(resolve, 1800));
      expect(rendered.container.textContent).toContain("Checking your computer");
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
    for (const id of ["welcome", "engine_location", "storage", "checks", "plan", "owner", "coding_mode"] as const) setStepStatus(state, id, "done");
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Save your backup key"));
      await advanceTo(rendered, "Back", "Coding on this Home");
      await advanceTo(rendered, "Back", "Your setup plan");
      await advanceTo(rendered, "Continue", "Save your backup key");
    } finally { h.restore(); }
  });

  test("setup screens never show build-state placeholder copy", async () => {
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks", "plan", "owner", "coding_mode", "face", "profile"] as const) setStepStatus(state, id, "done");
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Save your backup key"));
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

  test("the Done screen offers to pair the AI computer on a two-computer setup and not on one computer", async () => {
    const two = freshState();
    two.engine.where = "another_computer";
    for (const step of two.steps) if (step.id !== "done") step.status = "done";
    const h = harness(two);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Pair the computer that runs the AI"));
      rendered.unmount();
    } finally { h.restore(); }
    const one = freshState();
    for (const step of one.steps) if (step.id !== "done") step.status = "done";
    const again = harness(one);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Start a chat"));
      expect(rendered.container.textContent).not.toContain("Pair the computer that runs the AI");
    } finally { again.restore(); }
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

  test("a silent engine on the plan screen offers Check again and leaves Continue open", async () => {
    // The real plan route answers 200 with level "unknown" (not an error), and its
    // words say "press Check again": there has to be a button to press.
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks"] as const) state.steps.find((step) => step.id === id)!.status = "done";
    const h = harness(state, GREEN_ROWS, "silent");
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Home can't see this computer's AI yet"));
      expect(rendered.getByRole("button", { name: "Check again" })).toBeTruthy();
      await waitFor(() => expect(rendered.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false));
    } finally { h.restore(); }
  });

  test("after the plan the wizard shows one install strip, not a card per model, and no Details link", async () => {
    // Found walking the wizard: after the owner exists, six per-model cards pushed
    // the backup key buttons off screen, and "Details" led to a settings page that
    // needs a sign-in.
    const state = freshState();
    for (const id of ["welcome", "engine_location", "storage", "checks", "plan", "owner", "coding_mode"] as const) setStepStatus(state, id, "done");
    jobRows = ["chat-27b", "judge-4b", "stt-w"].map((title, i) => ({ id: `j${i}`, kind: "model_download", state: "running", title, updatedAt: new Date().toISOString(), progress: { completedBytes: 1, totalBytes: 10, percent: 10 }, actions: ["stop"] }));
    const h = harness(state);
    try {
      const rendered = view();
      await waitFor(() => expect(rendered.container.textContent).toContain("Save your backup key"));
      await waitFor(() => expect(rendered.queryByTestId("install-strip")).not.toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(rendered.container.textContent).not.toContain("chat-27b");
      expect(rendered.queryByRole("link", { name: "Details" })).toBeNull();
      // The strip is one compact line below the form, not a panel above it.
      expect(rendered.getByTestId("install-strip").textContent).not.toContain(" of ");
      expect(rendered.getByTestId("install-strip").textContent).not.toContain("Fetch");
    } finally { jobRows = []; h.restore(); }
  });
});
