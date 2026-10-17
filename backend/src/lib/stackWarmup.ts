import { getStackClient, isStackConfigured } from "@/lib/stackEngine";

/** STACK-WARM-01: tell the Stack to load and prime the roles a first chat
 * needs. Best effort and idempotent (a warm-up already running is joined);
 * while it runs the Stack reports the chat role as loading, which the
 * health row turns into "starting" and the chat Welcome shows as the
 * warming-up art. Never throws: a Stack that is down is the health row's
 * business, not this call's. Returns whether the request was accepted. */
export async function warmStack(): Promise<boolean> {
  if (!isStackConfigured()) return false;
  try { await getStackClient().warmup(); return true; }
  catch { return false; }
}
