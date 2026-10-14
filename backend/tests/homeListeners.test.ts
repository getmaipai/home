import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { request as httpsRequest } from "node:https";
import { websocket } from "hono/bun";
import { app } from "@/app";
import { detectLanIps } from "@/lib/hubEndpoints";
import { __clearLeafRenewedListenersForTests, __resetHouseholdCaForTests } from "@/lib/householdCa";
import { attachHouseholdTlsRebind, startHomeListeners, type HomeListenerSet } from "@/lib/homeListeners";
import { __resetFixHandlersForTests } from "@/lib/issues";
import { __resetSecretsKeyCacheForTests } from "@/lib/secrets";
import { resetDb } from "./reset-db";

let listeners: HomeListenerSet | null = null;
let detach: (() => void) | null = null;
let rebindError: unknown = null;

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
  __resetHouseholdCaForTests();
  __clearLeafRenewedListenersForTests();
  __resetSecretsKeyCacheForTests();
  rebindError = null;
});

afterEach(() => {
  if (detach) detach();
  else listeners?.stop();
  detach = null;
  listeners = null;
  __clearLeafRenewedListenersForTests();
});

function requestHttpsStatus(address: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      hostname: address,
      port,
      path: "/api/auth/profiles",
      method: "GET",
      rejectUnauthorized: false,
      timeout: 5000,
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end();
  });
}

async function startAndMint() {
  const networkAddress = detectLanIps()[0];
  if (!networkAddress) return null;

  listeners = startHomeListeners({ port: 0, fetch: app.fetch, websocket });
  const port = listeners.port;
  const live = attachHouseholdTlsRebind({
    initial: listeners,
    fetch: app.fetch,
    websocket,
    networkAddresses: detectLanIps,
    onBound: (next) => { listeners = next; },
    onFailure: (error) => { rebindError = error; },
  });
  detach = live.stop;

  const response = await fetch(`http://127.0.0.1:${port}/api/setup/ca`);
  expect(response.status).toBe(200);
  await response.arrayBuffer();

  const deadline = Date.now() + 5000;
  while (!live.current().tls && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  expect(live.current().tls).toBe(true);
  expect(rebindError).toBeNull();
  return { port, networkAddress, live };
}

describe("first household certificate mint and live listeners", () => {
  test("plain HTTP on localhost keeps answering after the first mint", async () => {
    const started = await startAndMint();
    if (!started) return;

    const response = await fetch(`http://localhost:${started.port}/api/auth/profiles`);
    expect(response.status).toBe(200);
    started.live.stop();
  });

  test("the detected network address answers on HTTPS after the first mint", async () => {
    const started = await startAndMint();
    if (!started) return;

    expect(await requestHttpsStatus(started.networkAddress, started.port)).toBe(200);
    started.live.stop();
  });
});
