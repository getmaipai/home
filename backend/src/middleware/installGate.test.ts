import { expect, test } from "bun:test";
import { Hono } from "hono";
import * as status from "@/lib/installStatus";
import { installGate } from "./installGate";

let current: status.InstallStatus = status.EMPTY_INSTALL;

function app(need: "chat" | "all") {
  const a = new Hono();
  a.use("*", installGate(need, async () => current));
  a.post("/x", (c) => c.json({ ok: true }));
  a.get("/x", (c) => c.json({ ok: true }));
  return a;
}
const make = (over: Partial<status.InstallStatus>): status.InstallStatus => ({ ...status.EMPTY_INSTALL, ...over });
function stub(value: status.InstallStatus) { current = value; }

test("steps aside with no install, and for reads", async () => {
  stub(make({ state: "none" }));
  expect((await app("chat").request("/x", { method: "POST" })).status).toBe(200);
  stub(make({ state: "downloading" }));
  expect((await app("chat").request("/x")).status).toBe(200);
});

test("chat waits for chat, voice and pictures wait for everything", async () => {
  stub(make({ state: "downloading", chatReady: false, percent: 10 }));
  const refused = await app("chat").request("/x", { method: "POST" });
  expect(refused.status).toBe(503);
  expect(((await refused.json()) as { code: string }).code).toBe("ai_installing");
  stub(make({ state: "starter_ready", chatReady: true }));
  expect((await app("chat").request("/x", { method: "POST" })).status).toBe(200);
  expect((await app("all").request("/x", { method: "POST" })).status).toBe(503);
  stub(make({ state: "ready", chatReady: true, complete: true }));
  expect((await app("all").request("/x", { method: "POST" })).status).toBe(200);
});
