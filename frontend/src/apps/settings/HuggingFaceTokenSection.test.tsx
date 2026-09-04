import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { HuggingFaceTokenSection } from "@/apps/settings/HuggingFaceTokenSection";

// `@testing-library/dom`'s global `screen` singleton is computed once at
// module-load time, before Bun's test preload finishes registering
// happy-dom's globals - it permanently falls back to a stub that throws.
// Every query here comes from render()'s own returned queries instead
// (ChatPage.test.tsx's own header comment already documents this).

afterEach(cleanup);

function resolvedSetting(isSet: boolean) {
  return { key: "voice.hf_token", value: null, isSet, source: isSet ? "user" : "default", label: "x", level: "advanced", secret: true };
}

function stubFetch(opts: { initiallySet: boolean; onSave?: (value: string) => void; onRemove?: () => void }) {
  let currentlySet = opts.initiallySet;
  return mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    if (url.includes("/api/settings?scope=household") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify([resolvedSetting(currentlySet)]), { status: 200 }));
    }
    if (url.includes("/api/settings") && method === "PUT") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { value?: string };
      currentlySet = true;
      opts.onSave?.(body.value ?? "");
      return Promise.resolve(new Response(JSON.stringify(resolvedSetting(true)), { status: 200 }));
    }
    if (url.includes("/api/settings/reset") && method === "POST") {
      currentlySet = false;
      opts.onRemove?.();
      return Promise.resolve(new Response(JSON.stringify(resolvedSetting(false)), { status: 200 }));
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url} ${method}`));
  }) as unknown as typeof fetch;
}

describe("HuggingFaceTokenSection", () => {
  test("shows 'no token connected' when nothing is set, with no Remove button", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch({ initiallySet: false });
    try {
      const { findByText, queryByText } = render(<HuggingFaceTokenSection />);
      await findByText("No token connected yet.");
      expect(queryByText("Remove")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("shows 'connected' and a Remove button once a token is set", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch({ initiallySet: true });
    try {
      const { findByText } = render(<HuggingFaceTokenSection />);
      await findByText("A token is connected.");
      await findByText("Remove");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("saving a token sends the real pasted value, and the field clears afterward", async () => {
    let saved: string | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch({ initiallySet: false, onSave: (v) => (saved = v) });
    try {
      const { findByPlaceholderText, findByText } = render(<HuggingFaceTokenSection />);
      const input = await findByPlaceholderText("hf_...");
      fireEvent.change(input, { target: { value: "hf_realtoken123" } });
      fireEvent.click(await findByText("Save"));
      await waitFor(() => expect(saved).toBe("hf_realtoken123"));
      await findByText("Saved.");
      await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
      await findByText("A token is connected.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("removing a connected token calls the reset endpoint and updates the status", async () => {
    let removed = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch({ initiallySet: true, onRemove: () => (removed = true) });
    try {
      const { findByText } = render(<HuggingFaceTokenSection />);
      fireEvent.click(await findByText("Remove"));
      await waitFor(() => expect(removed).toBe(true));
      await findByText("No token connected yet.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
