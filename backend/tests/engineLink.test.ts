import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { __setLinkKeyCommandForTests, derivePairingLookup, hostKeyCheckCode, getLinkCredentialStatus, issuePairingCode, revokeLinkKey } from "@/lib/stack/linkKeys";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { getLinkKeyPaths } from "@/lib/stack/linkKeys";
import { existsSync } from "node:fs";
import { __resetStackLinkControlForTests, setStackLinkControl } from "@/lib/remoteStackSettings";
import { isSecurePairingRequest, pairingSourceAddress, ENGINE_ADDRESS_MISSING_MESSAGE, PAIRING_NEEDS_HTTPS_MESSAGE } from "@/routes/engineLink";

beforeEach(() => { resetDb(); revokeLinkKey(); __setLinkKeyCommandForTests(null); __resetRateLimiterForTests(); __resetStackLinkControlForTests(); });
async function owner(): Promise<TestClient> { const client = new TestClient("192.168.1.40"); await client.post("/api/auth/setup", { displayName: "Owner", secret: "correcthorse" }); return client; }

const HOST_LINE = "192.168.1.40 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPoISQD6sKkxbk5FD8YL6LuvYzhXACmFp4cr8oleBk1h test";

describe("engine link routes", () => {
  test("admin routes require a session and deny a child", async () => {
    expect((await new TestClient().get("/api/engine-link/credentials")).status).toBe(401);
    const admin = await owner(); const created = await admin.post("/api/people", { displayName: "Kid", role: "child" }); const { id } = await created.json() as { id: string };
    const child = new TestClient(); await child.post("/api/auth/select", { personId: id });
    expect((await child.get("/api/engine-link/credentials")).status).toBe(403);
  });
  test("issues pair code for owner and exposes only the derived public GET path", async () => {
    const client = await owner(); setHouseholdSettingValue("engines.stack.where", "another_computer");
    const issued = await client.post("/api/engine-link/pair"); const { code } = await issued.json() as { code: string };
    const lookup = derivePairingLookup(code); expect(lookup).toMatch(/^[\da-f]{32}$/);
    const wrong = await client.get(`/api/engine-link/pair/${code}`); expect(wrong.status).toBe(400);
    const result = await client.get(`/api/engine-link/pair/${lookup}`, { "x-real-ip": "8.8.8.8" }); expect(result.status).toBe(200);
    expect(JSON.stringify(await result.json())).not.toContain(code);
  });
  test("public GET refuses plain HTTP and non-household source", async () => {
    const client = await owner(); setHouseholdSettingValue("engines.stack.where", "another_computer");
    const { code } = await (await client.post("/api/engine-link/pair")).json() as { code: string };
    const plain = await (await import("@/app")).app.request(`http://localhost/api/engine-link/pair/${derivePairingLookup(code)}`);
    expect(plain.status).toBe(400);
    expect(((await plain.json()) as { error: string }).error).toBe(PAIRING_NEEDS_HTTPS_MESSAGE);
    expect((await new TestClient("8.8.8.8").get(`/api/engine-link/pair/${derivePairingLookup(code)}`, { "x-real-ip": "192.168.1.40" })).status).toBe(403);
  });
  // ENGINES-AI-01: the pairing wizard picks the computer in its first step, so a code can be issued before the
  // engine runs on another computer; and the refusals it shows inline say what to fix.
  test("a pairing code is issued while the engine still runs on this computer", async () => {
    const client = await owner();
    expect(getHouseholdSettingValue("engines.stack.where")).toBe("this_computer");
    const issued = await client.post("/api/engine-link/pair");
    expect(issued.status).toBe(200);
    expect(((await issued.json()) as { code: string }).code).toMatch(/^[A-Z2-7]{12}$/);
  });
  test("checking the engine computer with no address says what to enter and where", async () => {
    const client = await owner();
    const refused = await client.post("/api/engine-link/host-key/scan");
    expect(refused.status).toBe(400);
    const message = ((await refused.json()) as { error: string }).error;
    expect(message).toBe(ENGINE_ADDRESS_MISSING_MESSAGE);
    expect(message).toContain("Enter its name or home network address");
    expect(message).toContain("Engines and AI");
  });
  test("an address outside the home network says to use the computer's name or home address", async () => {
    const client = await owner();
    await client.put("/api/settings", { scope: "household", key: "engines.stack.remote.host", value: "192.168.1.20" });
    setHouseholdSettingValue("engines.stack.remote.host", "8.8.8.8");
    const refused = await client.post("/api/engine-link/host-key/scan");
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain("for example 192.168.1.20");
  });

  // PAIR-COPY-01: both refusals say what to do, in the same words, and the words name https://.
  test("starting a pairing over plain HTTP is refused with a message that names the https:// fix", async () => {
    const client = await owner(); setHouseholdSettingValue("engines.stack.where", "another_computer");
    // postForm goes to the app by path, which is a plain http://localhost request, with the owner's cookie.
    const refused = await client.postForm("/api/engine-link/pair", new FormData());
    expect(refused.status).toBe(400);
    const message = ((await refused.json()) as { error: string }).error;
    expect(message).toBe(PAIRING_NEEDS_HTTPS_MESSAGE);
    expect(message).toContain("https://");
    expect(message).toContain("http://");
    expect(message).toContain("Open Home through its https:// address");
    expect(message).not.toContain("\u2014");
    // Over https the same call still works.
    expect((await client.post("/api/engine-link/pair")).status).toBe(200);
  });
  test("source selection trusts the socket and the trusted proxy's rightmost appended hop", () => {
    expect(pairingSourceAddress("192.168.1.40", "8.8.8.8", false)).toBe("192.168.1.40");
    expect(pairingSourceAddress(undefined, "192.168.1.40", false)).toBeNull();
    expect(pairingSourceAddress("10.0.0.2", "8.8.8.8, 192.168.1.40", true)).toBe("192.168.1.40");
    expect(pairingSourceAddress("10.0.0.2", "8.8.8.8", true)).toBe("8.8.8.8");
    expect(pairingSourceAddress("10.0.0.2", undefined, true)).toBeNull();
  });
  test("secure proxy protocol uses the rightmost appended hop", () => {
    expect(isSecurePairingRequest("http:", "https, http", true)).toBe(false);
    expect(isSecurePairingRequest("http:", "http, https", true)).toBe(true);
    expect(isSecurePairingRequest("http:", "https", false)).toBe(false);
  });
  test("pairing completion rebuilds the link from the newly pinned credentials", async () => {
    const client = await owner();
    setHouseholdSettingValue("engines.stack.where", "another_computer");
    setHouseholdSettingValue("engines.stack.remote.host", "192.168.1.40");
    let stopped = 0, refreshed = 0;
    setStackLinkControl({ async stopLocalStack() {}, async startLocalStackAndClearLink() {}, startLink() {}, stopLink() { stopped++; }, refreshLink() { refreshed++; } });
    __setLinkKeyCommandForTests(async () => ({ code: 0, stdout: "192.168.1.40 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPoISQD6sKkxbk5FD8YL6LuvYzhXACmFp4cr8oleBk1h test\n" }));
    const { code } = await (await client.post("/api/engine-link/pair")).json() as { code: string };
    const fetched = await client.get(`/api/engine-link/pair/${derivePairingLookup(code)}`);
    expect(fetched.status).toBe(200);
    const scan = await client.post("/api/engine-link/host-key/scan");
    expect(scan.status).toBe(200);
    expect(await scan.json()).toEqual({ scanned: true });
    const check_code = hostKeyCheckCode(HOST_LINE);
    const confirmed = await client.post("/api/engine-link/host-key/confirm", { check_code });
    expect(confirmed.status).toBe(200);
    expect(getLinkCredentialStatus()).toEqual({ paired: true });
    expect([stopped, refreshed]).toEqual([1, 1]);
  });
  async function pairedUpToScan(client: TestClient) {
    setHouseholdSettingValue("engines.stack.where", "another_computer");
    setHouseholdSettingValue("engines.stack.remote.host", "192.168.1.40");
    setStackLinkControl({ async stopLocalStack() {}, async startLocalStackAndClearLink() {}, startLink() {}, stopLink() {}, refreshLink() {} });
    __setLinkKeyCommandForTests(async () => ({ code: 0, stdout: `${HOST_LINE}\n` }));
    const { code } = await (await client.post("/api/engine-link/pair")).json() as { code: string };
    await client.get(`/api/engine-link/pair/${derivePairingLookup(code)}`);
  }
  test("scan never returns the check code, even when asked", async () => {
    const client = await owner(); await pairedUpToScan(client);
    expect(await (await client.post("/api/engine-link/host-key/scan")).json()).toEqual({ scanned: true });
    expect(await (await client.post("/api/engine-link/host-key/scan", { reveal_check_code: true })).json()).toEqual({ scanned: true });
  });
  test("confirm before a scan says to scan first instead of blaming the code", async () => {
    const client = await owner(); await pairedUpToScan(client);
    const early = await client.post("/api/engine-link/host-key/confirm", { check_code: hostKeyCheckCode(HOST_LINE) });
    expect(early.status).toBe(400);
    expect((await early.json() as { error: string }).error).toContain("Check the engine computer");
    expect(getLinkCredentialStatus()).toEqual({ paired: false });
  });
  test("a wrong typed code is refused with 400 and nothing is pinned; the right one pins", async () => {
    const client = await owner(); await pairedUpToScan(client);
    await client.post("/api/engine-link/host-key/scan");
    const wrong = await client.post("/api/engine-link/host-key/confirm", { check_code: "AAAA-AAAA-AAAA" });
    expect(wrong.status).toBe(400);
    expect(JSON.stringify(await wrong.json())).not.toContain("AAAA");
    expect(getLinkCredentialStatus()).toEqual({ paired: false });
    const right = await client.post("/api/engine-link/host-key/confirm", { check_code: hostKeyCheckCode(HOST_LINE).toLowerCase() });
    expect(right.status).toBe(200);
    expect(getLinkCredentialStatus()).toEqual({ paired: true });
  });
  test("five wrong typed codes lock pairing with 429 and the right code is then refused", async () => {
    const client = await owner(); await pairedUpToScan(client);
    await client.post("/api/engine-link/host-key/scan");
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await client.post("/api/engine-link/host-key/confirm", { check_code: "AAAAAAAAAAAA" })).status);
    expect(statuses).toEqual([400, 400, 400, 400, 429]);
    const after = await client.post("/api/engine-link/host-key/confirm", { check_code: hostKeyCheckCode(HOST_LINE) });
    expect(after.status).toBe(400);
    expect(getLinkCredentialStatus()).toEqual({ paired: false });
  });
  test("public route rate limits by source and globally", async () => {
    const client = await owner(); setHouseholdSettingValue("engines.stack.where", "another_computer");
    const { code } = await (await client.post("/api/engine-link/pair")).json() as { code: string };
    const lookup = derivePairingLookup(code);
    for (let i = 0; i < 5; i++) expect((await client.get(`/api/engine-link/pair/${"f".repeat(32)}`)).status).toBe(400);
    expect((await client.get(`/api/engine-link/pair/${lookup}`)).status).toBe(429);
  });
  test("revoke clears credentials and restores local engine setting", async () => {
    const client = await owner(); setHouseholdSettingValue("engines.stack.where", "another_computer"); issuePairingCode();
    const paths = getLinkKeyPaths(); expect(existsSync(paths.askpassPath)).toBe(false);
    let started = false; setStackLinkControl({ async stopLocalStack() {}, async startLocalStackAndClearLink() { started = true; }, startLink() {}, stopLink() {}, refreshLink() {} });
    const response = await client.request("/api/engine-link/credentials", { method: "DELETE" });
    expect(response.status).toBe(200); expect(getHouseholdSettingValue("engines.stack.where")).toBe("this_computer");
    expect(started).toBe(false); expect(existsSync(paths.askpassPath)).toBe(false);
  });
});
