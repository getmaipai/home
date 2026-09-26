import { describe, expect, test, mock } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { useIdleTimer } from "@/shell/useIdleTimer";

describe("useIdleTimer", () => {
  test("fires onIdle after the timeout with no activity", async () => {
    const onIdle = mock(() => {});
    renderHook(() => useIdleTimer(20, onIdle, true));
    await waitFor(() => expect(onIdle).toHaveBeenCalledTimes(1));
  });

  test("activity resets the clock - no fire while events keep landing", async () => {
    const onIdle = mock(() => {});
    renderHook(() => useIdleTimer(40, onIdle, true));

    // Three activity ticks inside the window, each resetting it.
    window.dispatchEvent(new Event("mousemove"));
    await new Promise((r) => setTimeout(r, 15));
    window.dispatchEvent(new Event("mousemove"));
    await new Promise((r) => setTimeout(r, 15));
    window.dispatchEvent(new Event("keydown"));
    await new Promise((r) => setTimeout(r, 15));
    expect(onIdle).not.toHaveBeenCalled();

    await waitFor(() => expect(onIdle).toHaveBeenCalledTimes(1));
  });

  test("disabled: no listeners, never fires", async () => {
    const onIdle = mock(() => {});
    renderHook(() => useIdleTimer(20, onIdle, false));
    await new Promise((r) => setTimeout(r, 60));
    expect(onIdle).not.toHaveBeenCalled();
  });

  test("unmounting clears the pending timer", async () => {
    const onIdle = mock(() => {});
    const { unmount } = renderHook(() => useIdleTimer(20, onIdle, true));
    unmount();
    await new Promise((r) => setTimeout(r, 60));
    expect(onIdle).not.toHaveBeenCalled();
  });
});
