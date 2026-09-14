// Reads registry.json and resolves paths against home/data-scratch/datasets/
// (git-ignored; SOURCES.md and SHA256SUMS sit beside the files, this
// repo's own record of what was actually downloaded, org rule: a checksum
// is trusted only from the file this session produced, never a listing).
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface RegistryFile {
  path: string;
  sha256: string;
}

export interface RegistryDownload {
  path: string;
  url: string;
}

export interface RegistryEntry {
  name: string;
  version: string;
  url: string;
  license: string;
  attribution: string;
  collectionMethod: string;
  holdsRealIdentities: boolean;
  holdsRealIdentitiesNote?: string;
  allowedUses: string[];
  heldOut: string;
  loader: string | null;
  files: RegistryFile[];
  download: RegistryDownload[];
}

interface RegistryFileShape {
  datasets: RegistryEntry[];
}

// home/backend/scripts/bench/datasets -> home/data-scratch/datasets
export const DATASETS_DIR = join(import.meta.dir, "..", "..", "..", "..", "data-scratch", "datasets");
const REGISTRY_PATH = join(import.meta.dir, "registry.json");

let cached: RegistryEntry[] | null = null;

export function loadRegistry(): RegistryEntry[] {
  cached ??= (JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as RegistryFileShape).datasets;
  return cached;
}

export function registryEntry(name: string): RegistryEntry {
  const entry = loadRegistry().find((d) => d.name === name);
  if (!entry) throw new Error(`no registry entry named "${name}" (registry.json)`);
  return entry;
}

/** Every (dataset, file) pair, flattened - what `verify` and `download`
 * both iterate over, so the two commands can never drift on which files
 * exist. */
export function registryFiles(): Array<{ dataset: string; file: RegistryFile }> {
  return loadRegistry().flatMap((d) => d.files.map((file) => ({ dataset: d.name, file })));
}

export function absolutePath(relativePath: string): string {
  return join(DATASETS_DIR, relativePath);
}
