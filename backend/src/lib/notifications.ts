// The notification system (2026-09-05), scoped to what the hub can
// really deliver today. getmaipai/.github/docs/NOTIFICATIONS.md is the
// full org standard (platform plan 2.6); this is a real, working slice
// of it, not the whole thing, the same "narrower than the full
// description, same discipline as every other slice" call
// lib/scheduler.ts's own header made for jobs. Not a spec 3.1 record
// type - hub-internal, like scheduledJobs/commands (see
// db/schema.ts's notificationDeliveries comment).
//
// What's real here: declared types (lib/notificationTypes.ts), a
// household-wide `adults` and `person` audience, two channels (`in_app` -
// the pending list, always on - and `telegram`, opt-in), a non-
// configurable type that always fires regardless of preference, and a
// thirty-day-center-shaped read/dismiss history (routes/notifications.ts).
//
// What's deferred, named rather than half-built: quiet hours (no
// schedule concept exists yet for any settings key, not just this one -
// scheduler.ts's own header names the identical gap), the `passive`
// digest batching (every level delivers immediately today; a `passive`
// type is stored and readable the same as the others, just not yet
// batched into a scheduled digest), browser push / Go / TV overlay /
// robot speech (no such clients exist yet to receive them), and a real
// `parents_of_child` audience (Person has no parent/guardian link -
// lib/notificationTypes.ts's own comment on why `adults` stands in).
// Package-declared notification types are a real extension point, not
// built: a package would register its own NotificationType the same way
// core's are declared, and get its own settings-key toggle through its
// manifest's `config[]` (already-spec'd, docs/SETTINGS.md), not by
// editing this file.
import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "@/db";
import { notificationDeliveries, people } from "@/db/schema";
import { newNotificationId } from "@/lib/id";
import { getSettingValueForPerson } from "@/lib/settings";
import { sendTelegramMessage } from "@/lib/telegramChannel";
import { isMinorRole } from "@/lib/safety";
import { listActivePeople } from "@/lib/access";
import { getNotificationType, type NotificationChannel, type NotificationType } from "@/lib/notificationTypes";
import type { PersonRow } from "@/types";
import type { Role } from "@/middleware/auth";

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match);
}

function resolveRecipients(type: NotificationType, personId?: string): PersonRow[] {
  if (type.audience === "person") {
    if (!personId) return [];
    const row = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).get();
    return row ? [row] : [];
  }
  const everyone = listActivePeople();
  if (type.audience === "household") return everyone;
  return everyone.filter((p) => !isMinorRole(p.role as Role)); // "adults"
}

/** Which channels actually fire for one recipient. `in_app` always does
 * (it's the audit record, never gated - lib/notificationTypes.ts's own
 * header). `telegram` needs both the type's own channel set (or the
 * recipient's override, if the type is configurable) AND that recipient
 * to have actually linked a chat id - a household that never set up
 * Telegram, or a person who never linked their own chat, silently gets
 * `in_app` only, never an error.
 *
 * A code review (2026-09-05) found the original version returned
 * "telegram" here purely from the preference check, before this
 * function's own chat-id check even ran - so the persisted delivery row
 * (this return value's whole reason for existing, per trigger()'s own
 * "channels actually ATTEMPTED" contract) claimed Telegram was attempted
 * for every household that simply never finished linking a chat id,
 * which is the common case for the non-configurable safety type in
 * particular. `wantsChannel` and the chat-id lookup now both gate the
 * same return value, so a caller never has to re-derive "was it really
 * attempted" from this list a second time the way trigger() used to. */
function resolveChannelsFor(type: NotificationType, recipient: PersonRow): NotificationChannel[] {
  const wantsTelegram = type.configurable
    ? (getSettingValueForPerson(recipient.id, `notifications.${type.id}.telegram`) as boolean | undefined) ??
      type.defaultChannels.includes("telegram")
    : type.defaultChannels.includes("telegram");
  const channels: NotificationChannel[] = ["in_app"];
  if (wantsTelegram) {
    const chatId = getSettingValueForPerson(recipient.id, "notifications.telegram.chat_id") as string | undefined;
    if (chatId) channels.push("telegram");
  }
  return channels;
}

export interface TriggerOptions {
  /** Required when `type.audience === "person"`, ignored otherwise. */
  personId?: string;
}

/** Renders and delivers one declared notification to its whole audience.
 * Never throws: a channel failure is logged into the delivery row's own
 * `channels` list (which channels were actually ATTEMPTED, not which
 * succeeded - lib/telegramChannel.ts's sendTelegramMessage() already
 * swallows its own failures) rather than raised, since notifying is
 * always a side effect of something else that already happened and
 * must never fail the thing that triggered it. */
export async function trigger(typeId: string, vars: Record<string, string> = {}, opts: TriggerOptions = {}): Promise<void> {
  const type = getNotificationType(typeId);
  if (!type) {
    console.error(`[notifications] trigger() called with an undeclared type: ${typeId}`);
    return;
  }
  const recipients = resolveRecipients(type, opts.personId);
  const text = renderTemplate(type.template, vars);

  for (const recipient of recipients) {
    const channels = resolveChannelsFor(type, recipient);
    if (channels.includes("telegram")) {
      // resolveChannelsFor() only ever includes "telegram" once it has
      // already confirmed a real chat id exists, so this is never
      // undefined in practice - re-reading it here (rather than having
      // that function return it alongside the channel list) keeps the
      // settings lookup in exactly one place.
      const chatId = getSettingValueForPerson(recipient.id, "notifications.telegram.chat_id") as string;
      await sendTelegramMessage(chatId, text);
    }
    db.insert(notificationDeliveries)
      .values({
        id: newNotificationId(),
        typeId: type.id,
        recipientId: recipient.id,
        text,
        channels: JSON.stringify(channels),
        createdAt: new Date().toISOString(),
      })
      .run();
  }
}

export interface NotificationDeliveryView {
  id: string;
  typeId: string;
  text: string;
  channels: NotificationChannel[];
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
}

function toView(row: typeof notificationDeliveries.$inferSelect): NotificationDeliveryView {
  return {
    id: row.id,
    typeId: row.typeId,
    text: row.text,
    channels: JSON.parse(row.channels) as NotificationChannel[],
    createdAt: row.createdAt,
    readAt: row.readAt,
    dismissedAt: row.dismissedAt,
  };
}

/** A person's own pending list: not dismissed, newest first - the "toast"
 * surface and the "pending list" surface are the same underlying rows,
 * read the same way; a client tells them apart by which of these it has
 * already shown (see docs/dev.md's writeup for the exact contract). */
export function listPending(actor: PersonRow): NotificationDeliveryView[] {
  return db
    .select()
    .from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.recipientId, actor.id), isNull(notificationDeliveries.dismissedAt)))
    .orderBy(desc(notificationDeliveries.createdAt))
    .all()
    .map(toView);
}

/** The thirty-day center (org doc: "A thirty-day center per person with
 * the digest expanded"): every delivery, dismissed or not, newest first.
 * Actual thirty-day pruning isn't built yet (no retention job for this
 * table - a real, named gap, the same shape conversation history's own
 * ninety-day retention had before runRetention() existed for it). */
export function listHistory(actor: PersonRow): NotificationDeliveryView[] {
  return db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.recipientId, actor.id))
    .orderBy(desc(notificationDeliveries.createdAt))
    .all()
    .map(toView);
}

export type NotificationOpResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404; error: string };

function ownedDelivery(actor: PersonRow, id: string): NotificationOpResult<typeof notificationDeliveries.$inferSelect> {
  const row = db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, id)).get();
  if (!row) return { ok: false, status: 404, error: `no notification ${id}` };
  if (row.recipientId !== actor.id) return { ok: false, status: 403, error: "not your notification" };
  return { ok: true, value: row };
}

export function markRead(actor: PersonRow, id: string): NotificationOpResult<NotificationDeliveryView> {
  const found = ownedDelivery(actor, id);
  if (!found.ok) return found;
  if (!found.value.readAt) {
    db.update(notificationDeliveries).set({ readAt: new Date().toISOString() }).where(eq(notificationDeliveries.id, id)).run();
  }
  return { ok: true, value: toView({ ...found.value, readAt: found.value.readAt ?? new Date().toISOString() }) };
}

export function dismiss(actor: PersonRow, id: string): NotificationOpResult<{ id: string }> {
  const found = ownedDelivery(actor, id);
  if (!found.ok) return found;
  db.update(notificationDeliveries).set({ dismissedAt: new Date().toISOString() }).where(eq(notificationDeliveries.id, id)).run();
  return { ok: true, value: { id } };
}
