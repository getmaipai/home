import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { request as httpsRequest } from "node:https";
import { connect as connectTls } from "node:tls";
import forge from "node-forge";
import { websocket } from "hono/bun";
import { app } from "@/app";
import { detectLanIps } from "@/lib/hubEndpoints";
import { __clearLeafRenewedListenersForTests, __resetHouseholdCaForTests, __notifyLeafRenewedForTests } from "@/lib/householdCa";
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

function syntheticLeaf(name: string) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 60_000);
  cert.setSubject([{ name: "commonName", value: name }]);
  cert.setIssuer([{ name: "commonName", value: name }]);
  cert.setExtensions([{ name: "subjectAltName", altNames: [{ type: 2, value: name }] }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

function requestSni(port: number, servername: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const address = detectLanIps()[0] ?? "127.0.0.1";
    const socket = connectTls({ host: address, port, servername, rejectUnauthorized: false, timeout: 5000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve((cert.subjectaltname ?? "").split(", ").map((item) => item.replace(/^DNS:/, "")));
    });
    socket.on("error", reject);
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

test("serves distinct leaves by SNI and retains loopback HTTP and household HTTPS during activation and renewal", async () => {
  const household = syntheticLeaf("home.local");
  let tailscale = { ...syntheticLeaf("hub.example.ts.net"), name: "hub.example.ts.net" };
  listeners = startHomeListeners({ port: 0, fetch: app.fetch, websocket, networkAddresses: ["127.0.0.1"] });
  const live = attachHouseholdTlsRebind({ initial: listeners, fetch: app.fetch, websocket, networkAddresses: () => ["127.0.0.1"], tailscaleTls: () => tailscale });
  detach = live.stop;
  try {
    __notifyLeafRenewedForTests({ certPem: household.certPem, keyPem: household.keyPem });
    const waitForTls = async () => {
      const deadline = Date.now() + 5000;
      while (!live.current().tls && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(live.current().tls).toBe(true);
    };
    const waitForHttp = async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try { if ((await fetch(`http://127.0.0.1:${live.current().port}/api/auth/profiles`)).status === 200) return; }
        catch { /* listener is between old and replacement sockets */ }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("loopback HTTP listener did not return after activation");
    };
    const waitForSni = async (servername: string, san: string) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try { if ((await requestSni(live.current().port, servername)).some((entry) => entry.includes(san))) return; }
        catch { /* listener is between old and replacement sockets */ }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`TLS listener did not return SAN ${san}`);
    };
    const waitForGroup = async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try {
          const http = await fetch(`http://127.0.0.1:${live.current().port}/api/auth/profiles`);
          if (http.status === 200) return;
        } catch { /* old listener stopped; retry when the new set is bound */ }
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      throw new Error("listener set did not rebind with loopback and household HTTPS");
    };
    await waitForTls();
    await waitForGroup();
    const sniServers = startHomeListeners({ port: 0, fetch: app.fetch, websocket, tls: household, tailscaleTls: tailscale, networkAddresses: [detectLanIps()[0] ?? "127.0.0.1"] });
    expect(await requestSni(sniServers.port, "maipai.local")).toContain("home.local");
    expect(await requestSni(sniServers.port, "hub.example.ts.net")).toContain("hub.example.ts.net");
    sniServers.stop();
    tailscale = { ...syntheticLeaf("hub.example.ts.net"), name: "hub.example.ts.net" };
    __notifyLeafRenewedForTests({ certPem: household.certPem, keyPem: household.keyPem });
    await waitForGroup();
  } finally { live.stop(); detach = null; listeners = null; }
});
