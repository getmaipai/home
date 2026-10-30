// ENGINE-STATUS-MEDIA-01: the making hook reads the one ["health"] query and gives each band its own line; the recovery toast
// shows once, only when something was waiting.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/queryClient";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { MAKING_BACK_LINE, makingAvailability, useMakingAvailability, useMakingRecovery, type MakingAvailability } from "@/apps/chat/useMakingAvailability";

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

const notice = { adult: "This computer is low on memory, so picture making is paused. It starts again by itself when memory frees up.", teen: "Teen line.", child: "Pictures are resting for a bit. Try again soon.", repairs_link: null };
const PAUSED = { kind: "failed", pid: null, alive: false, availability: "unavailable", cause: "memory", notice };

function view(image: unknown, band: "adult" | "teen" | "child") {
  const calls: string[] = [];
  globalThis.fetch = mock((url: string | URL | Request) => { calls.push(String(url)); return Promise.resolve(Response.json({ engines: { chat: { kind: "url", pid: null, alive: true, availability: "ready" }, image } })); }) as unknown as typeof fetch;
  const client = createQueryClient();
  const hook = renderHook(() => useMakingAvailability("image"), { wrapper: ({ children }) => <QueryClientProvider client={client}><WakeWordPersonContext.Provider value={{ role: "adult", age_band: band } as never}>{children}</WakeWordPersonContext.Provider></QueryClientProvider> });
  return { hook, calls };
}

describe("useMakingAvailability", () => {
  test("a paused row disables the control with the person's own line", async () => {
    const { hook, calls } = view(PAUSED, "adult");
    await waitFor(() => expect(hook.result.current).toEqual({ availability: "unavailable", reason: notice.adult, disabled: true }));
    expect(calls.every((url) => url.includes("/api/health"))).toBe(true);
  });

  test("a child reads the child line", async () => {
    const { hook } = view(PAUSED, "child");
    await waitFor(() => expect(hook.result.current.reason).toBe(notice.child));
  });

  test("a ready row, or no row from an older hub, leaves the control alone", async () => {
    expect(makingAvailability(undefined, null)).toEqual({ availability: "ready", reason: null, disabled: false });
    const { hook } = view({ kind: "none", pid: null, alive: true, availability: "ready" }, "teen");
    await waitFor(() => expect(hook.result.current.disabled).toBe(false));
  });
});

describe("useMakingRecovery", () => {
  const down: MakingAvailability = { availability: "unavailable", reason: "paused", disabled: true };
  const up: MakingAvailability = { availability: "ready", reason: null, disabled: false };

  test("one toast when making comes back and a request was waiting", () => {
    const notify = mock((_line: string) => {});
    const hook = renderHook(({ making, waiting }) => useMakingRecovery(making, waiting, MAKING_BACK_LINE.animation, notify), { initialProps: { making: down, waiting: true } });
    expect(notify).not.toHaveBeenCalled();
    hook.rerender({ making: up, waiting: true });
    hook.rerender({ making: up, waiting: true });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toBe("Picture making is back, your animation is going.");
  });

  test("no toast when nothing was waiting, and none without a pause", () => {
    const notify = mock((_line: string) => {});
    const hook = renderHook(({ making, waiting }) => useMakingRecovery(making, waiting, MAKING_BACK_LINE.picture, notify), { initialProps: { making: down, waiting: false } });
    hook.rerender({ making: up, waiting: false });
    hook.rerender({ making: up, waiting: true });
    expect(notify).not.toHaveBeenCalled();
  });
});
