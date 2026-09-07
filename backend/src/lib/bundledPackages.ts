// The bundled default package set's own provenance (session-d-packages-
// and-store.md step 6: "home keeps a signed copy of the default set
// under backend/packages/ produced by pack; a script refreshes it; a
// test proves the copy matches the index"). `define`, `joke`, `trivia`,
// `weather`, `knowledge`, and `storytime-style` now live in the
// `catalog` repo as their canonical source (docs/dev.md's own review
// note); `backend/packages/` keeps a checked-in COPY so the running hub
// never needs a network fetch or a sibling catalog checkout to load its
// own default packages.
//
// `hashPackageDir()` is the one thing that makes "the copy matches"
// checkable without home depending on catalog's own tar-based pack.ts
// (a real cross-repo dependency neither repo's build supports today,
// the same reason schema/ is mirrored by a plain copy script rather than
// imported live): a plain sha256 over every file's own relative path and
// content, sorted so directory-listing order never matters and no
// mtime/uid ever leaks in - deterministic on any machine, unlike a tar
// stream. `scripts/refresh-bundled-packages.ts` computes this hash right
// after copying from catalog and commits it into
// `backend/packages/bundled-provenance.json`;
// `tests/bundledPackages.test.ts` recomputes the SAME hash from
// whatever's currently on disk and fails loudly the moment someone
// hand-edits a bundled package's checked-in copy instead of running the
// refresh script against catalog.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

function listFilesSorted(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      // A Dirent's isFile()/isDirectory() reflect the raw entry type,
      // never following a symlink - a symlink entry answers false to
      // both and would otherwise be silently skipped (found by code
      // review), leaving a symlink swap or a symlink add/remove
      // completely invisible to the hash even though catalog's own
      // pack.ts refuses to pack a symlink at all (tools/src/pack.ts):
      // this function holds the checked-in copy to the identical
      // "no symlinks" bar rather than quietly ignoring one.
      if (entry.isSymbolicLink()) {
        throw new Error(`${full} is a symlink - bundled packages may not contain symlinks`);
      }
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  walk(dir);
  return files.map((f) => relative(dir, f)).sort((a, b) => a.localeCompare(b));
}

export function hashPackageDir(dir: string): string {
  const hash = createHash("sha256");
  for (const relPath of listFilesSorted(dir)) {
    hash.update(relPath);
    hash.update("\0");
    hash.update(readFileSync(join(dir, relPath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export interface BundledProvenanceEntry {
  sha256: string;
  source_commit: string;
  catalog_path: string;
}

export type BundledProvenance = Record<string, BundledProvenanceEntry>;

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
