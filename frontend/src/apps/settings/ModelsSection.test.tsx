import { describe, test, expect, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { ModelsSection, formatEta } from "@/apps/settings/ModelsSection";

afterEach(cleanup);

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

const HARDWARE = {
  platform: "darwin",
  totalRamGb: 24,
  cpuCount: 14,
  isAppleSilicon: true,
  unifiedMemoryGb: 24,
  cudaDevices: [],
};

function chatFit(overrides: Partial<{ fits: boolean; implemented: boolean }> = {}) {
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
    },
    fits: overrides.fits ?? true,
    contextUsed: 8192,
    requiredBytes: 5_000_000_000,
    budgetBytes: 22_000_000_000,
  };
}

const NO_SELECTION = { modelId: null };
const NO_ENGINE = { kind: "none", modelId: null, pid: null, startedAt: null };
const RUNNING_ENGINE = { kind: "selection", modelId: "qwen3-8b-instruct-q4-k-m", pid: 4242, startedAt: "2026-09-04T10:00:00.000Z" };

describe("formatEta", () => {
  test("under 90 seconds reads as 'less than a minute'", () => {
    expect(formatEta(45)).toBe("less than a minute left");
  });
  test("minutes are rounded and pluralized correctly", () => {
    expect(formatEta(120)).toBe("about 2 minutes left");
    expect(formatEta(185)).toBe("about 3 minutes left");
  });
  test("an hour or more switches to hours", () => {
    expect(formatEta(3600)).toBe("about 1 hour left");
    expect(formatEta(7200)).toBe("about 2 hours left");
  });
});

describe("ModelsSection", () => {
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

  test("a model nobody has chosen yet offers a 'Use this' action, with details tucked behind a toggle", async () => {
    const restore = stubFetch({
      "/api/host/hardware": HARDWARE,
      "role=chat": [chatFit({ fits: true })],
      "role=image": [],
      "role=video": [],
      "/models/selection": NO_SELECTION,
      "/engine/status": NO_ENGINE,
    });
    try {
      const { findByText, getByText, queryByText } = render(<ModelsSection />);
      await findByText("Use this");
      // The pros/cons dump is real (Jesse, 2026-09-04: the old flat list
      // was "ugly and too technical for a dad"), just not shown until asked.
      expect(queryByText(/Runs well on a single 8GB GPU/)).toBeNull();
      await act(async () => {
        fireEvent.click(getByText("Details"));
      });
      await findByText(/Runs well on a single 8GB GPU/);
    } finally {
      restore();
    }
  });

  test("the already-selected model shows as Running, not as another 'Use this' offer", async () => {
    const restore = stubFetch({
      "/api/host/hardware": HARDWARE,
      "role=chat": [chatFit({ fits: true })],
      "role=image": [],
      "role=video": [],
      "/models/selection": { modelId: "qwen3-8b-instruct-q4-k-m" },
      "/engine/status": RUNNING_ENGINE,
    });
    try {
      const { findByText, queryByText } = render(<ModelsSection />);
      await findByText("Running");
      expect(queryByText("Use this")).toBeNull();
    } finally {
      restore();
    }
  });

  test("a running model offers Stop/Restart, and Stop calls the real engine-control endpoint", async () => {
    const restore = stubFetch({
      "/api/host/hardware": HARDWARE,
      "role=chat": [chatFit({ fits: true })],
      "role=image": [],
      "role=video": [],
      "/models/selection": { modelId: "qwen3-8b-instruct-q4-k-m" },
      "/engine/status": RUNNING_ENGINE,
      "/engine/stop": { kind: "stopped", modelId: "qwen3-8b-instruct-q4-k-m", pid: null, startedAt: null },
    });
    try {
      const { findByText, getByText } = render(<ModelsSection />);
      await findByText("Running");
      await findByText("Stop");
      await act(async () => {
        fireEvent.click(getByText("Stop"));
      });
      await findByText("Stopped");
    } finally {
      restore();
    }
  });

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

  test("choosing a model starts the download job and shows its progress", async () => {
    const restore = stubFetch({
      "/api/host/hardware": HARDWARE,
      "role=chat": [chatFit({ fits: true })],
      "role=image": [],
      "role=video": [],
      "/models/selection": NO_SELECTION,
      "/engine/status": NO_ENGINE,
      "/select-status": {
        modelId: "qwen3-8b-instruct-q4-k-m",
        status: "downloading_model",
        phase: "downloading model weights",
        completedBytes: 1_000_000_000,
        totalBytes: 5_000_000_000,
        error: null,
        postLoadCheck: null,
      },
      "/select": {
        modelId: "qwen3-8b-instruct-q4-k-m",
        status: "downloading_model",
        phase: "downloading model weights",
        completedBytes: 1_000_000_000,
        totalBytes: 5_000_000_000,
        error: null,
        postLoadCheck: null,
      },
    });
    try {
      const { findByText, getByText } = render(<ModelsSection />);
      await findByText("Use this");
      await act(async () => {
        fireEvent.click(getByText("Use this"));
      });
      await findByText("Downloading the model…");
    } finally {
      restore();
    }
  });

  // A code review (2026-09-04) found the job object was never cleared
  // once it reached "ready": activeJob stayed truthy forever, which kept
  // isSelected false and left the card permanently stuck on the last
  // progress bar instead of showing Running/Stop/Restart, until a full
  // page reload dropped the stale job state.
  test("a job that reaches ready stops showing progress UI (doesn't get stuck)", async () => {
    const restore = stubFetch({
      "/api/host/hardware": HARDWARE,
      "role=chat": [chatFit({ fits: true })],
      "role=image": [],
      "role=video": [],
      "/models/selection": NO_SELECTION,
      "/engine/status": NO_ENGINE,
      "/select": {
        modelId: "qwen3-8b-instruct-q4-k-m",
        status: "ready",
        phase: "ready",
        completedBytes: 5_000_000_000,
        totalBytes: 5_000_000_000,
        error: null,
        postLoadCheck: { estimatedBytes: 6_900_000_000, actualBytes: 7_700_000_000, driftPct: 0.11 },
      },
    });
    try {
      const { findByText, getByText, queryByText } = render(<ModelsSection />);
      await findByText("Use this");
      await act(async () => {
        fireEvent.click(getByText("Use this"));
      });
      await waitFor(() => expect(queryByText("Use this")).toBeNull());
      expect(queryByText("Downloading the model…")).toBeNull();
    } finally {
      restore();
    }
  });
});
