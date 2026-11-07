import { defineConfig } from "@lingui/cli";
import { FALLBACK_LOCALES, SUPPORTED_LOCALES } from "./src/supportedLocales";

// Session E step 8, i18n scaffolding, decided by the design-resolver
// agent (docs/BACKLOG.md, "Real i18n for the shell/kit/core pages"):
// Lingui, `.po` catalogs under `src/locales/<locale>/`, matching
// `household.locale`'s own real, already-existing option list
// (backend/src/settings/coreKeys.ts) exactly - the one place a locale
// is declared, per the org's "one definition, one place" standard.
export default defineConfig({
  locales: [...SUPPORTED_LOCALES],
  sourceLocale: "en-US",
  fallbackLocales: FALLBACK_LOCALES,
  catalogs: [
    {
      path: `${process.env.MAIPAI_I18N_CATALOGS ?? "<rootDir>/src/locales"}/{locale}/messages`,
      include: ["<rootDir>/src"],
    },
  ],
});
