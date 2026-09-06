// `@lingui/vite-plugin` compiles a `.po` catalog on import (no separate
// `lingui compile` step - its own README: "the lingui compile command
// isn't needed when using this plugin"), so TypeScript needs to know
// what importing one actually yields. No official types ship for this
// (checked `node_modules/@lingui/vite-plugin` directly: README and
// reference docs only, no `.d.ts`).
declare module "*.po" {
  import type { Messages } from "@lingui/core";
  export const messages: Messages;
}
