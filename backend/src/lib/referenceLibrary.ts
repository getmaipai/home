// REFERENCE-LIBRARY-01 (docs/plans/knowledge-sources-2026-09-24.md, build
// order item 3; work order docs/plans/b-reference-library-01-2026-09-24.md):
// install a reference package's own ZIM end to end. "Home stays lean" -
// this is host machinery (one of the two named exceptions), never
// source-specific code: any book/language/flavour Kiwix publishes goes
// through the same two functions below.
//
// Owner's call 6: Kiwix's own published sha-256 (from the file's own
// `.meta4` sidecar) is trusted directly, never computed by re-hashing a
// second time against some other source - the same trust boundary
// kiwixCatalog.ts's own binary pin already accepted for kiwix-tools
// itself. Unlike that binary (a rare, hand-verified release this repo
// pins once), a ZIM's own snapshot changes monthly, so there is no
// static pin table here: `resolveReferenceFlavour()` asks Kiwix's own
// public library catalog live, the front door a household member
// browsing kiwix.org would use themselves (org CLAUDE.md > Third-party
// services: we are the user), and trusts whatever that catalog and its
// `.meta4` currently say.
import { DOMParser } from "linkedom";
import { existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { downloadUrl, type DownloadProgress } from "@/lib/modelDownload";
import { raiseIssue, resolveIssue, registerFixHandler } from "@/lib/issues";
import {
  referenceLibraryDir,
  ensureKiwixInstalled,
  registerKiwixSidecar,
  regenerateLibrary,
  KIWIX_SIDECAR_ID,
} from "@/lib/kiwixSidecar";
import { getSidecar, startSidecar, stopSidecar } from "@/lib/sidecars";

export const KIWIX_CATALOG_URL = "https://library.kiwix.org/catalog/v2/entries";
const ISSUE_SOURCE = "reference-library";

export interface ResolvedFlavour {
  /** The catalog's own file-name stem, e.g. "vikidia_en_all" - the
   * legacy notes' own warning (docs/plans/knowledge-sources-2026-09-24.md,
   * "From the legacy code"): resolve and name everything from this, never
   * a second, hand-typed book id that can drift from it. */
  name: string;
  flavour: string;
  language: string;
  zimFileName: string;
  zimUrl: string;
  sha256: string;
  sizeBytes: number;
}

function textOf(el: { textContent?: string | null } | undefined | null): string | undefined {
  return el?.textContent ?? undefined;
}

/** Finds the newest file for a chosen book/language/flavour, live
 * against Kiwix's own public catalog (never a static pin table, per
 * owner's call 6) - the ZIM equivalent of kiwixCatalog.ts's
 * `selectKiwixBinary()`, resolving from a real, current source instead
 * of a hardcoded array because Kiwix reissues most ZIM snapshots monthly.
 * `catalogUrl` is only ever overridden by a test, against its own local
 * fixture server - production always asks the real library. */
export async function resolveReferenceFlavour(
  book: string,
  language: string,
  flavour: string,
  catalogUrl: string = KIWIX_CATALOG_URL,
): Promise<ResolvedFlavour> {
  const url = `${catalogUrl}?q=${encodeURIComponent(book)}&lang=${encodeURIComponent(language)}&count=50`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kiwix catalog lookup for "${book}" failed: GET ${url} returned ${res.status}`);
  const document = new DOMParser().parseFromString(await res.text(), "text/xml");
  const entries = [...document.getElementsByTagName("entry")];
  // `q=` is a fuzzy title search, not an exact book-id filter (the
  // legacy notes' own warning: "the OPDS catalog's q= matches titles,
  // not file names") - a review caught the first draft trusting the
  // first flavour match regardless of which title it belonged to. Every
  // real entry's own <name> follows Kiwix's stable "<book>_<lang>_..."
  // convention (docs/dev.md's own examples: "vikidia_en_all",
  // "wikipedia_en_all_nopic"), so requiring that prefix rules out an
  // unrelated title that happens to share a flavour tag.
  const match = entries.find((e) => {
    const entryName = textOf(e.getElementsByTagName("name")[0]);
    return textOf(e.getElementsByTagName("flavour")[0]) === flavour && entryName?.startsWith(`${book}_`);
  });
  if (!match) {
    throw new Error(`no "${flavour}" flavour of "${book}" (${language}) found in Kiwix's catalog`);
  }
  const name = textOf(match.getElementsByTagName("name")[0]) ?? book;
  const link = [...match.getElementsByTagName("link")].find(
    (l) => l.getAttribute("rel") === "http://opds-spec.org/acquisition/open-access",
  );
  const meta4Url = link?.getAttribute("href");
  if (!meta4Url) {
    throw new Error(`"${book}" (${flavour}, ${language}) has no downloadable file in Kiwix's catalog`);
  }
  const meta4Res = await fetch(meta4Url);
  if (!meta4Res.ok) throw new Error(`GET ${meta4Url} returned ${meta4Res.status}`);
  const meta4Doc = new DOMParser().parseFromString(await meta4Res.text(), "text/xml");
  const file = meta4Doc.getElementsByTagName("file")[0];
  const zimFileName = file?.getAttribute("name");
  const sizeText = textOf(file?.getElementsByTagName("size")[0]);
  const sha256 = [...(file?.getElementsByTagName("hash") ?? [])].find((h) => h.getAttribute("type") === "sha-256")
    ?.textContent;
  if (!zimFileName || !sizeText || !sha256) {
    throw new Error(`${meta4Url} is missing a file name, size or sha-256 hash`);
  }
  return {
    name,
    flavour,
    language,
    zimFileName,
    // The .meta4 sidecar and the real .zim it describes sit at the same
    // path, one suffix apart - confirmed live against Kiwix's own
    // download servers (docs/dev.md's REFERENCE-LIBRARY-01 entry).
    zimUrl: meta4Url.replace(/\.meta4$/, ""),
    sha256,
    sizeBytes: Number(sizeText),
  };
}

/** The stable, dated-free path a book/flavour always lives at - kept
 * the same across every update so kiwix-manage's own library.xml entry,
 * and anything that ever links to this book, never has to change just
 * because Kiwix reissued a snapshot. */
function slotFileName(name: string, flavour: string): string {
  return `${name}_${flavour}.zim`;
}

function slotKey(book: string, language: string, flavour: string): string {
  return `${book}:${language}:${flavour}`;
}

export interface InstallResult {
  resolved: ResolvedFlavour;
  path: string;
  replacedPrevious: boolean;
}

// A review caught a real race: two concurrent installs of the same
// book/language/flavour (two admin sessions, or a Repairs "try again"
// fix fired while a first attempt is still running) would both delete
// and write the same `.incoming`/`.incoming.part` files, corrupting
// each other's stream. One in-flight install per slot at a time; a
// second caller for the same slot is refused immediately rather than
// racing (downloadUrl()'s own verification would eventually catch the
// corruption anyway, but only after wasting a full re-download).
const inFlightInstalls = new Set<string>();

/** Downloads and verifies one book/language/flavour into the reference
 * library directory - resume (downloadUrl's own Range/`.part` handling,
 * the identical mechanism KIWIX-SIDECAR-01 already proved for the
 * kiwix-tools binary), sha-256 verified, and on an update the previous
 * copy is never touched until the new one has already verified: the new
 * file downloads to its own `.incoming` path first, and only a
 * successful, fully-verified download is renamed over the stable slot
 * (an atomic rename on the same filesystem - whatever already has the
 * old file open keeps reading it right up to that moment, never a
 * half-written one). A hash or network failure throws with the old
 * file, if any, provably untouched - never a silent retry loop, never a
 * corrupt file left in the library directory (downloadUrl() itself
 * deletes its own `.part` on a verification failure). This function
 * only writes the file; `installAndPublishReferenceFlavour()` below is
 * what a real caller uses to also make kiwix-serve aware of it. */
export async function installReferenceFlavour(
  book: string,
  language: string,
  flavour: string,
  opts: { catalogUrl?: string; onProgress?: (p: DownloadProgress) => void } = {},
): Promise<InstallResult> {
  const key = slotKey(book, language, flavour);
  if (inFlightInstalls.has(key)) {
    throw new Error(`"${book}" (${flavour}, ${language}) is already installing - wait for that to finish before trying again.`);
  }
  inFlightInstalls.add(key);
  try {
    const resolved = await resolveReferenceFlavour(book, language, flavour, opts.catalogUrl);
    const libraryDir = referenceLibraryDir();
    mkdirSync(libraryDir, { recursive: true });
    const stablePath = join(libraryDir, slotFileName(resolved.name, resolved.flavour));
    const replacedPrevious = existsSync(stablePath);
    const incomingPath = `${stablePath}.incoming`;
    // A stale `.incoming` from an earlier crashed attempt might belong to
    // a DIFFERENT resolved snapshot (a different sha256) than the one just
    // resolved above - downloadUrl() skips entirely when its destPath
    // already exists, which would wrongly treat that stale file as this
    // run's own verified download. Only its own `.part` sibling (which
    // downloadUrl() checks by size, not identity) is safe to resume from.
    if (existsSync(incomingPath)) unlinkSync(incomingPath);
    try {
      await downloadUrl(resolved.zimUrl, incomingPath, {
        expectedSha256: resolved.sha256,
        expectedBytes: resolved.sizeBytes,
        onProgress: opts.onProgress,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `"${resolved.name}" (${resolved.flavour}) failed to install: ${message}${replacedPrevious ? " - the previous copy is untouched." : ""}`,
      );
    }
    renameSync(incomingPath, stablePath);
    return { resolved, path: stablePath, replacedPrevious };
  } finally {
    inFlightInstalls.delete(key);
  }
}

/** The real entry point: installs (or updates) a book/flavour, then
 * regenerates kiwix-serve's own library.xml (via kiwixSidecar.ts's
 * regenerateLibrary(), real kiwix-manage calls, never hand-rolled XML)
 * and restarts the sidecar so it actually serves the new content - the
 * legacy notes' own "restart kiwix-serve once per batch of installs"
 * (this repo does one install at a time, so that's once here too),
 * never relying on kiwix-serve's own `-M` auto-reload alone: `-M` picks
 * up a NEW book's entry in library.xml, but an UPDATE swaps the bytes
 * at an EXISTING book's own already-open path, which a running process
 * only sees after it reopens the file. A failed install raises a real
 * Repairs row with a working "try again" fix (never a silent failure -
 * this is the one step in this file with a real network dependency
 * beyond downloadUrl()'s own retries, so it is the one step this
 * repo's tests never drive for real; the live bench does). */
export async function installAndPublishReferenceFlavour(
  book: string,
  language: string,
  flavour: string,
  opts: { catalogUrl?: string; onProgress?: (p: DownloadProgress) => void } = {},
): Promise<InstallResult> {
  const key = slotKey(book, language, flavour);
  const fixAction = `retry_reference_install:${key}`;
  registerFixHandler(fixAction, async () => {
    await installAndPublishReferenceFlavour(book, language, flavour);
  });
  let result: InstallResult;
  try {
    result = await installReferenceFlavour(book, language, flavour, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await raiseIssue({
      source: ISSUE_SOURCE,
      key,
      severity: "error",
      title: `"${book}" (${flavour}, ${language}) could not be installed`,
      detail: message,
      fix: { label: "Try the download again", action: fixAction },
    });
    throw err;
  }
  resolveIssue(ISSUE_SOURCE, key);
  const bins = await ensureKiwixInstalled();
  const alreadyRegistered = getSidecar(KIWIX_SIDECAR_ID) !== undefined;
  if (alreadyRegistered) {
    // Never re-register an already-registered sidecar here: a review
    // found sidecars.ts's own registerSidecar() unconditionally
    // overwrites the registry entry (proc, status, and the live
    // health-poll timer all reset), which orphans the OLD entry's timer
    // rather than clearing it - this item is the first real caller that
    // re-registers a sidecar already running from boot, so it is the
    // first to hit that latent gap. Only regenerateLibrary() (kiwix-
    // manage, real XML, no registry involved) is needed to pick up the
    // new/updated book; the sidecar's own config (port, command,
    // healthUrl) never changes between installs.
    await regenerateLibrary(bins.manageBin, referenceLibraryDir());
    if (getSidecar(KIWIX_SIDECAR_ID)?.status === "running") {
      await stopSidecar(KIWIX_SIDECAR_ID);
    }
  } else {
    await registerKiwixSidecar(bins);
  }
  await startSidecar(KIWIX_SIDECAR_ID);
  return result;
}
