// Prepares spec/schemas.resolved/ (gitignored build output) for
// datamodel-code-generator, which resolves a same-directory $ref natively
// but has no notion of the cross-repo $id base @maipai/standards schemas
// use. Rather than running a general JSON Schema resolver over every file
// (tried first; $RefParser's .dereference() inlines recipe.schema.json's
// *internal* #/$defs/step oneOf too, which turns its seven named step
// types into a pile of duplicate Steps1..6/Step1..7 classes, and .bundle()
// avoids that but json-schema-to-zod can't follow the resulting pointers
// either, see gen-ts.ts), this copies every schema file byte-for-byte and
// only rewrites the specific cross-repo $ref strings found, to a local
// relative path, after copying the referenced standards schema alongside
// them. Every other schema, and every internal $ref, is untouched, so
// datamodel-code-generator sees exactly what it saw before this existed.
import { readdir, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";

const SCHEMAS_DIR = join(import.meta.dir, "..", "schemas");
const OUT_DIR = join(import.meta.dir, "..", "schemas.resolved");
const STANDARDS_ID_BASE = "https://getmaipai.github.io/.github/standards/schemas/";
const STANDARDS_SCHEMAS_DIR = join(
  process.env.MAIPAI_STANDARDS_DIR ?? join(import.meta.dir, "..", "..", "..", ".github"),
  "standards",
  "schemas",
);

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(SCHEMAS_DIR)).filter((f) => f.endsWith(".schema.json"));
  const neededStandardsSchemas = new Set<string>();

  for (const file of files) {
    let text = await readFile(join(SCHEMAS_DIR, file), "utf-8");
    const refs = text.matchAll(new RegExp(`"\\$ref":\\s*"${STANDARDS_ID_BASE}([a-z0-9.-]+\\.schema\\.json)"`, "g"));
    for (const match of refs) {
      const standardsFile = match[1];
      neededStandardsSchemas.add(standardsFile);
      text = text.split(`${STANDARDS_ID_BASE}${standardsFile}`).join(standardsFile);
    }
    await writeFile(join(OUT_DIR, file), text);
  }

  for (const standardsFile of neededStandardsSchemas) {
    const source = join(STANDARDS_SCHEMAS_DIR, standardsFile);
    await writeFile(join(OUT_DIR, basename(standardsFile)), await readFile(source, "utf-8"));
  }

  console.log(
    `Copied ${files.length} local schema(s) and ${neededStandardsSchemas.size} standards schema(s) into spec/schemas.resolved/.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
