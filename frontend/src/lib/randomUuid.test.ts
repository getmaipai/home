import { afterEach, describe, expect, test } from "bun:test";
import { randomUuid } from "@/lib/randomUuid";
import { getDeviceSettingsScope } from "@/lib/deviceSettingsScope";

const original = crypto.randomUUID;
afterEach(() => {
  Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true, writable: true });
  localStorage.clear();
});

// The exact input that crashed Chat on a phone (MOBILE-LIVE-01): a plain-http
// origin has no crypto.randomUUID.
function removeNativeRandomUuid() {
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true, writable: true });
}

describe("randomUuid on a page with no crypto.randomUUID (plain http)", () => {
  test("still returns a well-formed version-4 UUID, and a different one each call", () => {
    removeNativeRandomUuid();
    const a = randomUuid();
    const b = randomUuid();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  test("the per-device settings scope Chat reads while rendering no longer throws", () => {
    removeNativeRandomUuid();
    localStorage.clear();
    const scope = getDeviceSettingsScope();
    expect(scope).toMatch(/^device:[a-z0-9-]{16,64}$/);
    expect(getDeviceSettingsScope()).toBe(scope);
  });
});
