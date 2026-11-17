import { afterEach, beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationDeliveries, people, settingsValues } from "@/db/schema";
import { noticeGuestsWithoutControls } from "@/lib/guestControlsNotice";
import { resetDb } from "./reset-db";

function addPerson(id: string, role: string, controls: "child" | "teen" | "adult" | null = null) {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "hub", localOnly: false, createdAt: now, updatedAt: now, hlc: "1:0:test", controls }).run();
}

beforeEach(() => {
  resetDb();
  addPerson("person-admin-guest-controls", "admin");
  const now = new Date();
  const from = new Date(now.getTime() + 2 * 60 * 60_000).toISOString().slice(11, 16);
  const to = new Date(now.getTime() + 3 * 60 * 60_000).toISOString().slice(11, 16);
  const values: Array<[string, string]> = [["time.time_zone", "UTC"], ["person.quiet_hours.from", from], ["person.quiet_hours.to", to]];
  for (const [key, value] of values) {
    db.insert(settingsValues).values({ scope: "person:person-admin-guest-controls", key, value: JSON.stringify(value), hlc: "1:0:test", source: "admin", updatedAt: now.toISOString() }).run();
  }
});
afterEach(resetDb);

test("notifies admins once with the count of live guests missing controls", async () => {
  addPerson("guest-one", "guest");
  addPerson("guest-two", "guest");
  expect(await noticeGuestsWithoutControls()).toBe(2);
  expect(await noticeGuestsWithoutControls()).toBe(2);
  const deliveries = db.select().from(notificationDeliveries).where(and(eq(notificationDeliveries.recipientId, "person-admin-guest-controls"), eq(notificationDeliveries.typeId, "people.guests_without_controls"))).all();
  expect(deliveries).toHaveLength(1);
  expect(JSON.parse(deliveries[0]!.values ?? "{}")).toEqual({ count: "2" });
});

test("does not notify when no live guests are missing controls", async () => {
  addPerson("guest-set", "guest", "teen");
  expect(await noticeGuestsWithoutControls()).toBe(0);
  expect(db.select().from(notificationDeliveries).where(eq(notificationDeliveries.typeId, "people.guests_without_controls")).all()).toHaveLength(0);
});
