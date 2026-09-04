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

// Every schema's $id lives under this published-but-not-yet-live base URL
// (spec/dev.md explains why: JSON Schema resolves relative $refs against
// $id, so a same-repo $ref like "settings-key.schema.json" needs this base
// mapped back to the local schemas/ dir for tooling that runs before
// anything is actually published there).
const ID_BASE = "https://getmaipai.github.io/home/spec/schemas/";

const localIdResolver = {
  order: 1,
  canRead: (file: { url: string }) => file.url.startsWith(ID_BASE),
  read: async (file: { url: string }) => {
    const local = join(SCHEMAS_DIR, file.url.slice(ID_BASE.length));
    return readFile(local);
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
      resolve: { http: localIdResolver },
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
