// PERUSE-2026-10-25: the consent ask route. Only the requester or the pictured adult can read or decide; the click issues no session.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { likenessAsks } from "@/db/schema";
import { setValue } from "@/lib/settings";
import { openAsk } from "@/lib/likeness/ask";
import { __setStackTrustForTests } from "@/lib/likeness/proof";
import type { PersonRow } from "@/types";

const row = (id: string) => db.select().from(likenessAsks).where(eq(likenessAsks.id, id)).get()!;
let ownerPerson: PersonRow;

beforeEach(() => { resetDb(); __setStackTrustForTests({ ok: true }); });

describe("the route", () => {
  async function two() {
    const owner = new TestClient();
    const setup = await owner.post("/api/auth/setup", { displayName: "Atlas", secret: "correcthorse" });
    ownerPerson = ((await setup.json()) as { person: PersonRow }).person;
    const signIn = async (displayName: string) => {
      const made = await owner.post("/api/people", { displayName, role: "adult", secret: "0000" });
      const created = (await made.json()) as { id: string };
      const client = new TestClient();
      await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
      return { client, id: created.id };
    };
    return { owner, requester: await signIn("Quill"), subject: await signIn("Willow"), other: await signIn("Marsh") };
  }

  test("requires sign-in, and only the requester or the pictured adult can read or decide", async () => {
    const { requester, subject, other } = await two();
    expect(setValue(ownerPerson, "household", "likeness.per_use", true).ok).toBe(true);
    const asked = openAsk({ subjectId: subject.id, requesterId: requester.id, medium: "video", prompt: "Willow dancing", count: 1, styleName: "Willow", styleIds: ["s1"], source: "chat" });
    if (!asked.ok) throw new Error(asked.line);
    const url = `/api/likeness/asks/${asked.id}`;
    expect((await new TestClient().get(url)).status).toBe(401);
    expect((await other.client.get(url)).status).toBe(404);
    expect((await other.client.post(`${url}/decide`, { decision: "consent" })).status).toBe(404);
    const seen = await subject.client.get(url);
    expect(seen.status).toBe(200);
    expect(await seen.json()).toMatchObject({ prompt: "Willow dancing", as: "subject", medium: "video", state: "waiting" });
    expect((await subject.client.get("/api/likeness/asks").then((r) => r.json()) as { asks: unknown[] }).asks).toHaveLength(1);
    expect((await other.client.get("/api/likeness/asks").then((r) => r.json()) as { asks: unknown[] }).asks).toHaveLength(0);
    expect((await subject.client.post(`${url}/decide`, { decision: "maybe" })).status).toBe(400);
  });

  test("Consent and Decline work over the route, issue no new session and a second click is a plain 409", async () => {
    const { requester, subject } = await two();
    expect(setValue(ownerPerson, "household", "likeness.per_use", true).ok).toBe(true);
    const asked = openAsk({ subjectId: subject.id, requesterId: requester.id, medium: "picture", prompt: "Willow at the lake", count: 2, styleName: "Willow", styleIds: ["s1"], source: "chat" });
    if (!asked.ok) throw new Error(asked.line);
    const url = `/api/likeness/asks/${asked.id}`;
    const clicked = await requester.client.post(`${url}/decide`, { decision: "consent" });
    expect(clicked.status).toBe(200);
    expect(clicked.headers.get("set-cookie")).toBeNull();
    expect(await clicked.json()).toEqual({ state: "approved" });
    expect((await subject.client.post(`${url}/decide`, { decision: "decline" })).status).toBe(409);
    expect(row(asked.id).decidedBy).toBe("requester");
  });
});
