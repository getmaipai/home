import { getSettingValueForPerson } from "@/lib/settings";

/** The one visibility check for every companion and personality surface. */
export function companionsAllowed(personId: string): boolean {
  return getSettingValueForPerson(personId, "companions.allowed") !== false;
}
