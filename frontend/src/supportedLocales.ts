export const SUPPORTED_LOCALES = ["en-US", "en-GB", "es"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const FALLBACK_LOCALES: Record<string, string | string[]> = {
  "en-GB": "en-US", es: "en-US",
  "en-US-x-child": "en-US", "en-GB-x-child": ["en-GB", "en-US"], "es-x-child": ["es", "en-US"],
  "en-US-x-teen": "en-US", "en-GB-x-teen": ["en-GB", "en-US"], "es-x-teen": ["es", "en-US"],
};

export function localeChain(locale: string): string[] {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) return ["en-US"];
  const fallback = FALLBACK_LOCALES[locale];
  return [locale, ...(Array.isArray(fallback) ? fallback : fallback ? [fallback] : [])];
}

export function fallbackChain(locale: string, mode?: "child" | "teen"): string[] {
  const base = (SUPPORTED_LOCALES as readonly string[]).includes(locale) ? locale : "en-US";
  if (!mode) return localeChain(base);
  const childLocale = `${base}-x-${mode}`;
  const fallback = FALLBACK_LOCALES[childLocale];
  return [childLocale, ...(Array.isArray(fallback) ? fallback : fallback ? [fallback] : [base, "en-US"])];
}
