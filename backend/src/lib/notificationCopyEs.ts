// I18N-B1: hand-written Spanish templates for the server's own channels (Telegram), short and gender-neutral. Keyed by notification typeId;
// ICU plurals are allowed. The web bell reads the extracted catalog instead, so the two are checked to carry the same placeholders (tests).
export const NOTIFICATION_ES: Readonly<Record<string, string>> = {
  "engines.chat_engine_changed": "El chat cambió de {from} a {to} con una clave de asistente.",
  "model.download_ready": "La descarga de {modelName} terminó. Ya se puede usar.",
  "model.download_failed": "La descarga de {modelName} falló: {error}",
  "media_time_up": "Se acabó el tiempo diario de pantalla de {name}. Puedes agregar más minutos para hoy.",
  "repairs.still_open": "Sigue sin resolverse: {title}",
  "memory.judge_failed": "Tuve problemas para recordar algo de nuestra conversación.",
  "jobs.admin_stopped": "La administración detuvo esta tarea.",
  "backups.target_failing": "Las copias de seguridad en {target} han fallado {count, plural, one {# vez} other {# veces}} seguidas: {message}",
  "updates.available": "MaiPai Home {version} ya está disponible.",
  "engines.update_available": "Hay una actualización disponible para {name}: {version}.",
  "engines.update_applied": "{name} se actualizó a {tag}.",
  "engines.update_failed": "{name} no se pudo actualizar: {reason}.",
  "engines.problem": "Problema: {title}. {fix}",
  "project.done": "Terminado: {title}.",
  "project.failed": "{title} no terminó: {reason}",
  "alarm.due": "{labelled, select, no {Alarma} other {Alarma: {task}}}",
  "remind.due": "Recordatorio: {task}",
  "timer.done": "Tu temporizador de {duration_text} terminó.",
};
