/** Local-clock greeting (step 6: "a greeting with the signed-in person's
 * name and time of day"). Takes the hour as a plain number, not a `Date`,
 * so a test can cover every boundary without faking the system clock. */
export function timeOfDay(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function greetingFor(now: Date, displayName: string): string {
  return `Good ${timeOfDay(now.getHours())}, ${displayName}`;
}
