import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceTokens, people, personCredentials, toolAudit } from "@/db/schema";
import { __resetQuickConnectForTests } from "@/lib/quickConnect";
import { hashDeviceToken } from "@/lib/deviceTokens";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
const consoleOutput: string[] = [];

function captureConsole(method: "log" | "info" | "warn" | "error") {
  console[method] = (...args: unknown[]) => {
    consoleOutput.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "));
  };
}

beforeEach(() => {
  resetDb();
  __resetQuickConnectForTests();
  consoleOutput.length = 0;
  captureConsole("log");
  captureConsole("info");
  captureConsole("warn");
  captureConsole("error");
});

afterEach(() => {
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
});

describe("Quick Connect secret redaction", () => {
  test("pairing, wrong approval, poll, redeem and revoke keep secrets out of logs, audit rows and errors", async () => {
    const owner = new TestClient();
    const personSecret = "pairing-secret-for-test";
    const setup = await owner.post("/api/auth/setup", { displayName: "Sage", secret: personSecret });
    expect(setup.status).toBe(201);
    const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;

    const create = await owner.post("/api/auth/quick-connect/code", { label: "Living room TV", kind: "tv" });
    expect(create.status).toBe(200);
    const { code, poll_token: pollToken } = await create.json() as { code: string; poll_token: string };

    const refusedBodies: unknown[] = [];
    const wrongApproval = await owner.post("/api/auth/quick-connect/approve", { code: "ZZZZZZ" });
    expect(wrongApproval.status).toBe(400);
    refusedBodies.push(await wrongApproval.json());

    const approved = await owner.post("/api/auth/quick-connect/approve", { code });
    expect(approved.status).toBe(200);

    const poll = await new TestClient().get(`/api/auth/quick-connect/poll?poll_token=${encodeURIComponent(pollToken)}`);
    expect(poll.status).toBe(200);
    const pollBody = await poll.json() as { status: string; device_token?: string };
    expect(pollBody.status).toBe("approved");
    const deviceToken = pollBody.device_token!;

    const redeem = await new TestClient().post("/api/auth/devices/redeem", { token: deviceToken });
    expect(redeem.status).toBe(200);
    const storedToken = db.select().from(deviceTokens).get()!;
    const revoke = await owner.delete(`/api/devices/${storedToken.deviceId}`);
    expect(revoke.status).toBe(200);

    // Quick Connect, device token issuance/redeem and revoke write no audit rows today.
    // Keep this table list beside the flow so an added audit write is scanned here too.
    const auditRows = [...db.select().from(toolAudit).all()];
    const persistedTokenHash = hashDeviceToken(deviceToken);
    const personSecretHash = db.select({ secretHash: personCredentials.secretHash }).from(personCredentials).where(eq(personCredentials.personId, person.id)).get()!.secretHash!;
    const observedText = [
      ...consoleOutput,
      ...auditRows.map((row) => JSON.stringify(row)),
      ...refusedBodies.flatMap((body) => {
        const candidate = body as { error?: unknown };
        return typeof candidate.error === "string" ? [candidate.error] : [];
      }),
    ].join("\n");

    for (const [name, secret] of [
      ["pairing code", code],
      ["pairing code hex", Buffer.from(code).toString("hex")],
      ["poll token", pollToken],
      ["device token", deviceToken],
      ["device token hash", persistedTokenHash],
      ["person secret", personSecret],
      ["person secret hash", personSecretHash],
    ]) {
      expect(observedText, `${name} appeared in a log, audit row, or refusal error`).not.toContain(secret);
    }
    expect(auditRows).toHaveLength(0);
    expect(persistedTokenHash).toBe(createHash("sha256").update(deviceToken).digest("hex"));
  });
});
