// "Turn in flight" lease: a small file (and GET /api/turn-in-flight) that says a conversation turn is using the chip, so a heavy job (a video render) can pause between steps.
// In flight = from the first speech frame of the person's turn until her reply is fully synthesized (the voice no longer needs the chip). The lab rewrites the file every second with a
// short expiry (LEASE_TTL_MS), so a crashed or hung lab stops holding anyone within seconds, and a turn that is somehow never closed is dropped by conversationActiveCount after 25 s.
import { writeFileSync, renameSync } from "node:fs";
export const LEASE_TTL_MS = 5000;
export interface LeaseState { inFlight: boolean; turns: number; updated_at_ms: number; expires_at_ms: number }
export const leaseState = (turns: number, now: number): LeaseState => ({ inFlight: turns > 0, turns, updated_at_ms: now, expires_at_ms: now + LEASE_TTL_MS });
/** True only while the lease says a turn is in flight AND has not expired (a stale file from a dead lab counts as no turn). */
export const leaseHolds = (s: Partial<LeaseState> | null | undefined, now: number) => !!s && s.inFlight === true && typeof s.expires_at_ms === "number" && s.expires_at_ms > now;
export function writeLease(path: string, s: LeaseState) { const tmp = path + ".tmp"; writeFileSync(tmp, JSON.stringify(s)); renameSync(tmp, path); }
/** Rewrites the lease every intervalMs (default 1 s) and once at start. Returns a stop function that also clears the lease. */
export function startLeaseWriter(path: string, turns: () => number, intervalMs = 1000, now: () => number = Date.now) {
  const tick = () => { try { writeLease(path, leaseState(turns(), now())); } catch { /* a missing folder must never take the lab down */ } };
  tick(); const h = setInterval(tick, intervalMs); (h as any).unref?.();
  return () => { clearInterval(h); try { writeLease(path, leaseState(0, now())); } catch {} };
}
