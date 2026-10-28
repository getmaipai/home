// MODEL-ADD-01 S5: the developer's command behind scripts/add-model.sh. Asks the Stack to read a Hugging Face file (nothing
// downloads), builds the same record the Settings flow builds with origin "shipped", and inserts it into the catalog in
// backend/src/lib/modelCatalog.ts. It never commits, lands or ships. The Stack pin lives in the Stack repo, so it is printed
// for that repo's own change.
import { readFileSync, writeFileSync } from "node:fs";
import { recordFor, type InspectedModel } from "../backend/src/lib/addModelRecord";

export const CATALOG_FILE = new URL("../backend/src/lib/modelCatalog.ts", import.meta.url).pathname;

/** The catalog source with one more record before the closing bracket of CATALOG. Throws when the id is already there. */
export function insertRecord(source: string, record: ReturnType<typeof recordFor>): string {
  if (source.includes(`id: ${JSON.stringify(record.id)}`)) throw new Error(`The catalog already has ${record.id}. Remove it first, or pick another file.`);
  const start = source.indexOf("export const CATALOG: ModelCapabilities[] = [");
  const end = source.indexOf("\n];", start);
  if (start < 0 || end < 0) throw new Error("Could not find the CATALOG list in modelCatalog.ts. Add the record by hand.");
  const body = JSON.stringify(record, null, 2).replace(/^/gm, "  ").replace(/"([a-z_]+)":/g, "$1:");
  return `${source.slice(0, end)}\n  ModelCapabilities.parse(${body.trimStart()}),${source.slice(end)}`;
}

export function inspectedFrom(result: Record<string, any>): InspectedModel {
  const shape = result.architecture?.shape;
  if (!shape || typeof result.sha256 !== "string" || !(result.sizeBytes > 0)) throw new Error("The repository does not state the checksum, size or layer shape MaiPai needs. Pick another file.");
  return {
    repo: result.repo, file: result.file, url: result.url, revision: result.revision, sizeBytes: result.sizeBytes, sha256: result.sha256,
    licence: result.licence ?? null, architecture: result.architecture.name, verifiedArchitecture: result.architecture.verified === true, shape, ramBytes: Number(result.architecture.ramBytes) || 0,
  };
}

async function main(argv: string[]): Promise<number> {
  const [repo, file] = argv;
  if (!repo || !file) { console.error("Usage: scripts/add-model.sh <owner/repo> <file.gguf>"); return 2; }
  const stack = (process.env.MAIPAI_STACK_URL ?? "http://127.0.0.1:8770").replace(/\/$/, "");
  const response = await fetch(`${stack}/stack/v1/models/inspect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: repo, file }) }).catch(() => null);
  if (!response) { console.error(`The MaiPai Stack did not answer at ${stack}. Start it, or set MAIPAI_STACK_URL, then run this again.`); return 1; }
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) { console.error(typeof body.error === "string" ? body.error : "The Stack could not read that file. Check the repository and file name."); return 1; }
  const record = recordFor(inspectedFrom(body), null, new Date(), "shipped");
  writeFileSync(CATALOG_FILE, insertRecord(readFileSync(CATALOG_FILE, "utf8"), record));
  console.log(`Added ${record.id} to backend/src/lib/modelCatalog.ts. Review the diff, run the tests, then land it with scripts/land.sh.`);
  console.log("Stack pin for the Stack repo (models pins file):");
  console.log(JSON.stringify({ id: record.id, role: "chat", url: record.download?.url, sha256: record.download?.sha256, approx_bytes: record.download?.approx_bytes }, null, 2));
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
