import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetQuickConnectForTests } from "@/lib/quickConnect";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import type { DeviceState } from "@/lib/deviceStates";

beforeEach(() => {
  resetDb();
  __resetQuickConnectForTests();
  __resetRateLimiterForTests();
});

describe("Quick Connect end to end", () => {
  test("a TV's code, approved by a signed-in phone, lets the TV poll its way to a session and a device token", async () => {
    const tv = new TestClient();
    const codeRes = await tv.post("/api/auth/quick-connect/code", { label: "Living room TV", kind: "tv" });
    expect(codeRes.status).toBe(200);
    const { code, poll_token } = (await codeRes.json()) as { code: string; poll_token: string };

    // Not yet approved.
    const pendingPoll = await tv.get(`/api/auth/quick-connect/poll?poll_token=${poll_token}`);
    expect((await pendingPoll.json())).toEqual({ status: "pending" });

    const phone = new TestClient();
    await phone.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const approveRes = await phone.post("/api/auth/quick-connect/approve", { code });
    expect(approveRes.status).toBe(200);

    const approvedPoll = await tv.get(`/api/auth/quick-connect/poll?poll_token=${poll_token}`);
    expect(approvedPoll.status).toBe(200);
    const body = (await approvedPoll.json()) as { status: string; device_token: string };
    expect(body.status).toBe("approved");
    expect(typeof body.device_token).toBe("string");

    // The TV's own poll also minted it a real session cookie.
    const tvMe = await tv.get("/api/auth/me");
    expect(tvMe.status).toBe(200);

    // The device token it got back genuinely works via /redeem.
    const secondClient = new TestClient();
    const redeemRes = await secondClient.post("/api/auth/devices/redeem", { token: body.device_token });
    expect(redeemRes.status).toBe(200);

    // A device row now shows up under the approving person's own list.
    const devicesRes = await phone.get("/api/devices");
    const devices = (await devicesRes.json()) as Array<{
      id: string;
      name: string;
      kind: string;
      area: string | null;
      lastSeenAt: string | null;
      createdAt: string;
      capabilities: string[];
      state: DeviceState | null;
    }>;
    expect(devices).toEqual([
      { id: expect.any(String), name: "Living room TV", kind: "tv", area: null, lastSeenAt: expect.any(String), createdAt: expect.any(String), capabilities: [], state: null },
    ]);
  });

  test("the code alone cannot be polled - only the matching poll_token", async () => {
    const tv = new TestClient();
    const codeRes = await tv.post("/api/auth/quick-connect/code", { label: "Living room TV", kind: "tv" });
    const { code } = (await codeRes.json()) as { code: string };

    const phone = new TestClient();
    await phone.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    await phone.post("/api/auth/quick-connect/approve", { code });

    const stolenPoll = await tv.get(`/api/auth/quick-connect/poll?poll_token=${code}`);
    expect((await stolenPoll.json())).toEqual({ status: "expired" });
  });

  test("approving requires a signed-in person", async () => {
    const tv = new TestClient();
    const codeRes = await tv.post("/api/auth/quick-connect/code", { label: "Living room TV", kind: "tv" });
    const { code } = (await codeRes.json()) as { code: string };

    const anon = new TestClient();
    const res = await anon.post("/api/auth/quick-connect/approve", { code });
    expect(res.status).toBe(401);
  });

  // A code review (2026-09-06) found the original version minting a
  // full session and a 365-day device token with no TOTP check anywhere
  // in the flow, even for an owner/admin with TOTP enabled - unlike
  // /verify-secret and /authenticate/verify, which both gate session
  // issuance on it. This proves approving a device now requires a
  // current code when TOTP is on.
  test("approving requires a current TOTP code when the approver has TOTP enabled", async () => {
    const phone = new TestClient();
    await phone.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const enrollRes = await phone.post("/api/auth/totp/enroll", {});
    const { uri } = (await enrollRes.json()) as { uri: string };
    const { TOTP, Secret } = await import("otpauth");
    const codeFromUri = (stepOffset = 0) => {
      const secret = Secret.fromBase32(new URL(uri).searchParams.get("secret")!);
      return new TOTP({ secret }).generate({ timestamp: Date.now() + stepOffset * 30_000 });
    };
    await phone.post("/api/auth/totp/verify", { token: codeFromUri(-1) });

    const tv = new TestClient();
    const codeRes = await tv.post("/api/auth/quick-connect/code", { label: "Living room TV", kind: "tv" });
    const { code } = (await codeRes.json()) as { code: string };

    // No totpToken at all: refused.
    const noTotp = await phone.post("/api/auth/quick-connect/approve", { code });
    expect(noTotp.status).toBe(401);

    // A wrong code: still refused.
    const wrongTotp = await phone.post("/api/auth/quick-connect/approve", { code, totpToken: "000000" });
    expect(wrongTotp.status).toBe(401);

    // The real code: approved.
    const rightTotp = await phone.post("/api/auth/quick-connect/approve", { code, totpToken: codeFromUri() });
    expect(rightTotp.status).toBe(200);
  });

  // A code review (2026-09-27) found the poll route minting a working
  // session cookie for a robot the instant its approval was consumed -
  // there is no shared-device convenience to preserve there the way
  // there is for a phone polling its own request, so the session was
  // pure exposure with no gate on it. A robot only gets a device_token
  // now; deviceAuth.test.ts covers the actual rotation gate at redeem.
  test("a robot's own poll gets a device token but no immediate session, unlike a TV's", async () => {
    const robot = new TestClient();
    const codeRes = await robot.post("/api/auth/quick-connect/code", { label: "Reachy Mini", kind: "robot" });
    const { code, poll_token } = (await codeRes.json()) as { code: string; poll_token: string };

    const phone = new TestClient();
    await phone.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    await phone.post("/api/auth/quick-connect/approve", { code });

    const approvedPoll = await robot.get(`/api/auth/quick-connect/poll?poll_token=${poll_token}`);
    expect(approvedPoll.status).toBe(200);
    const body = (await approvedPoll.json()) as { status: string; device_token: string };
    expect(body.status).toBe("approved");
    expect(typeof body.device_token).toBe("string");

    // No session cookie was set for the polling address, unlike a TV.
    const robotMe = await robot.get("/api/auth/me");
    expect(robotMe.status).toBe(401);

    // The device token itself is real and correctly refused (unrotated),
    // not just missing - the gate lives at redeem, not here.
    const redeemRes = await new TestClient().post("/api/auth/devices/redeem", { token: body.device_token });
    expect(redeemRes.status).toBe(403);
  });
});
