import { describe, expect, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import { hostCheck, __resetHostCheckForTests } from "@/middleware/hostCheck";
import { detectLanIps, addManagedEndpoint } from "@/lib/hubEndpoints";
import { resetDb } from "./reset-db";

function app() {
  const server = new Hono();
  server.use("*", hostCheck);
  server.get("/", (c) => c.text("ok"));
  return server;
}

beforeEach(() => { resetDb(); __resetHostCheckForTests(); });

describe("Host allowlist", () => {
  test("rejects an unrelated Host with the address guidance", async () => {
    const response = await app().request("/", { headers: { host: "evil.example" } });
    expect(response.status).toBe(421);
    expect(await response.json()).toEqual({
      error: "This address is not one Home answers to.",
      next: "Open Home by its own address: the one shown under Settings, Advanced, Network and access.",
    });
  });

  test("accepts loopback and the Home TLS name", async () => {
    for (const host of ["localhost:8787", "127.0.0.1", "[::1]:8787", "maipai.local"]) {
      expect((await app().request("/", { headers: { host } })).status).toBe(200);
    }
  });

  test("accepts any of this machine's own interface addresses and any tailnet name", async () => {
    const { networkInterfaces } = await import("node:os");
    const own = Object.values(networkInterfaces()).flat().map((iface) => iface?.address).filter((a): a is string => !!a);
    for (const address of own.slice(0, 3)) {
      const host = address.includes(":") ? `[${address}]:8787` : `${address}:8787`;
      expect((await app().request("/", { headers: { host } })).status).toBe(200);
    }
    expect((await app().request("/", { headers: { host: "maipai-studio.example-tailnet.ts.net" } })).status).toBe(200);
    expect((await app().request("/", { headers: { host: "evil.ts.net.example" } })).status).toBe(421);
  });

  test("accepts the machine address and managed LAN or Tailscale names", async () => {
    const addresses = detectLanIps();
    if (addresses[0]) expect((await app().request("/", { headers: { host: addresses[0]! } })).status).toBe(200);
    addManagedEndpoint("Managed Home", "http://home-managed.example:8787");
    addManagedEndpoint("Tailnet Home", "http://maipai.tailnet.ts.net:8787", "overlay");
    __resetHostCheckForTests();
    expect((await app().request("/", { headers: { host: "home-managed.example:8787" } })).status).toBe(200);
    expect((await app().request("/", { headers: { host: "maipai.tailnet.ts.net:8787" } })).status).toBe(200);
  });
});
