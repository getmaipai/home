// CODE-NOTIFY-01: the household's Coding pause switch (`coding.paused`), the twin of lib/chatPause.ts. One reader for the Code app's
// offer test, the key store, the composer line and the Status row.
import { getHouseholdSettingValue } from "@/lib/settings";

export function codingPausedByAdmin(): boolean {
  return getHouseholdSettingValue("coding.paused") === true;
}
