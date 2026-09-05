// The Telegram delivery channel (2026-09-05, lib/notifications.ts). A
// direct hub-to-Telegram connection with the household's own bot token,
// never a MaiPai-operated relay - the same "connects directly from their
// hub to that service with credentials stored locally" shape
// getmaipai/.github/CLAUDE.md's Privacy architecture requires of every
// outbound integration, and the reason this needs its own row in
// lib/privacy.ts's platform connections table (unlike Home Assistant,
// which stays off that page because it's the household's own LAN device,
// not a third party).
import { getHouseholdSettingValue } from "@/lib/settings";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  const botToken = getHouseholdSettingValue("notifications.telegram.bot_token") as string | undefined;
  return typeof botToken === "string" && botToken.length > 0;
}

/** Never throws: a channel failure (bad token, unreachable, an unlinked
 * chat id) is real but must never block the in_app delivery every
 * notification also gets - the same "a channel is a best-effort extra
 * reach, not a dependency" posture packageHost.ts's own `home.call_service`
 * takes toward the caller that triggered it, applied here to a channel
 * instead of a permission. Returns whether it actually sent, for tests
 * and for a future admin-visible delivery log to read. */
export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const botToken = getHouseholdSettingValue("notifications.telegram.bot_token") as string | undefined;
  if (!botToken || !chatId) return false;
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
