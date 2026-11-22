// The sandbox network exception to the gateway's https rule (found in the Code end-to-end run, 2026-11-21): plain http only from the gateway's own /24 and only for its address.
import { describe, expect, test } from "bun:test";
import { fromSandboxNetwork } from "@/lib/codeGate";

describe("fromSandboxNetwork", () => {
  test("a sandbox on the sandbox network asking for the gateway address is allowed", () => {
    expect(fromSandboxNetwork("192.168.128.2", "192.168.128.1:3000")).toBe(true);
    expect(fromSandboxNetwork("::ffff:192.168.128.9", "192.168.128.1")).toBe(true);
  });
  test("a LAN device, a tailnet peer or another host header is not", () => {
    expect(fromSandboxNetwork("192.168.1.20", "192.168.128.1:3000")).toBe(false);
    expect(fromSandboxNetwork("100.64.0.5", "192.168.128.1:3000")).toBe(false);
    expect(fromSandboxNetwork("192.168.128.2", "hub.example.com")).toBe(false);
    expect(fromSandboxNetwork("192.168.128.2", undefined)).toBe(false);
  });
});
