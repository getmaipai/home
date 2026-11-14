// I18N-B1: the wording of every notification whose text is Home's own prose, as data with no imports (the same shape as failureCopy.ts).
// The key is the notification typeId. The row stores { typeId, values }; the bell renders the descriptor through the catalogs, and the
// server (lib/i18nServer.ts) renders the same descriptor for Telegram. A type missing here (a pass-through like "{title}", the safety,
// child and teen lines, and wording that embeds English from elsewhere) is not translated: its stored English text shows as it is.
/** The English template for each translatable notification type. An i18n magic comment marks each literal so `lingui extract` puts it in the catalogs. */
export interface NotificationLine { id: string; message: string }
export const NOTIFICATION_COPY: Readonly<Record<string, NotificationLine>> = {
  "engines.chat_engine_changed": /*i18n*/ { id: "notification.engines.chat_engine_changed", message: "Chat was switched from {from} to {to} with an assistant key." },
  "model.download_ready": /*i18n*/ { id: "notification.model.download_ready", message: "{modelName} finished downloading and is ready to use." },
  "model.download_failed": /*i18n*/ { id: "notification.model.download_failed", message: "{modelName} failed to download: {error}" },
  "media_time_up": /*i18n*/ { id: "notification.media_time_up", message: "{name}'s daily screen time ran out. You can add more minutes for today." },
  "repairs.still_open": /*i18n*/ { id: "notification.repairs.still_open", message: "Still not fixed: {title}" },
  "memory.judge_failed": /*i18n*/ { id: "notification.memory.judge_failed", message: "I had trouble remembering something from our conversation." },
  "jobs.admin_stopped": /*i18n*/ { id: "notification.jobs.admin_stopped", message: "An admin stopped this job." },
  "backups.target_failing": /*i18n*/ { id: "notification.backups.target_failing", message: "Backups to {target} have failed {count} times in a row: {message}" },
  "updates.available": /*i18n*/ { id: "notification.updates.available", message: "MaiPai Home {version} is available." },
  "engines.update_available": /*i18n*/ { id: "notification.engines.update_available", message: "An update is available for {name}: {version}." },
  "engines.update_applied": /*i18n*/ { id: "notification.engines.update_applied", message: "{name} updated to {tag}." },
  "engines.update_failed": /*i18n*/ { id: "notification.engines.update_failed", message: "{name} could not update: {reason}." },
  "engines.problem": /*i18n*/ { id: "notification.engines.problem", message: "Problem: {title}. {fix}" },
  "project.done": /*i18n*/ { id: "notification.project.done", message: "{title} is ready." },
  "project.failed": /*i18n*/ { id: "notification.project.failed", message: "{title} didn't finish: {reason}" },
  "alarm.due": /*i18n*/ { id: "notification.alarm.due", message: "{labelled, select, no {Alarm} other {Alarm: {task}}}" },
  "safety.alarm_dismissed": /*i18n*/ { id: "notification.safety.alarm_dismissed", message: "The safety alarm in {area} was held for 15 minutes." },
  "remind.due": /*i18n*/ { id: "notification.remind.due", message: "Reminder: {task}" },
  "timer.done": /*i18n*/ { id: "notification.timer.done", message: "Your {duration_text} timer is up." },
};
