import { describe, test, expect, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ModelsSection } from "@/apps/settings/ModelsSection";
import { api, type FitPlanResponse } from "@/lib/api";
import { __resetFitPlanCacheForTests } from "@/lib/useFitPlan";
import { StackFitPlan } from "@maipai/spec/gen/ts/stack-fit-plan.js";
import { summarizeFits } from "@/lib/fitSummary";

afterEach(() => { cleanup(); __resetFitPlanCacheForTests(); });

// Same fetch-stub approach as ChangeSecretSection.test.tsx (this file's
// static import of the component under test means Bun's module cache
// won't reliably re-bind a mock.module()-registered "@/lib/api" mock).
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function stubFetch(byPath: Record<string, unknown>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = Object.entries(byPath).find(([path]) => url.includes(path));
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    return Promise.resolve(jsonResponse(match[1]));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function stubFetchWithFitPlan(byPath: Record<string, unknown>, response: unknown, onRequest?: (body: unknown) => void): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/fit-plan")) {
      onRequest?.(JSON.parse(String(init?.body)));
      return Promise.resolve(jsonResponse(response));
    }
    const match = Object.entries(byPath).find(([path]) => url.includes(path));
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    return Promise.resolve(jsonResponse(match[1]));
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function stubFetchWithFitPlanResponder(byPath: Record<string, unknown>, responder: (body: { source: { url?: string; repo?: string } }) => unknown): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/fit-plan")) return Promise.resolve(jsonResponse(responder(JSON.parse(String(init?.body)))));
    const match = Object.entries(byPath).find(([path]) => url.includes(path));
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    return Promise.resolve(jsonResponse(match[1]));
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

const HARDWARE = {
  platform: "darwin",
  totalRamGb: 24,
  cpuCount: 14,
  isAppleSilicon: true,
  unifiedMemoryGb: 24,
  cudaDevices: [],
};

function chatFit(overrides: Partial<{ fits: boolean; implemented: boolean; url: string }> = {}) {
  return {
    model: {
      id: "qwen3-8b-instruct-q4-k-m",
      role: "chat",
      label: "Qwen3 8B Instruct",
      license: "Apache-2.0",
      engine: "llama-server",
      implemented: overrides.implemented ?? true,
      pros: ["Runs well on a single 8GB GPU"],
      cons: ["Less capable on hard reasoning tasks"],
      sizing: { kind: "transformer_gguf", param_count_billion: 8.2, bits_per_weight: 4, num_layers: 36, num_kv_heads: 8, head_dim: 128, max_context: 32768 },
      download: overrides.url ? { url: overrides.url } : { url: "https://huggingface.co/atlas/model.gguf" },
    },
    fits: overrides.fits ?? true,
    contextUsed: 8192,
    requiredBytes: 5_000_000_000,
    budgetBytes: 22_000_000_000,
  };
}

const NO_SELECTION = { modelId: null, name: null, state: "offline" };
const NO_ENGINE = { kind: "none", modelId: null, pid: null, startedAt: null };
const testPlan = (verdict: "yes" | "no" | "slow" | "unknown") => StackFitPlan.parse({ schema: 1, model: "example", context_tokens: 8192, kv_cache_type: "f16", roles: [{ role: "chat", choice: "q4", peak: { low: 4 * 1024 ** 3, high: 5 * 1024 ** 3, source: "estimated", as_of: "2026-09-30" } }], total: { low: 5 * 1024 ** 3, high: 9 * 1024 ** 3, source: "estimated", as_of: "2026-09-30" }, cap: { low: 23 * 1024 ** 3, high: 24 * 1024 ** 3, source: "measured", as_of: "2026-09-30" }, margin: { low: 14 * 1024 ** 3, high: 19 * 1024 ** 3, source: "measured", as_of: "2026-09-30" }, paths: [{ path: "unified", fits: verdict === "yes", verdict: verdict === "slow" ? "no" : verdict, ...(verdict === "no" ? { shortfall: { low: 5 * 1024 ** 3, high: 6 * 1024 ** 3, source: "estimated", as_of: "2026-09-30" } } : {}) }], verdict, bottleneck: verdict === "unknown" ? "unknown" : "memory" });
const FIT_YES = { plan: testPlan("yes"), wording: { verdict: "yes", headline: "Runs well on this computer", detail: "About 5 GB of the 24 GB this computer can give to models." } };
const FIT_NO = { plan: testPlan("no"), wording: { verdict: "no", headline: "Won't fit", detail: "Needs about 6 GB more memory." } };
const FIT_UNKNOWN = { plan: testPlan("unknown"), wording: { verdict: "unknown", headline: "Can't tell yet", detail: "Nobody has measured a model like this on a computer like yours yet." } };
const FIT_UNAVAILABLE = { plan: null, wording: { verdict: "unknown", headline: "Can't check right now", detail: "The model size checker did not answer. Try again in a moment." } };
const GGUF_LINK = "https://huggingface.co/example-org/example-model-GGUF/resolve/main/example-model-Q4_K_M.gguf";

describe("ModelsSection", () => {
  const baseResponses = {
    "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [],
    "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE,
  };

  test("Check a model explains the known file size for an unmeasured family", async () => {
    const plan = StackFitPlan.parse({ ...testPlan("unknown"), model_file_bytes: 11_771_546_784, cap: { low: 16 * 1024 ** 3, high: 16 * 1024 ** 3, source: "measured", as_of: "2026-09-30" } });
    const response = { plan, wording: { verdict: "unknown", headline: "Can't tell yet", detail: "The model file is about 11 GB, and this computer can give 16 GB to models. How much more memory it needs while running is not known for this model family yet." } };
    const restore = stubFetchWithFitPlan(baseResponses, response);
    try {
      const { findByRole, getByRole, findAllByText } = render(<ModelsSection />);
      const input = await findByRole("textbox", { name: "Hugging Face model link" });
      fireEvent.change(input, { target: { value: GGUF_LINK } });
      await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      expect((await findAllByText(response.wording.detail)).length).toBeGreaterThan(0);
    } finally { restore(); }
  });

  test("after two successful checks Compare shows the recommended model and both checked models", async () => {
    const restore = stubFetchWithFitPlanResponder(baseResponses, ({ source }) => source.repo ? FIT_NO : FIT_YES);
    try {
      const { findByRole, getByRole, findByText } = render(<ModelsSection />);
      await findByText("This computer: Apple Silicon, 24 GB memory.");
      const input = await findByRole("textbox", { name: "Hugging Face model link" });
      fireEvent.change(input, { target: { value: GGUF_LINK } });
      await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      await findByText("Compare");
      fireEvent.change(input, { target: { value: "https://huggingface.co/example-org/second-model" } });
      await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      await findByText("example-org/second-model");
      expect(document.querySelectorAll('[data-slot="compare-models"] [data-slot="card"]')).toHaveLength(3);
      expect(document.querySelector('[data-slot="compare-models"]')?.textContent).toContain("Qwen3 8B Instruct");
      expect(document.querySelector('[data-slot="compare-models"]')?.textContent).toContain("example-model-Q4_K_M");
      expect(document.querySelector('[data-slot="compare-models"]')?.textContent).toContain("example-org/second-model");
    } finally { restore(); }
  });

  test("checking the same model link again replaces its row", async () => {
    const restore = stubFetchWithFitPlanResponder(baseResponses, () => FIT_YES);
    try {
      const { findByRole, getByRole, findByText } = render(<ModelsSection />);
      const input = await findByRole("textbox", { name: "Hugging Face model link" });
      for (let i = 0; i < 2; i += 1) {
        fireEvent.change(input, { target: { value: GGUF_LINK } });
        await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
        await findByText("example-model-Q4_K_M");
      }
      expect(document.querySelectorAll('[data-slot="compare-models"] [data-slot="card"]')).toHaveLength(2);
    } finally { restore(); }
  });

  test("shows no Compare card with only the recommended model", async () => {
    const restore = stubFetchWithFitPlanResponder(baseResponses, () => FIT_YES);
    try {
      const { findByText } = render(<ModelsSection />);
      await findByText("This computer: Apple Silicon, 24 GB memory.");
      expect(document.querySelector('[data-slot="compare-models"]')).toBeNull();
    } finally { restore(); }
  });

  test("each comparison shows complete names and verdicts without pick tags or checks for a no", async () => {
    const restore = stubFetchWithFitPlanResponder(baseResponses, ({ source }) => source.repo ? FIT_NO : FIT_YES);
    try {
      const { findByRole, getByRole, findByText } = render(<ModelsSection />);
      const input = await findByRole("textbox", { name: "Hugging Face model link" });
      for (const link of [GGUF_LINK, "https://huggingface.co/example-org/example-big-model"]) {
        fireEvent.change(input, { target: { value: link } });
        await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      }
      await findByText("example-org/example-big-model");
      const text = document.body.textContent ?? "";
      for (const expected of [
        "Qwen3 8B Instruct", "Runs well on this computer",
        "example-model-Q4_K_M", "Runs well on this computer",
        "example-org/example-big-model", "Won't fit",
      ]) expect(text).toContain(expected);
      const noCard = Array.from(document.querySelectorAll('[data-slot="compare-models"] [data-slot="card"]')).find((card) => card.textContent?.includes("example-org/example-big-model"));
      expect(noCard).toBeDefined();
      expect(noCard?.textContent).not.toContain("pick");
      expect(noCard?.querySelector("svg")).toBeNull();
    } finally { restore(); }
  });

  test("Copy summary writes the deterministic summary to the clipboard", async () => {
    const originalClipboard = navigator.clipboard;
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
    const restore = stubFetchWithFitPlanResponder(baseResponses, ({ source }) => source.repo ? FIT_NO : FIT_YES);
    try {
      const { findByRole, getByRole, findByText } = render(<ModelsSection />);
      const input = await findByRole("textbox", { name: "Hugging Face model link" });
      fireEvent.change(input, { target: { value: GGUF_LINK } });
      await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      fireEvent.change(input, { target: { value: "https://huggingface.co/example-org/second-model" } });
      await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      await findByText("Compare");
      await act(async () => { fireEvent.click(getByRole("button", { name: "Copy summary" })); });
      const expected = summarizeFits([
        { name: "Qwen3 8B Instruct", wording: FIT_YES.wording as FitPlanResponse["wording"], plan: FIT_YES.plan },
        { name: "example-org/second-model", wording: FIT_NO.wording as FitPlanResponse["wording"], plan: FIT_NO.plan },
        { name: "example-model-Q4_K_M", wording: FIT_YES.wording as FitPlanResponse["wording"], plan: FIT_YES.plan },
      ], { memoryGb: 24, usableGb: 24 });
      expect(copied).toBe(expected);
    } finally { restore(); Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard }); }
  });

  test("clipboard failure reveals the summary in a read-only textarea", async () => {
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
    const restore = stubFetchWithFitPlanResponder(baseResponses, ({ source }) => source.repo ? FIT_NO : FIT_YES);
    try {
      const { findByRole, getByRole, findByText } = render(<ModelsSection />);
      const input = await findByRole("textbox", { name: "Hugging Face model link" });
      for (const link of [GGUF_LINK, "https://huggingface.co/example-org/second-model"]) {
        fireEvent.change(input, { target: { value: link } });
        await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      }
      await findByText("Compare");
      await act(async () => { fireEvent.click(getByRole("button", { name: "Copy summary" })); });
      await findByText("Could not copy. Select the text below instead.");
      expect(getByRole("textbox", { name: "Summary to copy" }).getAttribute("readonly")).not.toBeNull();
    } finally { restore(); Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard }); }
  });

  test("a GGUF link is sent to fit-plan and shows the returned verdict", async () => {
    let posted: unknown;
    const restore = stubFetchWithFitPlan({
      "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [],
      "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE,
    }, FIT_YES, (body) => { posted = body; });
    try {
      const { findByRole, getByRole, findAllByText } = render(<ModelsSection />);
      const input = await findByRole("textbox", { name: "Hugging Face model link" });
      fireEvent.change(input, { target: { value: GGUF_LINK } });
      await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      const headlines = await findAllByText("Runs well on this computer");
      expect(headlines.length).toBeGreaterThan(0);
      expect(posted).toEqual({ source: { url: GGUF_LINK } });
    } finally { restore(); }
  });

  test("an MLX repository link is sent as a repository source", async () => {
    let posted: unknown;
    const restore = stubFetchWithFitPlan({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE }, FIT_YES, (body) => { posted = body; });
    try {
      const { findByRole, getByRole, findAllByText } = render(<ModelsSection />);
      fireEvent.change(await findByRole("textbox", { name: "Hugging Face model link" }), { target: { value: "https://huggingface.co/example-org/example-mlx" } });
      await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      await findAllByText("Runs well on this computer");
      expect(posted).toEqual({ source: { repo: "example-org/example-mlx" } });
    } finally { restore(); }
  });

  test("an unknown verdict stays neutral", async () => {
    const restore = stubFetchWithFitPlan({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE }, FIT_UNKNOWN);
    try {
      const { findByRole, getByRole, findAllByText, queryByText } = render(<ModelsSection />);
      fireEvent.change(await findByRole("textbox", { name: "Hugging Face model link" }), { target: { value: GGUF_LINK } });
      await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      const headlines = await findAllByText("Can't tell yet");
      expect(headlines.length).toBeGreaterThan(0);
      expect(queryByText("Won't fit")).toBeNull();
    } finally { restore(); }
  });

  test("a bad link shows its error without making a request", async () => {
    let fitPlanCalls = 0;
    const restore = stubFetchWithFitPlan({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE }, FIT_YES, () => { fitPlanCalls += 1; });
    try {
      const { findByRole, getByRole, findByText } = render(<ModelsSection />);
      await findByText("This computer: Apple Silicon, 24 GB memory.");
      const callsBeforeClick = fitPlanCalls;
      fireEvent.change(await findByRole("textbox", { name: "Hugging Face model link" }), { target: { value: "not a link" } });
      await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      await findByText("That does not look like a Hugging Face model link.");
      expect(fitPlanCalls).toBe(callsBeforeClick);
    } finally { restore(); }
  });

  test("a plan-null answer shows its unavailable wording", async () => {
    const restore = stubFetchWithFitPlan({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE }, FIT_UNAVAILABLE);
    try {
      const { findByRole, getByRole, findByText } = render(<ModelsSection />);
      fireEvent.change(await findByRole("textbox", { name: "Hugging Face model link" }), { target: { value: GGUF_LINK } });
      await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      await findByText("Can't check right now");
      await findByText("The model size checker did not answer. Try again in a moment.");
    } finally { restore(); }
  });

  test("opening recommended model Details shows the plan memory range", async () => {
    const restore = stubFetchWithFitPlan({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE }, FIT_YES);
    try {
      const { findByText, getByText } = render(<ModelsSection />);
      await findByText("This computer: Apple Silicon, 24 GB memory.");
      fireEvent.click(getByText("Details"));
      await findByText("Memory it needs");
      await findByText("about 5 to 9 GB");
    } finally { restore(); }
  });

  test("fit verdict badges use the teal, orange, red, and neutral status tokens", async () => {
    const cases = [
      { response: FIT_YES, badge: "Good fit", token: "--hue-teal" },
      { response: { plan: testPlan("slow"), wording: { verdict: "slow", headline: "Runs, but slowly", detail: "It fits only by using the processor, so answers will be slower." } }, badge: "Slow here", token: "--hue-orange" },
      { response: FIT_NO, badge: "Too big", token: "bg-destructive" },
      { response: FIT_UNKNOWN, badge: "Not tested yet", token: "bg-secondary" },
    ];
    for (const { response, badge, token } of cases) {
      const restore = stubFetchWithFitPlan({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE }, response);
      try {
        const { findByText, getByText } = render(<ModelsSection />);
        await findByText(badge);
        await findByText(response.wording.headline);
        const pill = getByText(badge).closest("[data-verdict]");
        expect(pill?.getAttribute("data-verdict")).toBe(response.wording.verdict);
        expect(pill?.className).toContain(token);
        if (response.wording.verdict === "unknown") expect(pill?.className).not.toContain("bg-destructive");
      } finally { restore(); cleanup(); __resetFitPlanCacheForTests(); }
    }
  });

  test("the Stack sentence is inside Details", async () => {
    const restore = stubFetchWithFitPlan({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE }, FIT_YES);
    try {
      const { findByText, getByText, queryByText } = render(<ModelsSection />);
      await findByText("This computer: Apple Silicon, 24 GB memory.");
      expect(queryByText("Chat runs through the MaiPai Stack.")).toBeNull();
      fireEvent.click(getByText("Details"));
      const sentence = await findByText("Chat runs through the MaiPai Stack.");
      expect(getByText("Details").parentElement?.textContent).toContain(sentence.textContent);
    } finally { restore(); }
  });

  test("a no verdict plan shows the plan's remedy", async () => {
    const restore = stubFetchWithFitPlan({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE }, FIT_NO);
    try {
      const { findByText, getByText } = render(<ModelsSection />);
      await findByText("This computer: Apple Silicon, 24 GB memory.");
      fireEvent.click(getByText("Details"));
      await findByText("It needs about 6 GB more memory. A smaller version of this model, or a shorter conversation memory, would help.");
      expect(document.querySelector('[data-slot="recommendation-card"]')).toBeNull();
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
    } finally { restore(); }
  });

  test("a plan-null response keeps the legacy memory line without a fit panel", async () => {
    const restore = stubFetchWithFitPlan({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE }, FIT_UNAVAILABLE);
    try {
      const { findByText, getByText, queryByText } = render(<ModelsSection />);
      await findByText("This computer: Apple Silicon, 24 GB memory.");
      fireEvent.click(getByText("Details"));
      await findByText(/Uses about .* of memory\./);
      expect(queryByText("Memory it needs")).toBeNull();
    } finally { restore(); }
  });

  test("a checked model result names the file used to size a plan", async () => {
    const restore = stubFetchWithFitPlan({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE }, FIT_YES);
    try {
      const { findByRole, findByText, getByRole } = render(<ModelsSection />);
      fireEvent.change(await findByRole("textbox", { name: "Hugging Face model link" }), { target: { value: GGUF_LINK } });
      await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      await findByText("Sized from example.");
      await findByRole("button", { name: "How this was worked out" });
    } finally { restore(); }
  });

  test("a checked model result without a plan does not name a sized file", async () => {
    const restore = stubFetchWithFitPlan({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE }, FIT_UNAVAILABLE);
    try {
      const { findByRole, findByText, getByRole, queryByText } = render(<ModelsSection />);
      fireEvent.change(await findByRole("textbox", { name: "Hugging Face model link" }), { target: { value: GGUF_LINK } });
      await act(async () => { fireEvent.click(getByRole("button", { name: "Check" })); });
      await findByText("Can't check right now");
      expect(queryByText(/Sized from /)).toBeNull();
    } finally { restore(); }
  });


  test("shows Memory right now, its figure, and a loaded model line", async () => {
    const memory = { available: true, memory: { usableGb: 16, usedGb: 6.2, freeGb: 9.8, pressure: "normal", pressureText: "This computer has plenty of free memory right now.", loaded: [{ id: "chat", label: "Chat", gb: 5.1 }], homeOwnedRoles: [] } };
    const restore = stubFetch({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE, "/api/computer-memory": memory });
    try {
      const { findByText } = render(<ModelsSection />);
      await findByText("Memory right now");
      await findByText("6.2 GB in use of 16 GB");
      expect((await findByText("5.1 GB")).textContent).toBe("5.1 GB");
      expect(document.querySelector('[data-slot="spec-sheet"]')?.textContent).toContain("Chat");
    } finally { restore(); }
  });

  test("shows the empty-memory message when the Stack has nothing loaded", async () => {
    const memory = { available: true, memory: { usableGb: 16, usedGb: 0, freeGb: 16, pressure: "normal", pressureText: "This computer has plenty of free memory right now.", loaded: [], homeOwnedRoles: [] as Array<"chat" | "embeddings" | "stt" | "tts"> } };
    const restore = stubFetch({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE, "/api/computer-memory": memory });
    try {
      const { findByText } = render(<ModelsSection />);
      await findByText("Nothing is loaded right now.");
      expect(document.body.textContent).not.toContain("Home's own engines still run");
    } finally { restore(); }
  });

  test("shows the original empty-memory lines when no roles still run on Home", async () => {
    const memory = { available: true, memory: { usableGb: 16, usedGb: 0, freeGb: 16, pressure: "normal", pressureText: "This computer has plenty of free memory right now.", loaded: [], homeOwnedRoles: [] } };
    const restore = stubFetch({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE, "/api/computer-memory": memory });
    try {
      const { findByText, queryByText } = render(<ModelsSection />);
      await findByText("Nothing is loaded right now.");
      expect(queryByText(/This counts only what the Stack has loaded/)).toBeNull();
    } finally { restore(); }
  });

  test("renders no memory card when the Stack is unavailable", async () => {
    const restore = stubFetch({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit()], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE, "/api/computer-memory": { available: false } });
    try {
      const { findByText, queryByText } = render(<ModelsSection />);
      await findByText("This computer: Apple Silicon, 24 GB memory.");
      expect(queryByText("Memory right now")).toBeNull();
    } finally { restore(); }
  });

  test("shows the detected hardware in plain language", async () => {
    const restore = stubFetch({
      "/api/host/hardware": HARDWARE,
      "role=chat": [chatFit()],
      "role=image": [],
      "role=video": [],
      "/models/selection": NO_SELECTION,
      "/engine/status": NO_ENGINE,
    });
    try {
      const { findByText } = render(<ModelsSection />);
      await findByText(/Apple Silicon, 24 GB memory/);
    } finally {
      restore();
    }
  });

  test("shows the Stack chat model and state without Home model controls", async () => {
    const restore = stubFetch({
      "/api/host/hardware": HARDWARE,
      "role=chat": [chatFit()],
      "role=image": [],
      "role=video": [],
      "/models/selection": { modelId: "stack-chat-model", name: "Stack Chat Model", state: "ready" },
      "/engine/status": NO_ENGINE,
    });
    try {
      const { findByText, queryByRole } = render(<ModelsSection />);
      await findByText("Stack Chat Model");
      await findByText("Ready");
      await findByText("This computer: Apple Silicon, 24 GB memory.");
      for (const action of ["Use this", "Restart", "Stop", "Other options"]) expect(queryByRole("button", { name: action })).toBeNull();
      expect(queryByRole("button", { name: "Details" })).toBeTruthy();
    } finally { restore(); }
  });




  // Found live 2026-09-06: "starting" had no way out - just a bare
  // spinner, no button - so a household member watching a hung spawn
  // (a dev-box hot-reload interrupting an in-flight start, in this case)
  // had no recourse but to wait indefinitely. Stop is safe to offer here:
  // stopChatBackend() unconditionally clears the in-flight promise, the
  // same way it stops an already-running one.


  test("a planned role (image/video) with no real backend yet is one honest line, not a pros/cons dump", async () => {
    const restore = stubFetch({
      "/api/host/hardware": HARDWARE,
      "role=chat": [],
      "role=image": [chatFit({ implemented: false })],
      "role=video": [],
      "/models/selection": NO_SELECTION,
      "/engine/status": NO_ENGINE,
    });
    try {
      const { findByText, queryByText } = render(<ModelsSection />);
      await findByText("Not available on this computer yet.");
      expect(queryByText(/Runs well on a single 8GB GPU/)).toBeNull();
    } finally {
      restore();
    }
  });


  // A code review (2026-09-04) found the job object was never cleared
  // once it reached "ready": activeJob stayed truthy forever, which kept
  // isSelected false and left the card permanently stuck on the last
  // progress bar instead of showing Running/Stop/Restart, until a full
  // page reload dropped the stale job state.

  test("the Stack verdict replaces both legacy lines and sends the pinned URL and context", async () => {
    const fit = chatFit({ fits: false });
    const response = { plan: testPlan("yes"), wording: { verdict: "yes" as const, headline: "Runs well on this computer", detail: "About 3 GB of the 16 GB this computer can give to models." } };
    const fitPlan = mock(() => Promise.resolve(response));
    const original = api.fitPlan;
    api.fitPlan = fitPlan as typeof api.fitPlan;
    const restore = stubFetch({
      "/api/host/hardware": HARDWARE, "role=chat": [fit], "role=image": [], "role=video": [],
      "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE,
    });
    try {
      const { findByText, getByText, queryByText } = render(<ModelsSection />);
      await findByText(response.wording.headline);
      expect(getByText(response.wording.detail)).toBeTruthy();
      expect(queryByText("This may run slowly on this computer.")).toBeNull();
      await act(async () => { fireEvent.click(getByText("Details")); });
      expect(queryByText(/Uses about/)).toBeNull();
      await findByText("Memory it needs");
      expect(fitPlan).toHaveBeenCalledWith({ source: { url: fit.model.download!.url }, context_tokens: fit.contextUsed });
    } finally { restore(); api.fitPlan = original; }
  });

  test.each([
    ["slow", "Runs, but slowly", "It fits only by using the processor, so answers will be slower."],
    ["no", "Won't fit", "Needs about 6 GB more memory."],
    ["unknown", "Can't tell yet", "Nobody has measured a model like this on a computer like yours yet."],
  ] as const)("shows the backend wording for %s", async (verdict, headline, detail) => {
    const fit = chatFit();
    const original = api.fitPlan;
    api.fitPlan = mock(() => Promise.resolve({ plan: testPlan(verdict), wording: { verdict, headline, detail } })) as typeof api.fitPlan;
    const restore = stubFetch({ "/api/host/hardware": HARDWARE, "role=chat": [fit], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE });
    try { const { findByText } = render(<ModelsSection />); await findByText(headline); await findByText(detail); }
    finally { restore(); api.fitPlan = original; }
  });

  test.each(["null", "reject"] as const)("falls back to both legacy lines when the Stack response is %s", async (mode) => {
    const fit = chatFit({ fits: false });
    const original = api.fitPlan;
    api.fitPlan = (mode === "null" ? mock(() => Promise.resolve({ plan: null, wording: { verdict: "unknown", headline: "ignored", detail: "ignored" } })) : mock(() => Promise.reject(new Error("offline")))) as typeof api.fitPlan;
    const restore = stubFetch({ "/api/host/hardware": HARDWARE, "role=chat": [fit], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE });
    try {
      const { findByText, getByText } = render(<ModelsSection />);
      await findByText("This may run slowly on this computer.");
      await act(async () => { fireEvent.click(getByText("Details")); });
      await findByText(/Uses about/);
    } finally { restore(); api.fitPlan = original; }
  });

  test("does not ask the Stack for a non Hugging Face model URL", async () => {
    const original = api.fitPlan;
    const fitPlan = mock(() => Promise.reject(new Error("unused")));
    api.fitPlan = fitPlan as typeof api.fitPlan;
    const restore = stubFetch({ "/api/host/hardware": HARDWARE, "role=chat": [chatFit({ url: "https://example.invalid/model.gguf" })], "role=image": [], "role=video": [], "/models/selection": NO_SELECTION, "/engine/status": NO_ENGINE });
    try { const { findByText } = render(<ModelsSection />); await findByText("This computer: Apple Silicon, 24 GB memory."); expect(fitPlan).not.toHaveBeenCalled(); }
    finally { restore(); api.fitPlan = original; }
  });

});
