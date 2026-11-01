// TIER-STATUS-01: the Max window as the Stack's governor reports it (GET /stack/v1/memory `max_window`). Home no longer decides
// whether the computer is held by a Max job from its own flag: the Status line, `minutes_left` and the admin Stop read this first.
import type { StackMaxWindow } from "@/lib/stack/client";

/** The Stack's window, or null when the Stack cannot say (older than the field, unreachable, unreadable). The caller then falls back to Home's own record. */
export async function stackMaxWindow(): Promise<StackMaxWindow | null> {
  try {
    const { getStackClient } = await import("@/lib/stackEngine");
    const body = await getStackClient().memory?.();
    const window = body?.max_window;
    if (!window || (window.state !== "none" && window.state !== "draining" && window.state !== "open")) return null;
    return window;
  } catch { return null; }
}
