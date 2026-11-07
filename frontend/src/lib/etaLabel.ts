import { i18n } from "@lingui/core";
import { formatUnit } from "@/lib/format";
// GENPREVIEW-01: how long is left on a picture or video, in the words a person reads. The engine counts whole
// seconds from earlier runs of the same size; this rounds them to what is worth saying (i18n._({ id: "about 1 minute left", message: "about 1 minute left", values: {  } })).
export function etaLabel(seconds: number | null | undefined, options: { short?: boolean } = {}): string | undefined {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return undefined;
  if (seconds < 5) return i18n._({ id: "almost done", message: "almost done", values: {  } });
  // The picture card's caption is one line next to the step and the clock, so it gets the short form.
  if (options.short) return seconds < 45 ? i18n._({ id: "{time} left", message: "{time} left", values: { time: formatUnit(Math.round(seconds / 5) * 5, "second", { unitDisplay: "narrow" }) } }) : i18n._({ id: "{time} left", message: "{time} left", values: { time: formatUnit(Math.max(1, Math.round(seconds / 60)), "minute") } });
  if (seconds < 45) return i18n._({ id: "about {n} seconds left", message: "about {n} seconds left", values: { n: Math.round(seconds / 5) * 5 } });
  const minutes = Math.round(seconds / 60);
  if (minutes <= 1) return i18n._({ id: "about 1 minute left", message: "about 1 minute left", values: {  } });
  return i18n._({ id: "about {n} minutes left", message: "about {n} minutes left", values: { n: minutes } });
}
