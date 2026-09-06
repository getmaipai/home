// Generates docs/api/openapi.json from the live route registrations in
// app.ts (session-f-platform-and-trust.md step 4: "docs/api/ is generated
// from the document by a script check.sh runs and diffs (never hand-
// written)"). Run with: bun run gen:api-docs (from backend/), then commit
// the result - the same "regenerate, diff, fail if out of date" shape
// scripts/gen-settings-registry.ts already established for
// spec/settings/keys.json.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { app } from "../src/app";

const document = app.getOpenAPIDocument({
  openapi: "3.0.0",
  info: { title: "MaiPai Home API", version: "0.1.0" },
});

const outDir = join(import.meta.dir, "..", "..", "docs", "api");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "openapi.json");
writeFileSync(outPath, JSON.stringify(document, null, 2) + "\n");
console.log(`Wrote the OpenAPI document (${Object.keys(document.paths ?? {}).length} paths) to ${outPath}`);
