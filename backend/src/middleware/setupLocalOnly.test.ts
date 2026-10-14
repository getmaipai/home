import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { setupLocalOnly } from "@/middleware/setupLocalOnly";
import { resetDb } from "../../tests/reset-db";

type TestServer = {
  port: number;
  requestIP: (request: Request) => { address: string; family: "IPv4" | "IPv6"; port: number };
};

function makeApp(address: string) {
  const server: TestServer = {
    port: 43127,
    requestIP: () => ({ address, family: address.includes(":") ? "IPv6" : "IPv4", port: 51000 }),
  };
  const app = new Hono().use("*", setupLocalOnly).get("/", (c) => c.json({ ok: true }));
  return { app, server };
}

async function request(address: string, headers: Record<string, string> = {}) {
  const { app, server } = makeApp(address);
  return app.request("http://localhost/", { headers: { Host: "localhost:43127", ...headers } }, { server });
}

async function responseError(response: Response): Promise<string> {
  return (await response.json() as { error: string }).error;
}

beforeEach(() => resetDb());

describe("setup is available only from the hub itself", () => {
  test("loopback peer allowed", async () => {
    const response = await request("127.0.0.1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("LAN peer refused", async () => {
    const response = await request("192.0.2.42");
    expect(response.status).toBe(403);
    expect(await responseError(response)).toContain("computer running MaiPai Home");
  });

  test("missing peer refused", async () => {
    const app = new Hono().use("*", setupLocalOnly).get("/", (c) => c.json({ ok: true }));
    const response = await app.request("http://localhost/", { headers: { Host: "localhost" } });
    expect(response.status).toBe(403);
    expect(await responseError(response)).toContain("computer running MaiPai Home");
  });

  test("loopback peer with X-Forwarded-For: 127.0.0.1 refused", async () => {
    const response = await request("127.0.0.1", { "X-Forwarded-For": "127.0.0.1" });
    expect(response.status).toBe(403);
    expect(await responseError(response)).toContain("forwarding proxy");
  });

  test("loopback peer with Forwarded refused", async () => {
    const response = await request("127.0.0.1", { Forwarded: "for=127.0.0.1" });
    expect(response.status).toBe(403);
    expect(await responseError(response)).toContain("forwarding proxy");
  });

  test("loopback peer with foreign Host refused", async () => {
    const response = await request("127.0.0.1", { Host: "home.example.com" });
    expect(response.status).toBe(403);
    expect(await responseError(response)).toContain("localhost address");
  });

  test("loopback peer with a *.ts.net Host refused", async () => {
    const response = await request("127.0.0.1", { Host: "home.example.ts.net" });
    expect(response.status).toBe(403);
    expect(await responseError(response)).toContain("localhost address");
  });

  test("IPv6 loopback allowed", async () => {
    const { app, server } = makeApp("::1");
    const response = await app.request("http://[::1]/", { headers: { Host: "[::1]:43127" } }, { server });
    expect(response.status).toBe(200);
  });

  test("Tailscale 100.x peer refused", async () => {
    const response = await request("100.64.0.7");
    expect(response.status).toBe(403);
  });
});
