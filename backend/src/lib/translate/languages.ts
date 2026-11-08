export const LANGUAGES: Record<string, { english: string; native: string }> = {
  en: { english: "English", native: "English" },
  es: { english: "Spanish", native: "Español" },
  fr: { english: "French", native: "Français" },
  de: { english: "German", native: "Deutsch" },
  it: { english: "Italian", native: "Italiano" },
  pt: { english: "Portuguese", native: "Português" },
  nl: { english: "Dutch", native: "Nederlands" },
  pl: { english: "Polish", native: "Polski" },
  sv: { english: "Swedish", native: "Svenska" },
  tr: { english: "Turkish", native: "Türkçe" },
  ru: { english: "Russian", native: "Русский" },
  uk: { english: "Ukrainian", native: "Українська" },
  ja: { english: "Japanese", native: "日本語" },
  ko: { english: "Korean", native: "한국어" },
  zh: { english: "Chinese", native: "中文" },
  ar: { english: "Arabic", native: "العربية" },
  hi: { english: "Hindi", native: "हिन्दी" },
  he: { english: "Hebrew", native: "עברית" },
};

export function languageName(code: string): string | undefined {
  return LANGUAGES[code]?.english;
}

export function isKnownLanguage(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, code);
}
