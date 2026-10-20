import { getHouseholdSettingValue } from "@/lib/settings";

export const ROBOTS_OFF_MESSAGE = "Robots are turned off on this home. An admin can turn them on in Settings, Devices.";

export function robotsEnabled(): boolean {
  return getHouseholdSettingValue("home.robots.enabled") === true;
}
