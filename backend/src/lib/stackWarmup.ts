import { getStackClient, isStackConfigured } from "@/lib/stackEngine";

/** STACK-WARM-01: tell the Stack to load and prime the roles a first chat
 * needs. Best effort and idempotent (a warm-up already running is joined);
 * while it runs the Stack reports the chat role as loaded, which the
 * health row turns into "starting" and the chat Welcome shows as the
 * warming-up art. Never throws: a Stack that is down is the health row's
 * business, not this call's. Returns whether the request was accepted.
 *
 * Between the request and the role list flipping to `loaded` the role still
 * reads `installed` (ready on demand), so the composer used to enable and a
 * message sent then waited out the whole load. While the Stack says it is
 * warming, this module reads the state (GET, never another POST: a POST
 * starts a new warm-up whenever none is running, and re-posting every
 * 2 s kept a chat prime looping on the Stack, 2026-10-17) every WARM_POLL_MS and `warmupInFlight()` is true, which roleHealth reads as
 * "starting". It gives up after WARM_MAX_MS so a stuck warm-up never holds
 * Send for good. */
export const WARM_POLL_MS = 2_000;
export const WARM_MAX_MS = 120_000;
let warmingSince: number | null = null;
let pollTimer: ReturnType<typeof setTimeout> | undefined;

export function warmupInFlight(now = Date.now()): boolean {
  return warmingSince !== null && now - warmingSince < WARM_MAX_MS;
}
export function __resetWarmupForTests(): void { warmingSince = null; clearTimeout(pollTimer); }

function schedule(): void {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => { void readWarmup(); }, WARM_POLL_MS);
  (pollTimer as { unref?: () => void }).unref?.();
}

/** The poll: read the Stack's warm-up state without starting one. */
async function readWarmup(): Promise<void> {
  if (!isStackConfigured()) { warmingSince = null; return; }
  try {
    const { state } = await getStackClient().warmupState();
    if (state === "warming" && warmupInFlight()) schedule(); else warmingSince = null;
  } catch {
    warmingSince = null;
  }
}

/** Asks for one warm-up, once per need: a request while one is already being watched does nothing. */
export async function warmStack(): Promise<boolean> {
  if (!isStackConfigured()) return false;
  if (warmupInFlight()) return true;
  try {
    const { state } = await getStackClient().warmup();
    if (state === "warming") {
      warmingSince ??= Date.now();
      if (warmupInFlight()) schedule(); else warmingSince = null;
    } else {
      warmingSince = null;
    }
    return true;
  } catch {
    warmingSince = null;
    return false;
  }
}
