import { i18n } from "@lingui/core";
/** Local-clock greeting (step 6: "a greeting with the signed-in person's
 * name and time of day"). Takes the hour as a plain number, not a `Date`,
 * so a test can cover every boundary without faking the system clock. */
export function timeOfDay(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** The household's family name for the line above the greeting ("Willow" becomes "Willow Family"), or null when none is set.
 * A name that already ends in "Family" is shown as typed. */
export function familyLabel(familyName: unknown): string | null {
  if (typeof familyName !== "string") return null;
  const name = familyName.trim();
  if (!name) return null;
  return /\bfamily$/i.test(name) ? name : i18n._({ id: "{name} Family", message: "{name} Family", values: { name } });
}

export function greetingFor(now: Date, displayName: string): string {
  const part = timeOfDay(now.getHours());
  if (part === "morning") return i18n._({ id: "Good morning, {displayName}", message: "Good morning, {displayName}", values: { displayName } });
  if (part === "afternoon") return i18n._({ id: "Good afternoon, {displayName}", message: "Good afternoon, {displayName}", values: { displayName } });
  return i18n._({ id: "Good evening, {displayName}", message: "Good evening, {displayName}", values: { displayName } });
}
