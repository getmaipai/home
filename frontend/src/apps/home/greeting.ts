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
  return /\bfamily$/i.test(name) ? name : `${name} Family`;
}

export function greetingFor(now: Date, displayName: string): string {
  return `Good ${timeOfDay(now.getHours())}, ${displayName}`;
}
