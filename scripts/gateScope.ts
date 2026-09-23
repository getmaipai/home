// GATE-SCOPE-01: the pure classification logic behind scripts/check.sh's
// scope computation, split out so it can be unit tested with bun:test -
// bash string matching over dozens of path shapes (a bundled package's
// README, a cross-package rename, docs/api/, .claude/) is exactly the
// kind of thing that silently drifts wrong without a test suite, and
// check.sh itself only proves "did it exit 0 today", never "did it pick
// the right scope for this diff". See docs/dev.md's GATE-SCOPE-01 entry
// for the design record this implements.

export type Scope = "docs" | "frontend" | "backend" | "full";

export interface ScopeResult {
  scope: Scope;
  why: string;
}

// A path in any of these exact spots crosses packages by definition
// (a lockfile, a workspace's own package.json, or shared repo config)
// - no bucket below it can ever be narrower than "full".
const FULL_BUCKET_EXACT = new Set([
  "package.json",
  "bun.lock",
  "deno.lock",
  "backend/package.json",
  "frontend/package.json",
  ".gitignore",
  ".gitleaks.toml",
]);

// Root-level docs files only - the same basename one level down (a
// bundled package's own README.md, say) is that package's own file,
// not a doc (backend/src/lib/bundledPackages.ts's hashPackageDir()
// hashes every file in a bundled package, README.md included, and
// package-bronze.test.ts checks for it - a docs-scoped gate would
// never run that check).
const ROOT_DOCS_EXACT = new Set(["README.md", "CHANGELOG.md", "AGENTS.md", "CLAUDE.md", "LICENSE", "NOTICE"]);

/**
 * Classifies a changed-file list into the narrowest scope that still
 * covers every check the full gate would run against it. `files` should
 * already be deduplicated; order doesn't matter except for which path
 * gets cited in `why` when a full-gate trigger fires (the first one
 * found).
 *
 * `frontendImportedBackendPaths` is the list of `backend/...` paths (no
 * extension) that `frontend/` imports directly - `compute_scope()` in
 * check.sh finds these live via a `git grep` for
 * `@maipai/home-backend/src/...`, never a hand-kept list, since a new
 * import silently going untracked would be exactly the kind of gap
 * this whole item exists to prevent.
 */
function stripKnownExtension(path: string): string {
  return path.replace(/\.(tsx?|jsx?)$/, "");
}

export function classifyScope(files: string[], frontendImportedBackendPaths: string[] = []): ScopeResult {
  if (files.length === 0) {
    return { scope: "full", why: "no changed files - verifying the full state" };
  }

  let hasFrontend = false;
  let hasBackend = false;
  let hasDocs = false;
  const backendChanged: string[] = [];

  for (const f of files) {
    if (FULL_BUCKET_EXACT.has(f)) {
      return { scope: "full", why: `a workspace package.json or lockfile changed (${f})` };
    }
    if (f.startsWith("scripts/")) {
      return { scope: "full", why: `scripts/ changed (${f}) - it holds the pin tags every workspace resolves from` };
    }
    if (f.startsWith("spec/")) {
      return { scope: "full", why: `a spec workspace path changed (${f})` };
    }
    if (f.startsWith("docs/api/")) {
      hasBackend = true;
      backendChanged.push(f);
      continue;
    }
    if (f.startsWith("frontend/")) {
      hasFrontend = true;
      continue;
    }
    if (f.startsWith("backend/")) {
      hasBackend = true;
      backendChanged.push(f);
      continue;
    }
    if (ROOT_DOCS_EXACT.has(f)) {
      hasDocs = true;
      continue;
    }
    if (f.startsWith("docs/")) {
      hasDocs = true;
      continue;
    }
    if (f.startsWith(".claude/")) {
      hasDocs = true;
      continue;
    }
    return { scope: "full", why: `an unclassified path changed (${f})` };
  }

  if (hasFrontend && hasBackend) {
    return { scope: "full", why: "both frontend/ and backend/ changed - crosses packages" };
  }

  if (hasBackend) {
    // Every import specifier this regex can ever capture is
    // extension-free today (`@maipai/home-backend/src/wire`, not
    // `.../wire.ts`), but a future Node16/nodenext-style import could
    // write the compiled `.js` extension even against a `.ts` source -
    // stripping a known extension from BOTH sides keeps the match
    // working either way, instead of silently stopping if one side
    // ever gains an extension the other doesn't expect.
    const imports = new Set(frontendImportedBackendPaths.map(stripKnownExtension));
    for (const f of backendChanged) {
      if (imports.has(stripKnownExtension(f))) {
        return { scope: "full", why: `backend change touches ${f}, which frontend/ imports directly` };
      }
    }
    return { scope: "backend", why: `only backend/ changed (${backendChanged.length} file(s))` };
  }

  if (hasFrontend) {
    return { scope: "frontend", why: "only frontend/ changed" };
  }

  if (hasDocs) {
    return { scope: "docs", why: "only docs changed" };
  }

  // Unreachable given the loop above always returns or sets one of the
  // three flags, kept as a safe default rather than falling through.
  return { scope: "full", why: "no changed path matched a known scope bucket" };
}

// --- CLI entry point, called from scripts/check.sh -------------------
// Reads the changed-file list from the file named in argv[2], the
// frontend-imported-backend-paths list from argv[3] (one path per
// line, either may be empty), and prints exactly two lines to stdout:
// the scope, then the reason - check.sh reads them with two `read -r`
// calls rather than eval-ing anything, so a path containing shell
// metacharacters can never be interpreted as a command.
if (import.meta.main) {
  const [, , changedFilesPath, importedPathsPath] = Bun.argv;
  if (!changedFilesPath || !importedPathsPath) {
    console.error("usage: bun scripts/gateScope.ts <changed-files-file> <frontend-imported-backend-paths-file>");
    process.exit(2);
  }
  const readLines = (path: string): string[] =>
    require("node:fs")
      .readFileSync(path, "utf8")
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0);

  const files = readLines(changedFilesPath);
  const imports = readLines(importedPathsPath);
  const result = classifyScope(files, imports);
  console.log(result.scope);
  console.log(result.why);
}
