import { describe, test, mock, afterEach } from "bun:test";
import { render, cleanup, waitFor } from "@testing-library/react";
import { ModelsSection } from "@/apps/settings/ModelsSection";

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

describe("ModelsSection", () => {
  test("shows the detected hardware in plain language", async () => {
    const restore = stubFetch({
      "/api/host/hardware": HARDWARE,
      "role=chat": [chatFit()],
      "role=image": [],
      "role=video": [],
    });
    try {
      const { findByText } = render(<ModelsSection />);
      await findByText(/Apple Silicon, 24 GB memory/);
    } finally {
      restore();
    }
  });

  test("marks a fitting model as fitting and shows its pros", async () => {
    const restore = stubFetch({
      "/api/host/hardware": HARDWARE,
      "role=chat": [chatFit({ fits: true })],
      "role=image": [],
      "role=video": [],
    });
    try {
      const { findByText } = render(<ModelsSection />);
      await findByText("Fits this computer");
      await findByText(/Runs well on a single 8GB GPU/);
    } finally {
      restore();
    }
  });

  test("a not-yet-implemented entry (image/video roles) is labeled as not runnable", async () => {
    const restore = stubFetch({
      "/api/host/hardware": HARDWARE,
      "role=chat": [],
      "role=image": [chatFit({ implemented: false })],
      "role=video": [],
    });
    try {
      const { findByText } = render(<ModelsSection />);
      await waitFor(() => findByText(/Not runnable yet/));
    } finally {
      restore();
    }
  });
});
