// The sandbox's own gateway door: plain http on the sandbox bridge only, /code/v1 only, bridge /24 sources only.
import { afterEach, describe, expect, test } from "bun:test";
import { configureSandboxListener, ensureSandboxListener, guardSandboxRequest, inBridgeNetwork, sandboxBridgeAddress, sandboxListenerFailure, stopSandboxListener } from "@/lib/codingSandboxListener";
import { sandboxGatewayPort, sandboxGatewayUrl } from "@/lib/codingGatewayAddress";
import { fromSandboxNetwork } from "@/lib/codeGate";

const ok = async () => new Response("inner");
const call = (path: string, peer: string | undefined) => guardSandboxRequest("192.168.128.1", ok, () => peer)(new Request(`http://192.168.128.1:3100${path}`), null);

describe("the sandbox listener's guard", () => {
  test("a source outside the bridge /24 is refused, whatever the path", async () => {
    for (const peer of ["192.168.1.20", "100.64.0.5", "127.0.0.1", "10.0.0.2", undefined]) expect((await call("/code/v1/models", peer)).status).toBe(403);
  });
  test("a bridge source reaches /code/v1 and nothing else", async () => {
    expect((await call("/code/v1/chat/completions", "192.168.128.2")).status).toBe(200);
    expect((await call("/code/v1", "::ffff:192.168.128.9")).status).toBe(200);
    for (const path of ["/", "/api/auth/profiles", "/code/v1evil", "/code/v10/x", "/stack/v1/sandboxes", "/api/code/sessions"]) expect((await call(path, "192.168.128.2")).status).toBe(404);
  });
  test("the bridge /24 check", () => {
    expect(inBridgeNetwork("192.168.128.2", "192.168.128.1")).toBe(true);
    expect(inBridgeNetwork("192.168.129.2", "192.168.128.1")).toBe(false);
    expect(inBridgeNetwork("fd7a::1", "192.168.128.1")).toBe(false);
  });
  test("the gateway address points at the dedicated port, not the HTTPS main port, and the transport check stays strict", () => {
    expect(sandboxGatewayUrl({ PORT: "3000" } as never)).toBe("http://192.168.128.1:3100/code/v1");
    expect(sandboxGatewayPort({ MAIPAI_SANDBOX_GATEWAY_PORT: "4555" } as never)).toBe(4555);
    expect(sandboxBridgeAddress("http://192.168.128.1:3100/code/v1")).toBe("192.168.128.1");
    expect(sandboxBridgeAddress("http://hub.example.com/code/v1")).toBeNull();
    expect(fromSandboxNetwork("192.168.1.20", "192.168.128.1:3100")).toBe(false);
  });
});

describe("the real listener", () => {
  const saved = process.env.MAIPAI_SANDBOX_GATEWAY_URL;
  afterEach(() => { stopSandboxListener(); if (saved === undefined) delete process.env.MAIPAI_SANDBOX_GATEWAY_URL; else process.env.MAIPAI_SANDBOX_GATEWAY_URL = saved; });
  test("binds the bridge address on its port, serves /code/v1 over plain http, refuses other paths, and stops", async () => {
    const port = 38000 + Math.floor(Math.random() * 1000);
    process.env.MAIPAI_SANDBOX_GATEWAY_URL = `http://127.0.0.1:${port}/code/v1`; // a loopback stand-in for the bridge address
    expect(await ensureSandboxListener()).toBe(false); // not configured with the app's fetch yet
    configureSandboxListener(async (request) => new Response(`inner ${new URL(request.url).pathname}`));
    expect(await ensureSandboxListener()).toBe(true);
    expect(await (await fetch(`http://127.0.0.1:${port}/code/v1/models`)).text()).toBe("inner /code/v1/models");
    expect((await fetch(`http://127.0.0.1:${port}/api/auth/profiles`)).status).toBe(404);
    stopSandboxListener();
    await expect(fetch(`http://127.0.0.1:${port}/code/v1/models`)).rejects.toThrow();
  });
  test("an address that is not on this machine cannot be bound: the turn gets false, not a throw", async () => {
    process.env.MAIPAI_SANDBOX_GATEWAY_URL = "http://192.0.2.77:38999/code/v1";
    configureSandboxListener(ok);
    expect(await ensureSandboxListener(2, 10)).toBe(false);
  });
  test("a port held by another program is reported as port_in_use (not a generic failure), and clears once it binds", async () => {
    const port = 38000 + Math.floor(Math.random() * 1000);
    process.env.MAIPAI_SANDBOX_GATEWAY_URL = `http://127.0.0.1:${port}/code/v1`;
    configureSandboxListener(ok);
    const holder = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("busy") });
    expect(await ensureSandboxListener(2, 10)).toBe(false);
    expect(sandboxListenerFailure()).toBe("port_in_use");
    holder.stop(true);
    expect(await ensureSandboxListener(10, 50)).toBe(true);
    expect(sandboxListenerFailure()).toBeNull();
  });
  test("a rebind that finds the port still closing succeeds once it frees (the live sandbox_listener_failed after a release)", async () => {
    const port = 38000 + Math.floor(Math.random() * 1000);
    process.env.MAIPAI_SANDBOX_GATEWAY_URL = `http://127.0.0.1:${port}/code/v1`;
    configureSandboxListener(ok);
    const holder = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("busy") });
    setTimeout(() => holder.stop(true), 300);
    expect(await ensureSandboxListener(25, 100)).toBe(true);
    stopSandboxListener();
  });
});
