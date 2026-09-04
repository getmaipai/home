// Extracts a downloaded engine archive (.tar.gz or .zip) into a directory,
// flattening the single top-level folder every llama.cpp release archive
// wraps its files in (e.g. "llama-b10797/llama-server") so the extracted
// path is stable across build-number bumps - engineCatalog.ts callers
// never need to know the archive's internal layout, only the destination
// directory.
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "bun";

async function run(cmd: string[]): Promise<void> {
  const proc = spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`${cmd.join(" ")} exited ${code}: ${stderr.trim()}`);
  }
}

/** Extracts `archivePath` into `destDir`, merging its contents directly
 * into `destDir` (not a versioned subdirectory), so extracting a second
 * archive (the Windows CUDA build's separate cudart package) into the same
 * `destDir` merges alongside the first rather than nesting. `tar` handles
 * both .tar.gz (every platform) and .zip (bsdtar, bundled since Windows 10
 * 1803 and on macOS/Linux); this repo only exercises the .tar.gz path for
 * real (macOS arm64, the one verified engine, see engineCatalog.ts). */
export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  // Staged as a sibling of destDir, not the OS tmpdir: mkdtempSync under
  // os.tmpdir() can land on a different filesystem (e.g. a tmpfs /tmp),
  // and the flatten step below renameSync's out of it - a cross-device
  // rename throws EXDEV instead of moving the file.
  mkdirSync(destDir, { recursive: true });
  const stagingDir = mkdtempSync(join(destDir, ".extract-"));
  try {
    await run(["tar", "-xf", archivePath, "-C", stagingDir]);
    const entries = readdirSync(stagingDir);
    // Every observed llama.cpp release archive has exactly one top-level
    // directory; if an archive ever doesn't, merge its entries directly
    // instead of guessing which one is "the" wrapper.
    const sourceDir =
      entries.length === 1 && statSync(join(stagingDir, entries[0]!)).isDirectory()
        ? join(stagingDir, entries[0]!)
        : stagingDir;
    for (const entry of readdirSync(sourceDir)) {
      renameSync(join(sourceDir, entry), join(destDir, entry));
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}
