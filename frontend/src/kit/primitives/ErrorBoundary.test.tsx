import { describe, expect, test, mock, afterEach, beforeEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "@/kit/primitives/ErrorBoundary";

afterEach(cleanup);

function Bomb(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    // React logs a caught render error to the console itself (on top of
    // this file's own componentDidCatch call) - expected noise for this
    // one test, not a real assertion target, so it's silenced rather
    // than left to print a scary stack trace on every test run.
    originalConsoleError = console.error;
    console.error = mock(() => {});
  });
  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("renders children normally when nothing throws", () => {
    const { getByText } = render(
      <ErrorBoundary>
        <p>Hello</p>
      </ErrorBoundary>,
    );
    expect(getByText("Hello")).toBeTruthy();
  });

  test("shows a plain-English recovery screen instead of a blank page when a child throws while rendering", () => {
    const { getByText, getByRole } = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(getByText("Something went wrong")).toBeTruthy();
    expect(getByText(/reloading usually fixes it/i)).toBeTruthy();
    expect(getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  test("Reload calls window.location.reload", () => {
    const original = window.location.reload;
    const reload = mock(() => {});
    // jsdom's own location.reload throws "Not implemented" unless
    // replaced - a plain property assignment, not spyOn, since
    // `location` itself isn't configurable on this environment's window.
    Object.defineProperty(window.location, "reload", { configurable: true, value: reload });
    try {
      const { getByRole } = render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>,
      );
      fireEvent.click(getByRole("button", { name: "Reload" }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window.location, "reload", { configurable: true, value: original });
    }
  });
});
