import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { passkeyCredentials, personCredentials } from "@/db/schema";
import * as passkeys from "@/lib/passkeys";
import { currentLockout, LOCKOUT_THRESHOLD } from "@/lib/credentialLockout";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { household, PASSCODE } from "./fixtures/adultLock";
import { issueDeviceToken } from "@/lib/deviceTokens";

let verifySpy: ReturnType<typeof spyOn> | undefined;
beforeEach(() => { resetDb(); __resetThrottleForTests(); passkeys.__resetPasskeyChallengesForTests(); });
afterEach(() => { verifySpy?.mockRestore(); verifySpy = undefined; });

async function passkeyOnlyAdult() {
  const { adult, teen, row } = await household();
  const person = row("Marlow");
  db.update(personCredentials).set({ secretHash: null }).where(eq(personCredentials.personId, person.id)).run();
  db.insert(passkeyCredentials).values({ id: "adult-key", personId: person.id, publicKey: "fake", counter: 0, transports: "[]", deviceType: "singleDevice", backedUp: false, name: "Phone", createdAt: new Date().toISOString() }).run();
  verifySpy = spyOn(passkeys, "verifyAuthentication").mockResolvedValue({ ok: true });
  return { adult, teen, person };
}

describe("Adult lock passkey credentials", () => {
  test("options are own-screen scoped and a passkey-only adult can unlock and confirm", async () => {
    const { adult } = await passkeyOnlyAdult();
    const options = await adult.client.post("/api/adult-lock/unlock/options");
    expect(options.status).toBe(200);
    expect(typeof (await options.json() as { challenge: string }).challenge).toBe("string");
    const unlocked = await adult.client.post("/api/adult-lock/unlock", { passkey_assertion: { id: "adult-key" }, visit: "test" });
    expect(unlocked.status).toBe(200);
    await adult.client.post("/api/adult-lock/unlock/options");
    expect((await adult.client.post("/api/adult-lock/confirm", { passkey_assertion: { id: "adult-key" }, action: "unmark", item: "job-1" })).status).toBe(200);
  });

  test("wrong assertions count toward adult_unlock, not sign-in, then lock out with the standard 429", async () => {
    const { adult, person } = await passkeyOnlyAdult();
    verifySpy!.mockResolvedValue({ ok: false, code: "passkey_verify_failed" });
    const wrong = await adult.client.post("/api/adult-lock/unlock", { passkey_assertion: { id: "adult-key" } });
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { attemptsLeft: number }).attemptsLeft).toBe(LOCKOUT_THRESHOLD - 1);
    expect(currentLockout(person.id, "adult_unlock")?.failedAttempts).toBe(1);
    expect(currentLockout(person.id, "signin")?.failedAttempts ?? 0).toBe(0);
    for (let i = 1; i < LOCKOUT_THRESHOLD; i++) {
      await adult.client.post("/api/adult-lock/unlock/options");
      await adult.client.post("/api/adult-lock/unlock", { passkey_assertion: { id: "adult-key" } });
    }
    const locked = await adult.client.post("/api/adult-lock/unlock", { passkey_assertion: { id: "adult-key" } });
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ error: "Too many attempts", retryAfter: expect.any(Number) });
  });

  test("an expired or overwritten challenge is not a wrong guess and never locks the person out", async () => {
    const { adult, person } = await passkeyOnlyAdult();
    for (const code of ["passkey_signin_expired", "passkey_not_registered_here"] as const) {
      verifySpy!.mockResolvedValue({ ok: false, code });
      for (let i = 0; i < LOCKOUT_THRESHOLD + 2; i++) {
        const res = await adult.client.post("/api/adult-lock/unlock", { passkey_assertion: { id: "adult-key" } });
        expect(res.status).toBe(401);
      }
    }
    expect(currentLockout(person.id, "adult_unlock")?.failedAttempts ?? 0).toBe(0);
    verifySpy!.mockResolvedValue({ ok: true });
    await adult.client.post("/api/adult-lock/unlock/options");
    expect((await adult.client.post("/api/adult-lock/unlock", { passkey_assertion: { id: "adult-key" }, visit: "t" })).status).toBe(200);
  });

  test("shared or minor screens cannot request options or unlock", async () => {
    const { adult, teen, person } = await passkeyOnlyAdult();
    const deviceToken = issueDeviceToken(person.id, "tv", "Shared screen").token;
    const shared = new TestClient();
    expect((await shared.post("/api/auth/devices/redeem", { token: deviceToken })).status).toBe(200);
    expect((await shared.post("/api/adult-lock/unlock/options")).status).toBe(403);
    expect((await shared.post("/api/adult-lock/unlock", { passkey_assertion: { id: "adult-key" } })).status).toBe(403);
    expect((await teen.client.post("/api/adult-lock/unlock/options")).status).toBe(403);
    expect((await teen.client.post("/api/adult-lock/unlock", { passkey_assertion: { id: "adult-key" } })).status).toBe(403);
  });
});
