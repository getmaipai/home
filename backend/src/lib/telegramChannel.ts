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
import { tryConsume, type TokenBucketOptions } from "@/lib/rateLimiter";

const TELEGRAM_API_BASE = "https://api.telegram.org";

// One bot, one household (the settings comment's own "one bot token for
// the whole household"), so one shared key rather than one per chat id -
// the budget this protects is the household's own bot's standing with
// Telegram's API, not any single recipient's. Capacity and rate stay well
// under Telegram's own documented ~1 msg/sec-per-chat guidance even
// counting a burst of several notification types firing for the same
// event across every recipient at once. Session F, step 3/step 0's
// deferred fallback for A's unshipped per-person-limits step
// (docs/plans/wave-2.md).
const TELEGRAM_RATE_LIMIT_KEY = "telegram";
const TELEGRAM_RATE_LIMIT: TokenBucketOptions = { capacity: 10, refillPerSecond: 1 };

export function telegramConfigured(): boolean {
  const botToken = getHouseholdSettingValue("notifications.telegram.bot_token") as string | undefined;
  return typeof botToken === "string" && botToken.length > 0;
}

/** Never throws: a channel failure (bad token, unreachable, an unlinked
 * chat id, or - now - a rate-limited send) is real but must never block
 * the in_app delivery every notification also gets - the same "a channel
 * is a best-effort extra reach, not a dependency" posture
 * packageHost.ts's own `home.call_service` takes toward the caller that
 * triggered it, applied here to a channel instead of a permission.
 * Returns whether it actually sent, for tests and for a future
 * admin-visible delivery log to read. A rate-limited send is simply not
 * sent this time - trigger()'s own `channels` list already only records
 * what was actually attempted, so a caller never sees a false "sent". */
// SEC-10 (code review, 2026-09-06): this had no timeout at all - a
// blackholed api.telegram.org (a home router that drops idle
// connections is a real, ordinary way for that to happen) hung whoever
// awaited this forever. It's awaited inside raiseIssue()/trigger()/
// judgeTurn(), all on the scheduler's own single in-flight promise
// (lib/scheduler.ts) - one stuck Telegram send could wedge every other
// core job right along with it, the identical class of bug COR-2 fixed
// at the LLM client for the same reason.
const DEFAULT_TELEGRAM_TIMEOUT_MS = 5_000;
// Test-only override so a test can prove the timeout actually fires in
// milliseconds, not by waiting out the real 5s default.
let telegramTimeoutMs = DEFAULT_TELEGRAM_TIMEOUT_MS;
export function __setTelegramTimeoutMsForTests(ms: number | null): void {
  telegramTimeoutMs = ms ?? DEFAULT_TELEGRAM_TIMEOUT_MS;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const botToken = getHouseholdSettingValue("notifications.telegram.bot_token") as string | undefined;
  if (!botToken || !chatId) return false;
  if (!tryConsume(TELEGRAM_RATE_LIMIT_KEY, TELEGRAM_RATE_LIMIT)) return false;
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(telegramTimeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
