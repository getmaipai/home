// One process-wide progressive slowdown shared by every sign-in route.
// The address is a shared resource for household devices, so this never
// blocks an address indefinitely; the per-profile credential lockout
// remains a separate check in credentialLockout.ts.
import type { Context } from "hono";
import { getClientIp as getClientIpCore } from "@maipai/core/src/secretThrottle";
import { TRUST_PROXY } from "@/lib/trustProxy";

const WINDOW_MS = 15 * 60_000;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const MAX_ADDRESSES = 5_000;

interface AddressState { failures: number; firstFailureAt: number; nextAllowedAt: number }
interface SlowdownOptions { now?: () => number; windowMs?: number; baseDelayMs?: number; maxDelayMs?: number; maxAddresses?: number }

export function createAddressSlowdown(options: SlowdownOptions = {}) {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? WINDOW_MS;
  const baseDelayMs = options.baseDelayMs ?? BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? MAX_DELAY_MS;
  const maxAddresses = options.maxAddresses ?? MAX_ADDRESSES;
  const addresses = new Map<string, AddressState>();

  return {
    check(address: string) {
      const timestamp = now();
      const state = addresses.get(address);
      if (!state) return { blocked: false, retryAfter: 0 };
      if (timestamp - state.firstFailureAt >= windowMs) {
        addresses.delete(address);
        return { blocked: false, retryAfter: 0 };
      }
      if (state.nextAllowedAt > timestamp) return { blocked: true, retryAfter: Math.ceil((state.nextAllowedAt - timestamp) / 1000) };
      return { blocked: false, retryAfter: 0 };
    },
    fail(address: string) {
      const timestamp = now();
      let state = addresses.get(address);
      if (!state || timestamp - state.firstFailureAt >= windowMs) {
        if (addresses.size >= maxAddresses) {
          const oldest = addresses.keys().next().value as string | undefined;
          if (oldest !== undefined) addresses.delete(oldest);
        }
        state = { failures: 0, firstFailureAt: timestamp, nextAllowedAt: timestamp };
        addresses.set(address, state);
      }
      state.failures += 1;
      const delay = Math.min(baseDelayMs * (2 ** Math.min(state.failures - 1, 30)), maxDelayMs);
      state.nextAllowedAt = timestamp + delay;
    },
    reset(address: string) { addresses.delete(address); },
    __resetForTests() { addresses.clear(); },
    __sizeForTests() { return addresses.size; },
  };
}

const throttle = createAddressSlowdown();
export const throttleCheck = throttle.check;
export const throttleFail = throttle.fail;
export const throttleReset = throttle.reset;
export const __resetThrottleForTests = throttle.__resetForTests;

export function getClientIp(c: Context): string {
  return getClientIpCore(c, { trustProxy: TRUST_PROXY });
}
