export const SUPPORTED_LOCALES = ["en-US", "en-GB", "es"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
