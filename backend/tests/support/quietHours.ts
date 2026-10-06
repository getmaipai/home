import { setHouseholdSettingValue } from "@/lib/settings";

// GATE-FIX-03: bun test runs on UTC, and a notification is held during the
// household's quiet hours (21:00 to 07:00 by default). So from 21:00 UTC
// every test that expects a notification failed until morning. resetDb()
// calls this, so every test starts with quiet hours set to one minute half
// a day away from the real clock; a test about quiet hours sets its own
// window after resetDb(), as notifications.test.ts does.
export function quietHoursAwayFromNow(now: Date = new Date()): void {
  const minutes = (now.getHours() * 60 + now.getMinutes() + 12 * 60) % (24 * 60);
  const at = (total: number) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  setHouseholdSettingValue("household.quiet_hours.from", at(minutes));
  setHouseholdSettingValue("household.quiet_hours.to", at((minutes + 1) % (24 * 60)));
}
