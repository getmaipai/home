import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { VoiceEngineSection } from "@/apps/settings/VoiceEngineSection";

afterEach(cleanup);

function stubFetch(opts: { current?: string; available?: boolean; onSave?: (engine: string) => void; failSave?: boolean }) {
  let current = opts.current ?? "auto";
  return mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    if (url.includes("/api/voice/engine") && method === "GET") return Promise.resolve(new Response(JSON.stringify({ current, pending: null, available: opts.available ?? true }), { status: 200 }));
    if (url.includes("/api/voice/engine") && method === "PUT") {
      if (opts.failSave) return Promise.resolve(new Response(JSON.stringify({ error: "The engine service did not answer." }), { status: 503 }));
      const body = JSON.parse(String(init?.body ?? "{}")) as { engine: string };
      current = body.engine;
      opts.onSave?.(body.engine);
      return Promise.resolve(new Response(JSON.stringify({ current, pending: null, available: true }), { status: 200 }));
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url} ${method}`));
  }) as unknown as typeof fetch;
}

async function withFetch(stub: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try { await run(); } finally { globalThis.fetch = original; }
}

describe("VoiceEngineSection", () => {
  test("shows the three choices in plain words with the current one selected", async () => {
    await withFetch(stubFetch({ current: "voxcpm2" }), async () => {
      const { findByLabelText } = render(<VoiceEngineSection />);
      expect(((await findByLabelText("VoxCPM2 (natural)")) as HTMLElement).getAttribute("aria-checked")).toBe("true");
      expect(((await findByLabelText("Standard")) as HTMLElement).getAttribute("aria-checked")).toBe("false");
      await findByLabelText("VoxCPM2 (smaller)");
    });
  });
  test("choosing one saves it through the voice engine route and says Saved", async () => {
    const saved: string[] = [];
    await withFetch(stubFetch({ onSave: (engine) => saved.push(engine) }), async () => {
      const { findByLabelText, findByText } = render(<VoiceEngineSection />);
      fireEvent.click(await findByLabelText("VoxCPM2 (smaller)"));
      await findByText("Saved.");
      expect(saved).toEqual(["voxcpm2-reduced"]);
    });
  });
  test("a failed save shows the reason and nothing is marked Saved", async () => {
    await withFetch(stubFetch({ failSave: true }), async () => {
      const { findByLabelText, findByText, queryByText } = render(<VoiceEngineSection />);
      fireEvent.click(await findByLabelText("VoxCPM2 (natural)"));
      await findByText("That did not work");
      await waitFor(() => expect(queryByText("Saved.")).toBeNull());
    });
  });
  test("an old Stack gets a plain line instead of choices", async () => {
    await withFetch(stubFetch({ available: false }), async () => {
      const { findByText, queryByLabelText } = render(<VoiceEngineSection />);
      await findByText(/too old to offer a choice/);
      expect(queryByLabelText("Standard")).toBeNull();
    });
  });
});
