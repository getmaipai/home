// I18N-B1b: nothing on the server turns a notification into speech (the alarm ring is a client chime, the robot gets the content-free
// "waiting" form, Telegram is text), so the Spanish spoken line has no call site to wire. These tests pin the rule instead: the helper
// answers Spanish only for a Spanish adult, and every robot payload and every other recipient stays exactly as it was (rule 0).
import { beforeEach, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceCommands, people } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { spokenNotificationLine } from "@/lib/i18nServer";
import { listPending, trigger } from "@/lib/notifications";
import { registerPackageNotificationTypes } from "@/lib/notificationTypes";
import * as settingsLib from "@/lib/settings";
import { toSpokenText } from "@/lib/spokenText";
import type { PersonRow } from "@/types";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => { resetDb(); });

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  return { client, row };
}
async function setPersonSetting(client: TestClient, personId: string, key: string, value: unknown) {
  const res = await client.request("/api/settings", { method: "PUT", body: { scope: `person:${personId}`, key, value } });
  expect(res.status).toBe(200);
}
const refetch = (id: string) => db.select().from(people).where(eq(people.id, id)).get()! as PersonRow;

test("a Spanish adult's alarm, timer and reminder are spoken in Spanish, the time in words", async () => {
  const { client, row } = await owner();
  await setPersonSetting(client, row.id, "person.locale", "es");
  const adult = refetch(row.id);
  expect(spokenNotificationLine(adult, "alarm.due", { task: "gimnasio", time: "7:30 AM" })).toBe("Suena tu alarma de las siete y media de la mañana: gimnasio.");
  expect(spokenNotificationLine(adult, "timer.done", { duration_text: "10 minutos" })).toBe("Tu temporizador de diez minutos terminó.");
  expect(spokenNotificationLine(adult, "remind.due", { task: "llamar a Nadia" })).toBe("Recordatorio: llamar a Nadia.");
});

test("an English adult, and a locale the Spanish table does not cover (en-GB), get null so the stored English text is spoken as before", async () => {
  const { client, row } = await owner();
  for (const locale of ["en-US", "en-GB"]) {
    await setPersonSetting(client, row.id, "person.locale", locale);
    expect(spokenNotificationLine(refetch(row.id), "alarm.due", { task: "gym", time: "7:30 AM" })).toBeNull();
  }
  // The English fallback is the normalizer on the stored text, unchanged.
  expect(toSpokenText("Alarm: gym at 7:30 AM")).toMatchSnapshot();
});

test("a child's spoken line stays English whatever the locale", async () => {
  const { row } = await owner();
  const child = { ...row, birthdate: new Date(Date.now() - 6 * 365 * 86400_000).toISOString().slice(0, 10), role: "child" } as PersonRow;
  const real = settingsLib.getSettingValueForPerson;
  const spy = spyOn(settingsLib, "getSettingValueForPerson").mockImplementation(((id: string, key: string) => key === "person.locale" ? "es" : real(id, key)) as typeof real);
  try { expect(spokenNotificationLine(child, "alarm.due", { task: "x", time: "7:30 AM" })).toBeNull(); } finally { spy.mockRestore(); }
});

test("the robot payload for an alarm is byte-identical for a Spanish and an English adult", async () => {
  setSystemTime(new Date(2026, 9, 6, 12, 0));
  try {
    const { client, row } = await owner();
    issueDeviceToken(row.id, "robot", "Reachy Mini");
    await setPersonSetting(client, row.id, "notifications.time_sensitive.robot", true);
    registerPackageNotificationTypes({ id: "alarm", notifications: [{ id: "alarm.due", level: "time_sensitive", audience: "person", template: "{labelled, select, no {Alarm} other {Alarm: {task}}}", configurable: true, default_channels: ["in_app"] }] });
    const payloads: string[] = [];
    for (const locale of ["en-US", "es"]) {
      await setPersonSetting(client, row.id, "person.locale", locale);
      db.delete(deviceCommands).run();
      await trigger("alarm.due", { task: "gym" }, { personId: row.id });
      const command = db.select().from(deviceCommands).all().find((item) => item.kind === "notify");
      expect(command).toBeDefined();
      payloads.push(command!.payload.replace(/"notification_id":"[^"]*"/, '"notification_id":"X"'));
    }
    expect(payloads[1]).toBe(payloads[0]!);
    expect(payloads[0]).toContain('"form":"waiting"');
    expect(payloads[0]).not.toMatch(/gym|alarma/i);
    expect(listPending(row)[0]?.text).toBe("Alarm: gym");
  } finally { mock.restore(); setSystemTime(); }
});
