import { useEffect } from "react";
import { ApiError } from "@/lib/api";

/** CHAT-PAUSE-01: the one wording and the one wait for "the hub did not
 * answer", used wherever the app used to print "Could not reach the hub".
 * A hub restarts for a minute or two during an update, so the line says that
 * and what happens next. */
export const HUB_DOWN_LINE = "Home is restarting or updating. It will be back in a minute.";

/** The hub itself did not answer: the request never got a response (refused,
 * dropped, no network), or a proxy in front of it said so (502, 504, or a 503
 * with no code of the hub's own). A 503 that carries a code is the hub
 * answering (an engine or install refusal), so it is not this. */
export function isHubUnreachable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 502 || error.status === 504 || (error.status === 503 && error.code === undefined);
  return error instanceof TypeError || (error instanceof Error && /failed to fetch|networkerror|load failed|network request failed/i.test(error.message));
}

/** The line to print for a failed request: the hub's own words when it
 * answered, the restarting line when it did not. */
export function hubErrorMessage(error: unknown, fallback = HUB_DOWN_LINE): string {
  if (isHubUnreachable(error)) return HUB_DOWN_LINE;
  return error instanceof ApiError ? error.message : fallback;
}

/** Waits until the hub answers anything at all (a 401 is an answer), asking
 * every 3 s and easing to 10 s. Resolves true when it answers, false if the
 * signal aborts first. Asks the one route every signed-in or signed-out client
 * can reach without effect: GET /api/health. */
export function waitForHub(signal?: AbortSignal, probe: () => Promise<unknown> = () => fetch("/api/health", { cache: "no-store" })): Promise<boolean> {
  return new Promise((resolve) => {
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { if (timer) clearTimeout(timer); resolve(false); };
    signal?.addEventListener("abort", stop, { once: true });
    const tick = () => {
      if (signal?.aborted) return;
      probe().then(
        () => { signal?.removeEventListener("abort", stop); resolve(true); },
        () => {
          attempt += 1;
          timer = setTimeout(tick, attempt < 5 ? 3_000 : attempt < 10 ? 5_000 : 10_000);
        },
      );
    };
    tick();
  });
}

/** Runs `onBack` once when the hub answers again, while `active`. */
export function useWhenHubBack(active: boolean, onBack: () => void): void {
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void waitForHub(controller.signal).then((up) => { if (up && !controller.signal.aborted) onBack(); });
    return () => controller.abort();
    // onBack is deliberately not a dependency: one wait per active period.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
