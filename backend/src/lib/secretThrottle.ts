// Home's own sign-in brute-force throttle: ONE shared instance across
// every sign-in surface (totp.ts, passkeys.ts, auth.ts, setup.ts) -
// deliberately global so one host can't hammer every sign-in route in
// parallel for a combined budget bigger than the throttle's own limit.
// Never call createThrottle() a second time for this same budget; a
// per-route-file instance would multiply the allowed attempts by the
// number of routes. The token-bucket logic lives in
// @maipai/core/src/secretThrottle now (core-v0.1.0).
import type { Context } from "hono";
import { createThrottle, getClientIp as getClientIpCore } from "@maipai/core/src/secretThrottle";
import { TRUST_PROXY } from "@/lib/trustProxy";

const throttle = createThrottle();

export const throttleCheck = throttle.check;
export const throttleFail = throttle.fail;
export const throttleReset = throttle.reset;
export const __resetThrottleForTests = throttle.__resetForTests;

export function getClientIp(c: Context): string {
  return getClientIpCore(c, { trustProxy: TRUST_PROXY });
}
