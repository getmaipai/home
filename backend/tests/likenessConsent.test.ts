// LIKENESS-01: the two consent switches are the person's own and an adult's alone. A child, a teen or a guest can never write
// them; an owner or admin can take someone's agreement away (off) but never give it (on); every change is recorded.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { getSettingValueForPerson, setValue } from "@/lib/settings";
import { consentHistory, consentState } from "@/lib/likeness/consent";
import type { PersonRow } from "@/types";

beforeEach(() => resetDb());

async function household() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const add = async (displayName: string, role: string) => {
    expect((await client.post("/api/people", { displayName, role, ...(role === "adult" ? { secret: "0000" } : {}) })).status).toBe(201);
    return db.select().from(people).where(eq(people.displayName, displayName)).get()! as PersonRow;
  };
  const owner = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  return { owner, child: await add("Bramble", "child"), teen: await add("Rill", "teen"), adult: await add("Marlow", "adult"), other: await add("Nadia", "adult") };
}
const write = (actor: PersonRow, target: PersonRow, key: string, value: boolean) => setValue(actor, `person:${target.id}`, key, value);

describe("who can write the likeness switches", () => {
  for (const key of ["likeness.adults", "likeness.adult_content"]) {
    test(`${key}: a child, a teen and a guest never write it, on or off`, async () => {
      const { child, teen, adult } = await household();
      const guest = { ...adult, role: "guest" } as PersonRow;
      for (const person of [child, teen, guest]) {
        for (const value of [true, false]) expect(write(person, person, key, value).ok).toBe(false);
      }
      expect(consentState(child.id)).toEqual({ adults: false, adultContent: false });
      expect(getSettingValueForPerson(child.id, key)).toBe(false);
    });
    test(`${key}: an adult writes their own; nobody else turns it on`, async () => {
      const { owner, adult, other, child } = await household();
      if (key === "likeness.adult_content") expect(write(adult, adult, "likeness.adults", true).ok).toBe(true);
      expect(write(adult, adult, key, true).ok).toBe(true);
      expect(write(other, adult, key, true).ok).toBe(false);
      expect(write(owner, other, key, true).ok).toBe(false);
      // Not even an owner can switch it on for a child or a teen.
      expect(write(owner, child, key, true).ok).toBe(false);
    });
    test(`${key}: an owner or admin can only take agreement away, another adult cannot`, async () => {
      const { owner, adult, other } = await household();
      expect(write(adult, adult, "likeness.adults", true).ok).toBe(true);
      expect(write(adult, adult, key, true).ok).toBe(true);
      expect(write(other, adult, key, false).ok).toBe(false);
      expect(write(owner, adult, key, false).ok).toBe(true);
      expect(getSettingValueForPerson(adult.id, key)).toBe(false);
    });
  }
});

describe("the record of a change", () => {
  test("each real change is recorded once with its time, and turning the first switch off turns the second off", async () => {
    const { adult } = await household();
    expect(write(adult, adult, "likeness.adults", true).ok).toBe(true);
    expect(write(adult, adult, "likeness.adults", true).ok).toBe(true);
    expect(write(adult, adult, "likeness.adult_content", true).ok).toBe(true);
    expect(consentState(adult.id)).toEqual({ adults: true, adultContent: true });
    expect(write(adult, adult, "likeness.adults", false).ok).toBe(true);
    expect(consentState(adult.id)).toEqual({ adults: false, adultContent: false });
    expect(getSettingValueForPerson(adult.id, "likeness.adult_content")).toBe(false);
    const history = consentHistory(adult.id).map((event) => `${event.option}:${event.state}`).sort();
    expect(history).toEqual(["adult_content:off", "adult_content:on", "adults:off", "adults:on"]);
    // Back on later: adult content does not come back by itself.
    expect(write(adult, adult, "likeness.adults", true).ok).toBe(true);
    expect(consentState(adult.id)).toEqual({ adults: true, adultContent: false });
  });
  test("the second switch counts only while the first is on", async () => {
    const { adult } = await household();
    expect(write(adult, adult, "likeness.adult_content", true).ok).toBe(true);
    expect(consentState(adult.id)).toEqual({ adults: false, adultContent: false });
  });
});
