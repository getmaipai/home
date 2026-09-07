// Generates spec/gen/ts/*.ts from spec/schemas/*.schema.json.
// Committed output, not run at build time (platform plan 3, docs/PACKAGES.md).
// Run with: bun run gen:ts (from spec/), then commit the result.
//
// Found live, 2026-09-07 (getmaipai/home, a session running under
// `bun --hot`): a household chat reply failed with a transient ENOENT
// reading `spec/gen/ts/issue.ts`, right as a concurrent `check.sh` run
// (any session's, including this one running check.sh repeatedly) hit
// this script. The original version `rm(OUT_DIR, {recursive: true,
// force: true})`d the WHOLE directory up front, then rebuilt its ~20
// files one at a time (each one a real `$RefParser.dereference()` +
// prettier format, not instant) - for however long that took,
// `spec/gen/ts/` was empty or half-populated, and any live process
// importing from `@maipai/spec/gen/ts/*` during that window (the hub's
// own `lib/issues.ts` imports `issue.ts` from exactly there) got a real,
// reproducible crash. Per-file atomic replace below closes that window
// for the common case (every schema that still exists): at every point
// in time a generated file either has its old, fully-valid content or
// its new one, never neither.
import { readdir, mkdir, writeFile, rm, rename, readFile } from "node:fs/promises";
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

// Writes `content` to `outPath` via a same-directory temp file plus
// `rename()` - a real, atomic replace on every platform this runs on
// (POSIX rename() over an existing FILE, unlike over a non-empty
// directory, is a single inode swap: never a moment where `outPath`
// is missing or partially written). `process.pid` in the temp name
// means two codegen runs racing each other (two sessions' own
// `check.sh` at once - the exact situation the night this was found)
// never collide on the same temp path either.
async function writeFileAtomic(outPath: string, content: string): Promise<void> {
  const tmpPath = `${outPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, content);
  await rename(tmpPath, outPath);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(SCHEMAS_DIR)).filter((f) => f.endsWith(".schema.json"));
  const generated: { fileBase: string; typeName: string }[] = [];
  const writtenFileNames = new Set<string>();

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
    const fileName = `${fileBase}.ts`;
    await writeFileAtomic(join(OUT_DIR, fileName), formatted);
    writtenFileNames.add(fileName);
    generated.push({ fileBase, typeName });
  }

  const indexLines = [
    "// GENERATED FILE. Do not edit by hand.",
    "// Regenerate with: cd spec && bun run gen:ts",
    "",
    ...generated.map((g) => `export * from "./${g.fileBase}.js";`),
    "",
  ];
  await writeFileAtomic(join(OUT_DIR, "index.ts"), indexLines.join("\n"));
  writtenFileNames.add("index.ts");

  // Prunes a file whose own .schema.json source is gone (a schema was
  // deleted since the last run) - a plain delete, not atomic-replaced:
  // nothing should still be importing a generated file with no schema
  // behind it, so this carries none of the live-crash risk the loop
  // above exists to close.
  //
  // A code review on this fix (2026-09-07) caught a real race THIS loop
  // introduced: two `gen-ts.ts` runs overlapping (two sessions' own
  // `check.sh` at once - the exact situation this file's own header
  // documents finding the original bug in) means one process's prune
  // pass can see the OTHER's own in-flight `*.tmp-<pid>` file (written,
  // not yet renamed) and delete it out from under it, so the writer's
  // own `rename()` then throws ENOENT and its whole run crashes. Every
  // `*.tmp-*` name is skipped here unconditionally - a temp file belongs
  // to whichever pid's name it carries, and only that process ever
  // renames or otherwise disposes of it.
  const existingFiles = await readdir(OUT_DIR).catch(() => [] as string[]);
  for (const name of existingFiles) {
    if (name.includes(".tmp-")) continue;
    if (!writtenFileNames.has(name)) await rm(join(OUT_DIR, name)).catch(() => {});
  }

  console.log(`Generated ${generated.length} schema module(s) into spec/gen/ts/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
