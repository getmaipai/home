import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { decryptBiometricPrintEmbedding } from "@/lib/biometricPrints";

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
