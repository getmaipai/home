// CHAT-PAUSE-01: the household's chat pause switch (Settings > AI), read by
// the health row (so the existing composer line, Send hold and Welcome state
// show it) and by the turn routes (so no client can get around it).
import { getHouseholdSettingValue } from "@/lib/settings";

export function chatPausedByAdmin(): boolean {
  return getHouseholdSettingValue("chat.paused") === true;
}

export function chatPauseMessage(): string | null {
  const value = getHouseholdSettingValue("chat.paused_message");
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}
