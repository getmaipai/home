import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { decryptBiometricPrintEmbedding } from "@/lib/biometricPrints";
import { db } from "@/db";
import { people, biometricPrints } from "@/db/schema";
import { eq } from "drizzle-orm";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { storeRobotCredential } from "@/lib/robotCredentials";
import type { DeviceKind } from "@/lib/devices";
import { encryptSecret } from "@/lib/secrets";
import { newBiometricPrintId } from "@/lib/id";

beforeEach(() => resetDb());

async function ownerSession(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  return client;
}

async function addPerson(client: TestClient, displayName: string, role: string, secret?: string): Promise<{ id: string }> {
  const res = await client.post("/api/people", { displayName, role, secret });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function sessionFor(personId: string, secret?: string): Promise<TestClient> {
  const client = new TestClient();
  if (secret) {
    await client.post("/api/auth/verify-secret", { personId, secret });
  } else {
    await client.post("/api/auth/select", { personId });
  }
  return client;
}

const SFACE_EMBEDDING = Array.from({ length: 128 }, (_, i) => i / 128);

describe("POST /api/biometric-prints", () => {
  test("an adult can enroll their own face print", async () => {
    const owner = await ownerSession();
    const adult = await addPerson(owner, "Marlow", "adult", "adultpin1");
    const adultClient = await sessionFor(adult.id, "adultpin1");

    const res = await adultClient.post("/api/biometric-prints", { person_id: adult.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; modality: string; dim: number; consented_by_person_id: string; embedding?: number[] };
    expect(created.modality).toBe("face");
    expect(created.dim).toBe(128);
    expect(created.consented_by_person_id).toBe(adult.id);
    // The embedding itself is never in the response - see
    // lib/biometricPrints.ts's own header on why.
    expect(created.embedding).toBeUndefined();
  });

  test("an owner can consent to enroll a child's face print", async () => {
    const owner = await ownerSession();
    const child = await addPerson(owner, "Bramble", "child");

    const res = await owner.post("/api/biometric-prints", { person_id: child.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { consented_by_person_id: string };
    const ownerId = created.consented_by_person_id;
    expect(ownerId).not.toBe(child.id);
  });

  test("an admin cannot enroll a teen without the teen's agreement", async () => {
    const owner = await ownerSession();
    const adminRes = await owner.post("/api/people", { displayName: "Admin", role: "admin", secret: "adminpin1" });
    expect(adminRes.status).toBe(201);
    const admin = (await adminRes.json()) as { id: string };
    const adminClient = await sessionFor(admin.id, "adminpin1");
    const teen = await addPerson(owner, "River", "teen");

    const res = await adminClient.post("/api/biometric-prints", { person_id: teen.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });
    expect(res.status).toBe(403);
  });

  test("a guest cannot enroll their own face without their agreement", async () => {
    const owner = await ownerSession();
    const guest = await addPerson(owner, "Marlow", "guest");
    const guestClient = await sessionFor(guest.id);

    const res = await guestClient.post("/api/biometric-prints", { person_id: guest.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });
    expect(res.status).toBe(403);
  });

  test("an owner cannot enroll a guest's face", async () => {
    const owner = await ownerSession();
    const guest = await addPerson(owner, "Marlow", "guest");

    const res = await owner.post("/api/biometric-prints", { person_id: guest.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });
    expect(res.status).toBe(403);
  });

  test("a child can never consent to their own enrollment, even signed in as themself", async () => {
    const owner = await ownerSession();
    const child = await addPerson(owner, "Bramble", "child");
    const childClient = await sessionFor(child.id);

    const res = await childClient.post("/api/biometric-prints", { person_id: child.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });
    expect(res.status).toBe(403);
  });

  test("an ordinary adult (not owner/admin) cannot enroll a child", async () => {
    const owner = await ownerSession();
    const adult = await addPerson(owner, "Marlow", "adult", "adultpin1");
    const adultClient = await sessionFor(adult.id, "adultpin1");
    const child = await addPerson(owner, "Bramble", "child");

    const res = await adultClient.post("/api/biometric-prints", { person_id: child.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });
    expect(res.status).toBe(403);
  });

  test("an ordinary adult cannot enroll another adult without owner/admin authority", async () => {
    const owner = await ownerSession();
    const a = await addPerson(owner, "Marlow", "adult", "adultpin1");
    const b = await addPerson(owner, "Riff", "adult", "adultpin2");
    const aClient = await sessionFor(a.id, "adultpin1");

    const res = await aClient.post("/api/biometric-prints", { person_id: b.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });
    expect(res.status).toBe(403);
  });

  test("an unknown model_id is refused", async () => {
    const owner = await ownerSession();
    const adult = await addPerson(owner, "Marlow", "adult", "adultpin1");
    const res = await owner.post("/api/biometric-prints", { person_id: adult.id, model_id: "not-a-real-model", embedding: [1, 2, 3] });
    expect(res.status).toBe(400);
  });

  test("an embedding of the wrong dimension is refused", async () => {
    const owner = await ownerSession();
    const adult = await addPerson(owner, "Marlow", "adult", "adultpin1");
    const res = await owner.post("/api/biometric-prints", { person_id: adult.id, model_id: "sface-2021dec", embedding: [1, 2, 3] });
    expect(res.status).toBe(400);
  });

  test("the stored embedding round-trips through encryption exactly", async () => {
    const owner = await ownerSession();
    const adult = await addPerson(owner, "Marlow", "adult", "adultpin1");
    const res = await owner.post("/api/biometric-prints", { person_id: adult.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });
    const created = (await res.json()) as { id: string };
    expect(decryptBiometricPrintEmbedding(created.id)).toEqual(SFACE_EMBEDDING);
  });
});

describe("GET /api/biometric-prints", () => {
  test("lists a person's prints without ever including the embedding", async () => {
    const owner = await ownerSession();
    const adult = await addPerson(owner, "Marlow", "adult", "adultpin1");
    await owner.post("/api/biometric-prints", { person_id: adult.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });

    const list = (await (await owner.get(`/api/biometric-prints?personId=${adult.id}`)).json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]!.embedding).toBeUndefined();
    expect(list[0]!.modality).toBe("face");
  });

  // Code review (2026-09-28): this route had no authorization check at
  // all before the fix - requireAuth alone let any signed-in household
  // member read anyone else's enrollment metadata (whether/when they
  // were biometrically enrolled, and by whom). This is the regression
  // test for that finding.
  test("an unrelated household member cannot list another person's prints", async () => {
    const owner = await ownerSession();
    const child = await addPerson(owner, "Bramble", "child");
    await owner.post("/api/biometric-prints", { person_id: child.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });
    const guest = await addPerson(owner, "Marlow", "guest");
    const guestClient = await sessionFor(guest.id);

    const res = await guestClient.get(`/api/biometric-prints?personId=${child.id}`);
    expect(res.status).toBe(403);
  });

  test("a child can list their own prints even though they could not have consented to them", async () => {
    const owner = await ownerSession();
    const child = await addPerson(owner, "Bramble", "child");
    await owner.post("/api/biometric-prints", { person_id: child.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });
    const childClient = await sessionFor(child.id);

    const res = await childClient.get(`/api/biometric-prints?personId=${child.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as unknown[]).length).toBe(1);
  });

  test("owner/admin can list anyone's prints", async () => {
    const owner = await ownerSession();
    const adult = await addPerson(owner, "Marlow", "adult", "adultpin1");
    await owner.post("/api/biometric-prints", { person_id: adult.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });

    const res = await owner.get(`/api/biometric-prints?personId=${adult.id}`);
    expect(res.status).toBe(200);
  });

  test("listing prints for a nonexistent person is refused", async () => {
    const owner = await ownerSession();
    const res = await owner.get("/api/biometric-prints?personId=person-nonexistent");
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/biometric-prints/:id", () => {
  test("a person can revoke their own print", async () => {
    const owner = await ownerSession();
    const adult = await addPerson(owner, "Marlow", "adult", "adultpin1");
    const adultClient = await sessionFor(adult.id, "adultpin1");
    const created = (await (await owner.post("/api/biometric-prints", { person_id: adult.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING })).json()) as { id: string };

    const res = await adultClient.request(`/api/biometric-prints/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(decryptBiometricPrintEmbedding(created.id)).toBeNull();
  });

  test("an unrelated adult cannot revoke someone else's print", async () => {
    const owner = await ownerSession();
    const a = await addPerson(owner, "Marlow", "adult", "adultpin1");
    const b = await addPerson(owner, "Riff", "adult", "adultpin2");
    const bClient = await sessionFor(b.id, "adultpin2");
    const created = (await (await owner.post("/api/biometric-prints", { person_id: a.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING })).json()) as { id: string };

    const res = await bClient.request(`/api/biometric-prints/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  test("owner/admin can revoke a child's print even though they could not create their own", async () => {
    const owner = await ownerSession();
    const child = await addPerson(owner, "Bramble", "child");
    const created = (await (await owner.post("/api/biometric-prints", { person_id: child.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING })).json()) as { id: string };

    const res = await owner.request(`/api/biometric-prints/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  test("a child can revoke their own print even though they could not have consented to it", async () => {
    const owner = await ownerSession();
    const child = await addPerson(owner, "Bramble", "child");
    const childClient = await sessionFor(child.id);
    const created = (await (await owner.post("/api/biometric-prints", { person_id: child.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING })).json()) as { id: string };

    const res = await childClient.request(`/api/biometric-prints/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  test("revoking an unknown print is a 404", async () => {
    const owner = await ownerSession();
    const res = await owner.request("/api/biometric-prints/print-nonexistent", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

// FACE-03: the device-gated sync route - see middleware/auth.ts's
// requireDeviceSession() and lib/biometricPrints.ts's listPrintsForSync()
// for the reasoning this exercises end to end.
describe("GET /api/biometric-prints/sync", () => {
  async function ownerPersonId(): Promise<{ owner: TestClient; personId: string }> {
    const owner = await ownerSession();
    const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    return { owner, personId: person.id };
  }

  async function deviceSession(personId: string, kind: DeviceKind, capabilities: string[] = []): Promise<TestClient> {
    const { token, deviceId } = issueDeviceToken(personId, kind, "Test device", capabilities);
    if (kind === "robot") storeRobotCredential(deviceId, "192.0.2.10", "pollen", "a-freshly-rotated-password");
    const client = new TestClient();
    const res = await client.post("/api/auth/devices/redeem", { token });
    expect(res.status).toBe(200);
    return client;
  }

  // Bypasses createBiometricPrint()'s KNOWN_MODELS gate (no voice model is
  // pinned yet - this file's own header comment on KNOWN_MODELS says so)
  // to construct a raw row directly, the only way to exercise the voice
  // filter and the tombstone filter against a real row.
  function insertRawPrint(personId: string, modality: "face" | "voice", opts: { deletedAt?: string } = {}): string {
    const id = newBiometricPrintId();
    const now = new Date().toISOString();
    db.insert(biometricPrints)
      .values({
        id,
        personId,
        modality,
        modelId: "sface-2021dec",
        modelSha256: "test-sha256",
        dim: SFACE_EMBEDDING.length,
        embeddingEncrypted: opts.deletedAt ? null : encryptSecret(JSON.stringify(SFACE_EMBEDDING)),
        capturedBy: null,
        consentAt: now,
        consentedByPersonId: personId,
        createdAt: now,
        updatedAt: now,
        deletedAt: opts.deletedAt ?? null,
        hlc: "1700000000000:0:testfix",
      })
      .run();
    return id;
  }

  test("a household admin's own (non-device) session gets 403", async () => {
    const { owner } = await ownerPersonId();
    const res = await owner.get("/api/biometric-prints/sync");
    expect(res.status).toBe(403);
  });

  test("a session tied to a non-robot device gets 403", async () => {
    const { personId } = await ownerPersonId();
    const phone = await deviceSession(personId, "phone", ["camera"]);
    const res = await phone.get("/api/biometric-prints/sync");
    expect(res.status).toBe(403);
  });

  test("a robot device session without the camera capability gets 403", async () => {
    const { personId } = await ownerPersonId();
    const robot = await deviceSession(personId, "robot", []);
    const res = await robot.get("/api/biometric-prints/sync");
    expect(res.status).toBe(403);
  });

  test("a robot device session with the camera capability gets 200 with the full record, embedding included", async () => {
    const { personId } = await ownerPersonId();
    insertRawPrint(personId, "face");
    const robot = await deviceSession(personId, "robot", ["camera"]);

    const res = await robot.get("/api/biometric-prints/sync");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { as_of: string; prints: Array<{ embedding: number[]; modality: string }> };
    expect(typeof body.as_of).toBe("string");
    expect(body.prints).toHaveLength(1);
    expect(body.prints[0]!.modality).toBe("face");
    expect(body.prints[0]!.embedding).toEqual(SFACE_EMBEDDING);
  });

  test("a voice print never appears in the response even when one exists", async () => {
    const { personId } = await ownerPersonId();
    insertRawPrint(personId, "face");
    insertRawPrint(personId, "voice");
    const robot = await deviceSession(personId, "robot", ["camera"]);

    const body = (await (await robot.get("/api/biometric-prints/sync")).json()) as { prints: Array<{ modality: string }> };
    expect(body.prints).toHaveLength(1);
    expect(body.prints.every((p) => p.modality === "face")).toBe(true);
  });

  test("legacy teen and guest face prints are excluded from robot sync", async () => {
    const { owner, personId } = await ownerPersonId();
    const teen = await addPerson(owner, "River", "teen");
    const guest = await addPerson(owner, "Marlow", "guest");
    insertRawPrint(personId, "face");
    insertRawPrint(teen.id, "face");
    insertRawPrint(guest.id, "face");
    const robot = await deviceSession(personId, "robot", ["camera"]);

    const body = (await (await robot.get("/api/biometric-prints/sync")).json()) as { prints: Array<{ person_id: string }> };
    expect(body.prints.map((print) => print.person_id)).toEqual([personId]);
  });

  test("a deleted/tombstoned face print never appears", async () => {
    const { personId } = await ownerPersonId();
    const liveId = insertRawPrint(personId, "face");
    insertRawPrint(personId, "face", { deletedAt: new Date().toISOString() });
    const robot = await deviceSession(personId, "robot", ["camera"]);

    const body = (await (await robot.get("/api/biometric-prints/sync")).json()) as { prints: Array<{ id: string }> };
    expect(body.prints.map((p) => p.id)).toEqual([liveId]);
  });
});

// FACE-02Q (#201): completing a new enrollment replaces the person's
// previous face set, atomically, through one batch route.
describe("POST /api/biometric-prints/enrollments", () => {
  const sample = (n: number, capturedBy: string | null = null) => ({ embedding: SFACE_EMBEDDING.map((v) => v + n / 1000), captured_by: capturedBy });
  const body = (personId: string, samples: unknown[], extra: Record<string, unknown> = {}) => ({ person_id: personId, model_id: "sface-2021dec", samples, ...extra });

  function sage() {
    return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  }
  function rowsFor(personId: string) {
    return db.select().from(biometricPrints).where(eq(biometricPrints.personId, personId)).all();
  }
  function liveIds(personId: string): string[] {
    return rowsFor(personId).filter((r) => r.deletedAt === null).map((r) => r.id).sort();
  }
  function rawPrint(personId: string, modality: "face" | "voice", modelId = "sface-2021dec"): string {
    const id = newBiometricPrintId();
    const now = new Date().toISOString();
    db.insert(biometricPrints)
      .values({
        id, personId, modality, modelId, modelSha256: "test-sha256", dim: 128,
        embeddingEncrypted: encryptSecret(JSON.stringify(SFACE_EMBEDDING)),
        capturedBy: null, consentAt: now, consentedByPersonId: personId, createdAt: now, updatedAt: now, deletedAt: null,
        hlc: "1700000000000:0:testfix",
      })
      .run();
    return id;
  }

  test("a second enrollment tombstones the first set and leaves exactly the new set live", async () => {
    const owner = await ownerSession();
    const me = sage();
    const first = await owner.post("/api/biometric-prints/enrollments", body(me.id, [sample(1), sample(2), sample(3)]));
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { prints: Array<{ id: string }>; replaced: number };
    expect(firstBody.prints).toHaveLength(3);
    expect(firstBody.replaced).toBe(0);
    const oldIds = firstBody.prints.map((p) => p.id).sort();
    const oldHlcs = new Map(rowsFor(me.id).map((r) => [r.id, r.hlc]));

    const second = await owner.post("/api/biometric-prints/enrollments", body(me.id, [sample(4), sample(5)]));
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { prints: Array<{ id: string; embedding?: unknown }>; replaced: number };
    expect(secondBody.replaced).toBe(3);
    expect(secondBody.prints[0]!.embedding).toBeUndefined();
    expect(liveIds(me.id)).toEqual(secondBody.prints.map((p) => p.id).sort());

    for (const row of rowsFor(me.id).filter((r) => oldIds.includes(r.id))) {
      expect(row.embeddingEncrypted).toBeNull();
      expect(row.deletedAt).not.toBeNull();
      expect(row.hlc > oldHlcs.get(row.id)!).toBe(true);
    }
    expect(decryptBiometricPrintEmbedding(oldIds[0]!)).toBeNull();
  });

  test("the robot sync list returns only the new set afterwards", async () => {
    const owner = await ownerSession();
    const me = sage();
    await owner.post("/api/biometric-prints/enrollments", body(me.id, [sample(1), sample(2)]));
    const second = (await (await owner.post("/api/biometric-prints/enrollments", body(me.id, [sample(3)]))).json()) as { prints: Array<{ id: string }> };
    const { listPrintsForSync } = await import("@/lib/biometricPrints");
    expect(listPrintsForSync().map((p) => p.id)).toEqual(second.prints.map((p) => p.id));
  });

  test("another person's prints and this person's voice prints are untouched", async () => {
    const owner = await ownerSession();
    const me = sage();
    const other = await addPerson(owner, "Marlow", "adult", "adultpin1");
    const otherPrint = rawPrint(other.id, "face");
    const myVoice = rawPrint(me.id, "voice");
    rawPrint(me.id, "face");

    const res = await owner.post("/api/biometric-prints/enrollments", body(me.id, [sample(1)]));
    expect(res.status).toBe(201);
    expect(liveIds(other.id)).toEqual([otherPrint]);
    expect(liveIds(me.id)).toContain(myVoice);
    expect(liveIds(me.id)).toHaveLength(2); // the voice print plus the one new face print
  });

  test("an older face model's prints are replaced too", async () => {
    const owner = await ownerSession();
    const me = sage();
    const oldModel = rawPrint(me.id, "face", "sface-2019-old");
    const res = await owner.post("/api/biometric-prints/enrollments", body(me.id, [sample(1)]));
    expect(res.status).toBe(201);
    expect(liveIds(me.id)).not.toContain(oldModel);
  });

  test("replace:false only adds", async () => {
    const owner = await ownerSession();
    const me = sage();
    const existing = rawPrint(me.id, "face");
    const res = await owner.post("/api/biometric-prints/enrollments", body(me.id, [sample(1)], { replace: false }));
    expect(res.status).toBe(201);
    expect(liveIds(me.id)).toContain(existing);
    expect(liveIds(me.id)).toHaveLength(2);
  });

  test("an invalid sample anywhere in the batch saves nothing and leaves the old set live", async () => {
    const owner = await ownerSession();
    const me = sage();
    const existing = rawPrint(me.id, "face");
    const before = rowsFor(me.id);
    const res = await owner.post("/api/biometric-prints/enrollments", body(me.id, [sample(1), { embedding: [1, 2, 3] }]));
    expect(res.status).toBe(400);
    expect(liveIds(me.id)).toEqual([existing]);
    expect(rowsFor(me.id)).toEqual(before);
  });

  test("an unknown model or an empty batch is refused and changes nothing", async () => {
    const owner = await ownerSession();
    const me = sage();
    const existing = rawPrint(me.id, "face");
    expect((await owner.post("/api/biometric-prints/enrollments", { ...body(me.id, [sample(1)]), model_id: "nope" })).status).toBe(400);
    expect((await owner.post("/api/biometric-prints/enrollments", body(me.id, []))).status).toBe(400);
    expect(liveIds(me.id)).toEqual([existing]);
  });

  test("a failure mid-transaction rolls everything back", async () => {
    const owner = await ownerSession();
    const me = sage();
    const existing = rawPrint(me.id, "face");
    const before = rowsFor(me.id);
    const { sqlite } = await import("@/db");
    sqlite.exec("CREATE TRIGGER face02q_boom BEFORE INSERT ON biometric_prints WHEN NEW.captured_by = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END");
    try {
      const res = await owner.post("/api/biometric-prints/enrollments", body(me.id, [sample(1), sample(2), sample(3, "boom")]));
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      sqlite.exec("DROP TRIGGER face02q_boom");
    }
    expect(liveIds(me.id)).toEqual([existing]);
    expect(rowsFor(me.id)).toEqual(before);
  });

  test("an actor who may not enroll this person gets 403 and the old set survives", async () => {
    const owner = await ownerSession();
    const a = await addPerson(owner, "Marlow", "adult", "adultpin1");
    const b = await addPerson(owner, "Nadia", "adult", "adultpin2");
    const existing = rawPrint(b.id, "face");
    const aClient = await sessionFor(a.id, "adultpin1");
    const res = await aClient.post("/api/biometric-prints/enrollments", body(b.id, [sample(1)]));
    expect(res.status).toBe(403);
    expect(liveIds(b.id)).toEqual([existing]);
  });

  test("an admin cannot batch-enroll a teen without the teen's agreement", async () => {
    const owner = await ownerSession();
    const adminRes = await owner.post("/api/people", { displayName: "Admin", role: "admin", secret: "adminpin1" });
    const admin = (await adminRes.json()) as { id: string };
    const adminClient = await sessionFor(admin.id, "adminpin1");
    const teen = await addPerson(owner, "River", "teen");

    const res = await adminClient.post("/api/biometric-prints/enrollments", body(teen.id, [sample(1)]));
    expect(res.status).toBe(403);
    expect(liveIds(teen.id)).toEqual([]);
  });

  test("a guest cannot batch-enroll themself without their agreement", async () => {
    const owner = await ownerSession();
    const guest = await addPerson(owner, "Marlow", "guest");
    const guestClient = await sessionFor(guest.id);

    const res = await guestClient.post("/api/biometric-prints/enrollments", body(guest.id, [sample(1)]));
    expect(res.status).toBe(403);
    expect(liveIds(guest.id)).toEqual([]);
  });

  test("an owner cannot batch-enroll a guest", async () => {
    const owner = await ownerSession();
    const guest = await addPerson(owner, "Marlow", "guest");

    const res = await owner.post("/api/biometric-prints/enrollments", body(guest.id, [sample(1)]));
    expect(res.status).toBe(403);
    expect(liveIds(guest.id)).toEqual([]);
  });

  test("a child cannot replace their own set, and an unauthenticated call is 401", async () => {
    const owner = await ownerSession();
    const child = await addPerson(owner, "Bramble", "child");
    const existing = rawPrint(child.id, "face");
    const childClient = await sessionFor(child.id);
    expect((await childClient.post("/api/biometric-prints/enrollments", body(child.id, [sample(1)]))).status).toBe(403);
    expect(liveIds(child.id)).toEqual([existing]);
    expect((await new TestClient().post("/api/biometric-prints/enrollments", body(child.id, [sample(1)]))).status).toBe(401);
  });

  test("the single-sample POST still works and does not replace anything", async () => {
    const owner = await ownerSession();
    const me = sage();
    const existing = rawPrint(me.id, "face");
    const res = await owner.post("/api/biometric-prints", { person_id: me.id, model_id: "sface-2021dec", embedding: SFACE_EMBEDDING });
    expect(res.status).toBe(201);
    expect(liveIds(me.id)).toHaveLength(2);
    expect(liveIds(me.id)).toContain(existing);
  });
});
