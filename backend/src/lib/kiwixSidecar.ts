// KIWIX-SIDECAR-01 (docs/plans/knowledge-sources-2026-09-24.md, build
// order item 2): kiwix-serve as a real sidecar - installed from a
// pinned, checksummed binary (kiwixCatalog.ts), registered through the
// one generic supervisor (sidecars.ts) that already gives it health
// polling, a Repairs row and a one-click restart for free, loopback
// only, excluded from backups. "Home stays lean" (docs/plans/
// feeds-and-archive-2026-09-24.md): this file is host machinery, the
// one place a `reference` package's own content ever gets served from -
// no source-specific code, every installed book is just a ZIM file
// under the library directory.
import { existsSync, mkdirSync, readdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadUrl } from "@/lib/modelDownload";
import { extractArchive } from "@maipai/core/src/archive";
import { detectHardware } from "@/lib/hardware";
import { selectKiwixBinary, KIWIX_READY_MARKER, type KiwixBinaryPin } from "@/lib/kiwixCatalog";
import { kiwixToolsDir, defaultReferenceLibraryDir } from "@/lib/paths";
import { getHouseholdSettingValue } from "@/lib/settings";
import { registerSidecar, startSidecar, getSidecar } from "@/lib/sidecars";

const execFileAsync = promisify(execFile);

export const KIWIX_SIDECAR_ID = "kiwix-serve";
export const KIWIX_SERVE_PORT = Number(process.env.MAIPAI_KIWIX_PORT ?? 8790);

function binName(tool: "kiwix-serve" | "kiwix-manage"): string {
  return process.platform === "win32" ? `${tool}.exe` : tool;
}

function installDir(pin: KiwixBinaryPin): string {
  return join(kiwixToolsDir, pin.id);
}

/** The household's own reference library directory (`reference.
 * library_dir`, SOURCE-SPEC-01) - empty resolves to Home's own data
 * folder, the setting's own documented default. Read fresh every call
 * (never cached): a household can move the library, and the sidecar's
 * own restart already re-reads this the same way any other config
 * change takes effect on the next start. */
export function referenceLibraryDir(): string {
  const value = getHouseholdSettingValue("reference.library_dir");
  return typeof value === "string" && value.length > 0 ? value : defaultReferenceLibraryDir;
}

/** Downloads, verifies and extracts the pinned kiwix-tools build for
 * this box - a no-op once KIWIX_READY_MARKER exists, the same
 * completion gate engineCatalog.ts's own install step uses. Throws a
 * plain-language error (never a raw fetch/tar failure) when no pin
 * exists for this platform, or when the pinned URL 404s (the legacy
 * notes' own "Kiwix purges old kiwix-tools builds" warning - this is
 * exactly that failure, worded the way a household member reads it,
 * not a stack trace). */
export async function ensureKiwixInstalled(): Promise<{ serveBin: string; manageBin: string }> {
  const hw = await detectHardware();
  const pin = selectKiwixBinary(hw);
  if (!pin) {
    throw new Error("no kiwix-tools build is pinned for this computer's platform yet");
  }
  const destDir = installDir(pin);
  const serveBin = join(destDir, binName("kiwix-serve"));
  const manageBin = join(destDir, binName("kiwix-manage"));
  const readyMarker = join(destDir, KIWIX_READY_MARKER);
  if (!existsSync(readyMarker)) {
    mkdirSync(destDir, { recursive: true });
    const archivePath = join(destDir, ".download.tmp");
    try {
      await downloadUrl(pin.archive.url, archivePath, {
        expectedSha256: pin.archive.sha256,
        expectedBytes: pin.archive.approxBytes,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        message.includes("404") || message.includes("403")
          ? `kiwix-tools ${pin.label}'s own pinned download is no longer available (Kiwix periodically removes old builds) - this needs a fresh pin in kiwixCatalog.ts, not a retry.`
          : `kiwix-tools ${pin.label} failed to download: ${message}`,
      );
    }
    await extractArchive(archivePath, destDir);
    rmSync(archivePath, { force: true });
    // kiwix-tools' own archive extracts one wrapping directory
    // (kiwix-tools_<platform>-<version>/) - the same one-level nesting
    // llama.cpp's own release archives have, which is why
    // downloadArchiveVerified() in modelDownloadJobs.ts never needed a
    // second extraction step either; this repo's extractArchive()
    // already flattens exactly one such wrapper (see its own tests).
    if (process.platform !== "win32") {
      chmodSync(serveBin, 0o755);
      chmodSync(manageBin, 0o755);
    }
    writeFileSync(readyMarker, new Date().toISOString());
  }
  return { serveBin, manageBin };
}

/** Rebuilds `library.xml` from every `.zim` file actually present under
 * the reference library directory, via kiwix-manage (never hand-rolled
 * XML - the legacy notes' own "kiwix-manage 3.8.2 stopped writing
 * name= into library.xml" is exactly the kind of version-specific
 * quirk reimplementing this would have to track forever). kiwix-serve
 * starts fine against a library.xml with zero books (verified live,
 * 2026-09-24) but refuses to start with no library argument at all, so
 * this always writes one, even when the directory is empty. Called
 * once before every (re)start, never on a schedule - REFERENCE-LIBRARY-01
 * is the item that calls this again the moment a book installs or is
 * removed. */
export async function regenerateLibrary(manageBin: string, libraryDir: string): Promise<string> {
  mkdirSync(libraryDir, { recursive: true });
  const libraryPath = join(libraryDir, "library.xml");
  writeFileSync(libraryPath, '<?xml version="1.0" encoding="UTF-8" ?>\n<library version="20110515">\n</library>\n');
  const zimFiles = readdirSync(libraryDir).filter((f) => f.endsWith(".zim"));
  for (const zim of zimFiles) {
    await execFileAsync(manageBin, [libraryPath, "add", join(libraryDir, zim)]);
  }
  return libraryPath;
}

/** Registers the kiwix-serve sidecar (does not start it - startSidecar()/
 * startAllSidecars() does, the same two-step shape every other sidecar
 * declaration uses). Safe to call more than once (registerSidecar()
 * itself is, e.g. across a test's beforeEach). Takes the already-
 * resolved binaries rather than calling ensureKiwixInstalled() itself -
 * the one seam that lets kiwixSidecar.test.ts prove the real
 * registration wiring (the command array, the library regeneration,
 * the port/health URL) against a scripted stand-in binary, deterministic
 * and offline, the way every other test in this repo drives real code
 * with a scripted input rather than touching the network - only
 * startKiwixSidecar() below (never called from a test) resolves the
 * real pinned binary. */
export async function registerKiwixSidecar(bins: { serveBin: string; manageBin: string }): Promise<void> {
  const { serveBin, manageBin } = bins;
  const libraryDir = referenceLibraryDir();
  const libraryPath = await regenerateLibrary(manageBin, libraryDir);
  registerSidecar({
    id: KIWIX_SIDECAR_ID,
    // -M: reloads library.xml automatically, so a REFERENCE-LIBRARY-01
    // install later doesn't need to restart this sidecar to appear.
    // -i 127.0.0.1: loopback only, the same explicit-address shape
    // embedSupervisor.ts/ttsSupervisor.ts already use, never kiwix-
    // serve's own "all" default.
    command: [serveBin, "--port", String(KIWIX_SERVE_PORT), "-i", "127.0.0.1", "--library", libraryPath, "-M"],
    port: KIWIX_SERVE_PORT,
    healthUrl: `http://127.0.0.1:${KIWIX_SERVE_PORT}/`,
    // After the chat/embed/background engines' own lazy tiers (which
    // don't go through this registry at all) but before nothing else
    // currently declared - the one sidecar in the registry today.
    startupOrder: 10,
    backupMode: "exclude",
  });
}

/** For a caller that just wants to know the base URL without reaching
 * into sidecars.ts directly - packageHost.ts's own future lookup()
 * caller, kept here rather than duplicated per LOOKUP-FED-01's own
 * "Home stays lean" contract (SOURCE-SPEC-01's query_id shape is the
 * one this sidecar's own base URL feeds). */
export function kiwixBaseUrl(): string | null {
  return getSidecar(KIWIX_SIDECAR_ID)?.baseUrl ?? null;
}

/** Called once at boot (index.ts, alongside startAllSidecars()) -
 * registers, then starts. Never throws: a failed install or start
 * already raises its own Repairs issue (ensureKiwixInstalled()'s own
 * caller here, and startSidecar()'s own try/catch), the same "boot
 * never blocks or crashes on one sidecar" contract every other
 * registered sidecar gets. */
export async function startKiwixSidecar(): Promise<void> {
  try {
    const bins = await ensureKiwixInstalled();
    await registerKiwixSidecar(bins);
    await startSidecar(KIWIX_SIDECAR_ID);
  } catch (err) {
    // ensureKiwixInstalled()'s own failure (no pin, a dead pinned URL)
    // never reaches startSidecar()'s own Repairs path, since it throws
    // before registerSidecar() is ever called - logged here so an
    // install failure is at least visible, the same reason
    // llmSupervisor.ts's own spawn failures are never silent either.
    console.error(`[kiwix] failed to start: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Re-exported for tests only that want to prove the wrapping-directory
// assumption in ensureKiwixInstalled()'s own comment without touching
// the network.
export const __internal = { installDir, binName };
