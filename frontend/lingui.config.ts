import { defineConfig } from "@lingui/cli";

// Session E step 8, i18n scaffolding, decided by the design-resolver
// agent (docs/BACKLOG.md, "Real i18n for the shell/kit/core pages"):
// Lingui, `.po` catalogs under `src/locales/<locale>/`, matching
// `household.locale`'s own real, already-existing option list
// (backend/src/settings/coreKeys.ts) exactly - the one place a locale
// is declared, per the org's "one definition, one place" standard.
export default defineConfig({
  locales: ["en-US", "en-GB"],
  sourceLocale: "en-US",
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["<rootDir>/src"],
    },
  ],
});
