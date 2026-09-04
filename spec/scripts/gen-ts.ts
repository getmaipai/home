// Generates spec/gen/ts/*.ts from spec/schemas/*.schema.json.
// Committed output, not run at build time (platform plan 3, docs/PACKAGES.md).
// Run with: bun run gen:ts (from spec/), then commit the result.
import { readdir, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import $RefParser from "@apidevtools/json-schema-ref-parser";
import { jsonSchemaToZod } from "json-schema-to-zod";
import prettier from "prettier";

const SCHEMAS_DIR = join(import.meta.dir, "..", "schemas");
const OUT_DIR = join(import.meta.dir, "..", "gen", "ts");

// Every schema's $id lives under one of two published-but-not-yet-live base
// URLs (spec/README.md explains why: JSON Schema resolves relative $refs
// against $id, so a same-repo $ref like "settings-key.schema.json" needs
// its base mapped back to a local dir for tooling that runs before
// anything is actually published there). manifest.schema.json's
// data_sources[] $refs the standards-owned PrivacyRow shape cross-repo, the
// same way settings-key.schema.json is $ref'd within this repo.
const LOCAL_ID_BASE = "https://getmaipai.github.io/home/spec/schemas/";
const STANDARDS_ID_BASE = "https://getmaipai.github.io/.github/standards/schemas/";
const STANDARDS_DIR = join(
  process.env.MAIPAI_STANDARDS_DIR ?? join(import.meta.dir, "..", "..", "..", ".github"),
  "standards",
  "schemas",
);

const idResolver = {
  order: 1,
  canRead: (file: { url: string }) =>
    file.url.startsWith(LOCAL_ID_BASE) || file.url.startsWith(STANDARDS_ID_BASE),
  read: async (file: { url: string }) => {
    if (file.url.startsWith(LOCAL_ID_BASE)) {
      return readFile(join(SCHEMAS_DIR, file.url.slice(LOCAL_ID_BASE.length)));
    }
    return readFile(join(STANDARDS_DIR, file.url.slice(STANDARDS_ID_BASE.length)));
  },
};

function pascalCase(id: string): string {
  return id
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(SCHEMAS_DIR)).filter((f) => f.endsWith(".schema.json"));
  const generated: { fileBase: string; typeName: string }[] = [];

  for (const file of files) {
    const path = join(SCHEMAS_DIR, file);
    const dereferenced = await $RefParser.dereference(path, {
      resolve: { http: idResolver },
    } as Parameters<typeof $RefParser.dereference>[1]);
    const fileBase = basename(file, ".schema.json");
    // Match the Python side (datamodel-code-generator names the root class
    // from the schema's "title"), so both bindings expose the same name.
    const title = (dereferenced as { title?: string }).title;
    const typeName = title ? title.replace(/[^a-zA-Z0-9]/g, "") : pascalCase(fileBase);

    const code = jsonSchemaToZod(dereferenced as Record<string, unknown>, {
      name: typeName,
      module: "esm",
      type: true,
      withJsdocs: true,
      zodVersion: 4,
    });

    const header = `// GENERATED FILE. Do not edit by hand.\n// Source: spec/schemas/${file}\n// Regenerate with: cd spec && bun run gen:ts\n\n`;
    const formatted = await prettier.format(header + code + "\n", { parser: "typescript" });
    await writeFile(join(OUT_DIR, `${fileBase}.ts`), formatted);
    generated.push({ fileBase, typeName });
  }

  const indexLines = [
    "// GENERATED FILE. Do not edit by hand.",
    "// Regenerate with: cd spec && bun run gen:ts",
    "",
    ...generated.map((g) => `export * from "./${g.fileBase}.js";`),
    "",
  ];
  await writeFile(join(OUT_DIR, "index.ts"), indexLines.join("\n"));

  console.log(`Generated ${generated.length} schema module(s) into spec/gen/ts/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
