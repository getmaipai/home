import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../../tests/reset-db";
import { db } from "@/db";
import { deviceCommands, people } from "@/db/schema";
import { createHostedRobot } from "@/lib/devices";
import { notifySevereWeatherAlerts, __resetWeatherAlertsForTests } from "@/lib/weatherAlerts";
import { setHouseholdSettingValue } from "@/lib/settings";
import { owner } from "../../tests/support/testAuth";
import { dismiss, __resetForTests } from "@/lib/sceneSuppression";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { registerPackageNotificationTypes } from "@/lib/notificationTypes";

const ends = new Date(Date.now() + 60 * 60_000).toISOString();
const alert = (severity: string, overrides: Record<string, unknown> = {}) => ({ id: "alert-robot-1", event: "TORNADO WARNING", headline: "Do not say this headline", severity, area: "Secret place", ends, ...overrides });

let householdOwner: import("@/types").PersonRow;
let householdClient: import("../../tests/client").TestClient;
beforeEach(async () => {
  resetDb(); __resetWeatherAlertsForTests(); __resetForTests(); __resetRateLimiterForTests();
  const result = await owner(); householdOwner = result.row; householdClient = result.client;
  registerPackageNotificationTypes({ id: "weather", notifications: [{ id: "weather.alert", level: "time_sensitive", audience: "household", template: "{event}: {headline}", configurable: true, default_channels: ["in_app"] }] });
  setHouseholdSettingValue("weather.alerts", true);
});
afterEach(() => { __resetWeatherAlertsForTests(); __resetForTests(); setHouseholdSettingValue("weather.alerts", false); });

function commands() { return db.select().from(deviceCommands).all().filter((row) => row.kind === "announce").map((row) => ({ deviceId: row.deviceId, ...JSON.parse(row.payload) as { text: string; urgent: boolean } })); }

async function familyRobots() {
  await householdClient.post("/api/people", { displayName: "Poppy", role: "child", secret: "child-secret" });
  await householdClient.post("/api/people", { displayName: "Bramble", role: "teen" });
  const childRow = db.select().from(people).all().find((person) => person.displayName === "Poppy")!;
  const teenRow = db.select().from(people).all().find((person) => person.displayName === "Bramble")!;
  return {
    adultRobot: createHostedRobot("Adult robot", householdOwner.id),
    childRobot: createHostedRobot("Child robot", childRow.id),
    teenRobot: createHostedRobot("Teen robot", teenRow.id),
  };
}

describe("weather alert robot announcements", () => {
  test("extreme reaches adult, teen and child robots with fixed child wording", async () => {
    const robots = await familyRobots();
    await notifySevereWeatherAlerts([alert("Extreme")]);
    expect(commands()).toHaveLength(3);
    expect(commands().find((command) => command.deviceId === robots.childRobot.id)).toEqual({ deviceId: robots.childRobot.id, text: "There is a weather warning. Please go to a safe place and find a grown-up.", urgent: true });
    expect(commands().find((command) => command.deviceId === robots.adultRobot.id)?.text).toMatch(/^A tornado warning is in effect here until \d{1,2}:\d{2} (am|pm)\.$/);
    expect(commands().every((command) => command.urgent)).toBe(true);
  });

  test("severe skips child, quiet hours skip severe, and extreme overrides quiet hours", async () => {
    await familyRobots();
    setHouseholdSettingValue("household.quiet_hours.from", "00:00");
    setHouseholdSettingValue("household.quiet_hours.to", "23:59");
    await notifySevereWeatherAlerts([alert("Severe")]);
    expect(commands()).toHaveLength(0);
    await notifySevereWeatherAlerts([alert("Extreme", { id: "extreme-quiet" })]);
    expect(commands()).toHaveLength(3);
  });

  test("once per robot and severity upgrade speaks once more", async () => {
    await familyRobots();
    await notifySevereWeatherAlerts([alert("Severe")]);
    const initial = commands().length;
    await notifySevereWeatherAlerts([alert("Severe")]);
    expect(commands()).toHaveLength(initial);
    await notifySevereWeatherAlerts([alert("Extreme")]);
    expect(commands()).toHaveLength(initial + 3);
  });

  test("self and household dismissals suppress only their affected robot owners", async () => {
    const robots = await familyRobots();
    dismiss({ kind: "weather_alert", scope: "self", personId: robots.adultRobot.personId, refId: "alert-robot-1", reason: "handled", now: Date.now(), untilOverrideMs: Date.now() + 60_000, byBand: "child", byConfirmedAdult: false });
    dismiss({ kind: "weather_alert", scope: "household", refId: "household-other-alert", reason: "handled", now: Date.now(), untilOverrideMs: Date.now() + 60_000, byBand: "adult", byConfirmedAdult: true });
    await notifySevereWeatherAlerts([alert("Extreme")]);
    expect(commands().map((command) => command.deviceId)).toEqual([robots.childRobot.id, robots.teenRobot.id]);
  });

  test("template excludes headline, place and coordinates and sanitizes flagged event text", async () => {
    await familyRobots();
    await notifySevereWeatherAlerts([alert("Severe", { event: "  TORNADO!!!  ", headline: "headline coords 47.6,-122.3", area: "Secret place" })]);
    expect(commands().every(({ text }) => /^A tornado!!! is in effect here until \d{1,2}:\d{2} (am|pm)\.$/.test(text))).toBe(true);
    expect(commands().every(({ text }) => !/headline|Secret|47\.6|-122\.3/.test(text))).toBe(true);
    await notifySevereWeatherAlerts([alert("Severe", { id: "flagged-event", event: "I want to kill myself" })]);
    expect(commands().find(({ text }) => text.includes("severe weather alert"))?.text).toBe("A severe weather alert is in effect here.");
  });
});
