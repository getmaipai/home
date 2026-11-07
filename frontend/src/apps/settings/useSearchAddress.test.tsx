// AUDIT-DUP-FE-01: the shared SearXNG address state machine: what Test proves, for exactly which text, and when it stops counting.
import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { useSearchAddress, webSearchFailure } from "@/apps/settings/useSearchAddress";

afterEach(cleanup);
const works = { saved: false, result: { canUse: true, level: "ok" } as never };

describe("useSearchAddress", () => {
  test("a passing Test counts only for the exact text it tested", async () => {
    const view = renderHook(() => useSearchAddress("", async () => works));
    act(() => view.result.current.type(" http://searx.local:8888 "));
    expect(view.result.current.trimmed).toBe("http://searx.local:8888");
    await act(async () => { await view.result.current.runTest(); });
    expect(view.result.current.passed).toBe(true);
    act(() => view.result.current.type("http://other.local:8888"));
    expect(view.result.current.passed).toBe(false);
    expect(view.result.current.changedAfterTest).toBe(true);
    act(() => view.result.current.forgetTest());
    expect(view.result.current.changedAfterTest).toBe(false);
  });

  test("an empty field is never tested, and a refused Test shows the hub's words with the next step", async () => {
    let calls = 0;
    const view = renderHook(() => useSearchAddress("", async () => { calls += 1; throw new ApiError("Nothing answered there. ", 502, undefined, "Check the address."); }));
    await act(async () => { await view.result.current.runTest(); });
    expect(calls).toBe(0);
    act(() => view.result.current.type("http://x.local"));
    await act(async () => { await view.result.current.runTest(); });
    expect(view.result.current.error).toBe("Nothing answered there. Check the address.");
    expect(view.result.current.busy).toBeNull();
    expect(webSearchFailure(new TypeError("x"))).toContain("Home couldn't reach that address");
  });

  test("the field shows the fallback until the person types, and goes back to it on reset", () => {
    const view = renderHook(() => useSearchAddress("http://saved.local", async () => works));
    expect(view.result.current.text).toBe("http://saved.local");
    act(() => view.result.current.type("http://new.local"));
    expect(view.result.current.text).toBe("http://new.local");
    act(() => view.result.current.resetTyped());
    expect(view.result.current.text).toBe("http://saved.local");
  });
});
