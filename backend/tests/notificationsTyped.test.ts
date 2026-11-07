import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, notificationDeliveries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setHouseholdSettingValue } from "@/lib/settings";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";
import { getNotificationType, NOTIFICATION_TYPES, registerPackageNotificationTypes } from "@/lib/notificationTypes";
import { NOTIFICATION_COPY } from "@/lib/notificationCopy";
import { NOTIFICATION_ES } from "@/lib/notificationCopyEs";
import { placeholdersOf, renderNotification, renderNotificationFor, spokenNotificationLine } from "@/lib/i18nServer";
import { listPending, trigger } from "@/lib/notifications";
import * as settingsLib from "@/lib/settings";
import { readFileSync } from "node:fs";
import { join } from "node:path";

beforeEach(() => { resetDb(); });

function packageTemplates(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pkg of ["timer", "remind"]) {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../packages", pkg, "manifest.json"), "utf8")) as { notifications: { id: string; template: string }[] };
    for (const n of manifest.notifications) out[n.id] = n.template;
  }
  return out;
}

test("every typed notification has English and Spanish templates with the same placeholders", () => {
  const sources = { ...Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t.id, t.template])), ...packageTemplates() };
  expect(Object.keys(NOTIFICATION_COPY).length).toBeGreaterThanOrEqual(18);
  for (const [typeId, line] of Object.entries(NOTIFICATION_COPY)) {
    expect(line.message).toBe(sources[typeId]!); // the catalog English is the type's own template, byte for byte
    const es = NOTIFICATION_ES[typeId];
    expect(es, typeId).toBeTruthy();
    expect(placeholdersOf(es!), typeId).toEqual(placeholdersOf(line.message));
  }
  expect(Object.keys(NOTIFICATION_ES).sort()).toEqual(Object.keys(NOTIFICATION_COPY).sort());
});

test("protected types (safety, child and teen lines) have no Spanish template", () => {
  for (const id of ["safety.alarm", "safety.flagged_turn", "safety.picture_withheld", "child.worrying_conversation", "person.adult_band_held_needs_secret", "robot.offline"]) {
    expect(NOTIFICATION_COPY[id]).toBeUndefined();
  }
});

test("renderNotification speaks Spanish for es, English for en, and plurals follow the count", () => {
  expect(renderNotification("model.download_ready", { modelName: "Qwen" }, "es")).toBe("La descarga de Qwen terminó. Ya se puede usar.");
  expect(renderNotification("model.download_ready", { modelName: "Qwen" }, "en-GB")).toBe("Qwen finished downloading and is ready to use.");
  expect(renderNotification("backups.target_failing", { target: "NAS", count: "1", message: "x" }, "es")).toContain("1 vez");
  expect(renderNotification("backups.target_failing", { target: "NAS", count: "3", message: "x" }, "es")).toContain("3 veces");
  expect(renderNotification("model.download_ready", {}, "es")).toBeNull();
  expect(renderNotification("repairs.new", { title: "t" }, "es")).toBeNull();
});

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
function registerDue() {
  registerPackageNotificationTypes({ id: "alarm", notifications: [{ id: "alarm.due", level: "time_sensitive", audience: "person", template: "{labelled, select, no {Alarm} other {Alarm: {task}}}", configurable: true, default_channels: ["in_app"] }] });
}

test("a Spanish person gets Spanish in Telegram and the row keeps the English text and the values; an English person gets English", async () => {
  const { client, row } = await owner();
  setHouseholdSettingValue("notifications.telegram.bot_token", "test-token");
  registerDue();
  await setPersonSetting(client, row.id, "notifications.telegram.chat_id", "12345");
  await setPersonSetting(client, row.id, "notifications.alarm.due.telegram", true);
  const sent: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock((_url: string, init?: RequestInit) => { sent.push((JSON.parse(String(init?.body)) as { text: string }).text); return Promise.resolve(new Response("{}", { status: 200 })); }) as unknown as typeof fetch;
  try {
    await setPersonSetting(client, row.id, "person.locale", "es");
    await trigger("alarm.due", { task: "gimnasio" }, { personId: row.id });
    expect(sent).toEqual(["Alarma: gimnasio"]);
    const stored = db.select().from(notificationDeliveries).where(eq(notificationDeliveries.recipientId, row.id)).all();
    expect(stored[0]!.text).toBe("Alarm: gimnasio");
    expect(JSON.parse(stored[0]!.values!)).toEqual({ task: "gimnasio" });
    expect(listPending(row)[0]!.values).toEqual({ task: "gimnasio" });
    await setPersonSetting(client, row.id, "person.locale", "en-US");
    sent.length = 0;
    await trigger("alarm.due", { task: "gym" }, { personId: row.id });
    expect(sent).toEqual(["Alarm: gym"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("a minor recipient is rendered in English whatever the locale", async () => {
  const { row: person } = await owner();
  const child = { ...person, birthdate: new Date(Date.now() - 6 * 365 * 86400_000).toISOString().slice(0, 10), role: "child" } as typeof person;
  const real = settingsLib.getSettingValueForPerson;
  const spy = spyOn(settingsLib, "getSettingValueForPerson").mockImplementation(((id: string, key: string) => key === "person.locale" ? "es" : real(id, key)) as typeof real);
  try {
    expect(renderNotificationFor(child, "model.download_ready", { modelName: "Q" })).toBe("Q finished downloading and is ready to use.");
  } finally { spy.mockRestore(); }
});

test("an old row without values still renders as its stored English text", async () => {
  const { row: person } = await owner();
  db.insert(notificationDeliveries).values({ id: "old1", typeId: "model.download_ready", recipientId: person.id, text: "Old Model finished downloading and is ready to use.", channels: "[\"in_app\"]", createdAt: new Date().toISOString() }).run();
  const row = listPending(person).find((n) => n.id === "old1")!;
  expect(row.values).toBeNull();
  expect(row.text).toBe("Old Model finished downloading and is ready to use.");
  expect(getNotificationType("model.download_ready")).toBeTruthy();
});

test("the Spanish spoken alarm line reads the time in words; English, other lines and minors stay English", async () => {
  const { client, row } = await owner();
  await setPersonSetting(client, row.id, "person.locale", "es");
  const adult = db.select().from(people).where(eq(people.id, row.id)).get()! as PersonRow;
  expect(spokenNotificationLine(adult, "alarm.due", { task: "gimnasio", time: "7:30 AM" })).toBe("Suena tu alarma de las siete y media de la mañana: gimnasio.");
  expect(spokenNotificationLine(adult, "timer.done", { duration_text: "diez minutos" })).toBe("Tu temporizador de diez minutos terminó.");
  expect(spokenNotificationLine(adult, "model.download_ready", { modelName: "x" })).toBeNull();
  await setPersonSetting(client, row.id, "person.locale", "en-US");
  expect(spokenNotificationLine(adult, "alarm.due", { task: "gym", time: "7:30 AM" })).toBeNull();
  const child = { ...adult, birthdate: new Date(Date.now() - 6 * 365 * 86400_000).toISOString().slice(0, 10), role: "child" } as PersonRow;
  const real = settingsLib.getSettingValueForPerson;
  const spy = spyOn(settingsLib, "getSettingValueForPerson").mockImplementation(((id: string, key: string) => key === "person.locale" ? "es" : real(id, key)) as typeof real);
  try { expect(spokenNotificationLine(child, "alarm.due", { task: "x", time: "7:30 AM" })).toBeNull(); } finally { spy.mockRestore(); }
});
