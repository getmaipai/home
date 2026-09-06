import { describe, expect, test, beforeEach } from "bun:test";
import { TOTP, Secret } from "otpauth";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

const PERIOD_MS = 30_000;

// stepOffset: verifyEnrollment()/the /challenge route both now consume
// the TOTP step they accept (anti-replay) - a test that needs two
// separate valid codes for the same secret asks for a different step.
function codeFromUri(uri: string, stepOffset = 0): string {
  const secret = Secret.fromBase32(new URL(uri).searchParams.get("secret")!);
  return new TOTP({ secret }).generate({ timestamp: Date.now() + stepOffset * PERIOD_MS });
}

describe("TOTP enrollment and sign-in, end to end", () => {
  test("owner/admin only - a teen gets 403 on enroll", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await owner.post("/api/people", { displayName: "Bramble", role: "teen" });
    const teenId = (await created.json()) as { id: string };
    const teenClient = new TestClient();
    await teenClient.post("/api/auth/select", { personId: teenId.id });

    const res = await teenClient.post("/api/auth/totp/enroll", {});
    expect(res.status).toBe(403);
  });

  test("enroll -> verify -> the sign-in gate actually requires the code", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const enrollRes = await client.post("/api/auth/totp/enroll", {});
    expect(enrollRes.status).toBe(200);
    const { uri } = (await enrollRes.json()) as { uri: string };

    // Not enabled until confirmed.
    expect((await (await client.get("/api/auth/totp")).json()) as { enabled: boolean }).toEqual({ enabled: false });

    const verifyRes = await client.post("/api/auth/totp/verify", { token: codeFromUri(uri, -1) });
    expect(verifyRes.status).toBe(200);
    expect((await (await client.get("/api/auth/totp")).json()) as { enabled: boolean }).toEqual({ enabled: true });

    // A fresh sign-in now stops short of a session at the PIN step.
    const fresh = new TestClient();
    const profiles = (await (await fresh.get("/api/auth/profiles")).json()) as Array<{ id: string; display_name: string }>;
    const personId = profiles.find((p) => p.display_name === "Sage")!.id;
    const verifySecretRes = await fresh.post("/api/auth/verify-secret", { personId, secret: "correcthorse" });
    const verifySecretBody = (await verifySecretRes.json()) as { totpRequired: boolean };
    expect(verifySecretBody.totpRequired).toBe(true);
    expect((await fresh.get("/api/auth/me")).status).toBe(401);

    // The real code finishes signing in.
    const challengeRes = await fresh.post("/api/auth/totp/challenge", { personId, token: codeFromUri(uri) });
    expect(challengeRes.status).toBe(200);
    expect((await fresh.get("/api/auth/me")).status).toBe(200);
  });

  // A code review (2026-09-06) found /challenge callable standalone with
  // only per-IP throttling protecting the guess - personId is
  // discoverable via the public profiles list. This proves the added
  // per-person lockout (shared with the PIN/passkey ceremonies,
  // lib/credentialLockout.ts) actually locks the code out after repeated
  // wrong guesses, even from a client that never touched /verify-secret.
  test("repeated wrong codes lock the challenge out, even cold with no prior sign-in attempt", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const enrollRes = await client.post("/api/auth/totp/enroll", {});
    const { uri } = (await enrollRes.json()) as { uri: string };
    await client.post("/api/auth/totp/verify", { token: codeFromUri(uri) });
    const profiles = (await (await client.get("/api/auth/profiles")).json()) as Array<{ id: string; display_name: string }>;
    const personId = profiles.find((p) => p.display_name === "Sage")!.id;

    for (let i = 0; i < 5; i++) {
      const res = await new TestClient().post("/api/auth/totp/challenge", { personId, token: "000000" });
      expect(res.status).toBe(401);
    }

    const locked = await new TestClient().post("/api/auth/totp/challenge", { personId, token: codeFromUri(uri, 1) });
    expect(locked.status).toBe(429);
  });

  test("the challenge refuses a wrong code", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const enrollRes = await client.post("/api/auth/totp/enroll", {});
    const { uri } = (await enrollRes.json()) as { uri: string };
    await client.post("/api/auth/totp/verify", { token: codeFromUri(uri) });

    const profiles = (await (await client.get("/api/auth/profiles")).json()) as Array<{ id: string; display_name: string }>;
    const personId = profiles.find((p) => p.display_name === "Sage")!.id;

    const res = await new TestClient().post("/api/auth/totp/challenge", { personId, token: "000000" });
    expect(res.status).toBe(401);
  });

  test("disable turns off the sign-in gate", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const enrollRes = await client.post("/api/auth/totp/enroll", {});
    const { uri } = (await enrollRes.json()) as { uri: string };
    await client.post("/api/auth/totp/verify", { token: codeFromUri(uri) });

    const disableRes = await client.post("/api/auth/totp/disable", {});
    expect(disableRes.status).toBe(200);

    const fresh = new TestClient();
    const profiles = (await (await fresh.get("/api/auth/profiles")).json()) as Array<{ id: string; display_name: string }>;
    const personId = profiles.find((p) => p.display_name === "Sage")!.id;
    const verifySecretRes = await fresh.post("/api/auth/verify-secret", { personId, secret: "correcthorse" });
    const verifySecretBody = (await verifySecretRes.json()) as { totpRequired: boolean };
    expect(verifySecretBody.totpRequired).toBe(false);
    expect((await fresh.get("/api/auth/me")).status).toBe(200);
  });
});
