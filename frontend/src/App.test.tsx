// I18N-F1: the language hook needs the query client, so App must mount it inside the provider (the first F0 build crashed on a blank page
// with "No QueryClient set"). A signed-out render reaches the sign-in screen and asks the hub for the household language.
import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { App } from "@/App";

(globalThis as unknown as { __SETUP_PREVIEW__: boolean }).__SETUP_PREVIEW__ = false; // the Vite define the bundle gets
const original = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = original; });

test("App renders signed out and reads the household language", async () => {
  const asked: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    asked.push(url);
    if (url.includes("locale")) return Promise.resolve(Response.json({ locale: "en-US" }));
    if (url.includes("/api/auth/people") || url.includes("/api/people")) return Promise.resolve(Response.json([]));
    return Promise.resolve(Response.json({ error: "signed out" }, { status: 401 }));
  }) as typeof fetch;
  window.history.pushState({}, "", "/sign-in");
  const view = render(<App />);
  await waitFor(() => expect(asked.some((url) => url.includes("locale"))).toBe(true));
  expect(view.container.innerHTML.length).toBeGreaterThan(0);
});
