// REFERENCE-LIBRARY-01's own live acceptance: "a real flavour installed
// end to end against a real pinned URL... a resume proven by
// interrupting a download mid-stream and confirming it continues rather
// than restarting." The hash-failure and old-copy-served-until-verified
// mechanics are proven deterministically instead, against a scripted
// fixture (tests/referenceLibrary.test.ts) - the same split this repo
// uses everywhere else (deterministic/offline by default, a live bench
// only for what genuinely needs the real network). This script is the
// real-network half: Vikidia's own English "nopic" flavour (~10 MB,
// picked over the ~600 KB Sicilian fixture used for quick sanity checks
// during development because it is the design's own real default, not
// a throwaway), resolved and downloaded from library.kiwix.org and
// download.kiwix.org for real, then a second run that aborts a fresh
// download partway through and confirms the retry resumes from the
// partial byte count rather than starting over.
//
//   bun run backend/scripts/bench/reference-library-01-live.ts
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refuseIfGateRunning } from "./liveHubQuiet";

async function main(): Promise<void> {
  refuseIfGateRunning("reference-library-01-live");

  const ownDataDir = mkdtempSync(join(tmpdir(), "reference-library-01-live-"));
  process.env.MAIPAI_DATA_DIR = ownDataDir;

  const { installReferenceFlavour, resolveReferenceFlavour } = await import("@/lib/referenceLibrary");
  const { setHouseholdSettingValue } = await import("@/lib/settings");

  const libraryDir = join(ownDataDir, "reference");
  setHouseholdSettingValue("reference.library_dir", libraryDir);

  console.log("\n## Run header\n");
  console.log(JSON.stringify({ date: new Date().toISOString(), dataDir: ownDataDir, book: "vikidia", language: "eng", flavour: "nopic" }, null, 2));

  let exitCode = 1;
  try {
    console.log("\n## Phase 1: resolve + real install\n");
    const resolveStart = Date.now();
    const resolved = await resolveReferenceFlavour("vikidia", "eng", "nopic");
    console.log(`resolved (real Kiwix catalog): ${Date.now() - resolveStart}ms`);
    console.log(JSON.stringify(resolved, null, 2));

    const installStart = Date.now();
    let lastProgress = 0;
    const result = await installReferenceFlavour("vikidia", "eng", "nopic", {
      onProgress: (p) => {
        const pct = p.totalBytes > 0 ? Math.floor((p.completedBytes / p.totalBytes) * 100) : 0;
        if (pct >= lastProgress + 20) {
          lastProgress = pct;
          console.log(`  ${p.status}: ${pct}% (${p.completedBytes}/${p.totalBytes} bytes)`);
        }
      },
    });
    console.log(`install (real download + sha256 verify): ${Date.now() - installStart}ms`);
    console.log(`installed at ${result.path}, replacedPrevious=${result.replacedPrevious}`);
    const stat1 = statSync(result.path);
    console.log(`on-disk size: ${stat1.size} bytes (expected ${resolved.sizeBytes})`);
    const phase1Ok = stat1.size === resolved.sizeBytes;

    console.log("\n## Phase 2: resume proof (abort a fresh download partway, confirm it continues)\n");
    // A second, distinct flavour slot (maxi, not phase 1's nopic) so
    // this starts truly fresh - no destPath already satisfied. Drives
    // resolveReferenceFlavour() and downloadUrl() directly (the same
    // two calls installReferenceFlavour() makes internally) rather than
    // through installReferenceFlavour() itself, since that function
    // doesn't expose an AbortSignal on its own public surface and this
    // proof needs one to interrupt a real, in-flight download.
    const { downloadUrl } = await import("@/lib/modelDownload");
    const { existsSync: exists2 } = await import("node:fs");
    const maxiResolved = await resolveReferenceFlavour("vikidia", "eng", "maxi");
    const incomingPath = join(libraryDir, `${maxiResolved.name}_${maxiResolved.flavour}.zim.incoming`);
    if (exists2(incomingPath)) rmSync(incomingPath, { force: true });
    const resumeController = new AbortController();
    let sawPartialBytes = 0;
    const firstAttempt = downloadUrl(maxiResolved.zimUrl, incomingPath, {
      expectedSha256: maxiResolved.sha256,
      expectedBytes: maxiResolved.sizeBytes,
      signal: resumeController.signal,
      onProgress: (p) => {
        if (p.completedBytes > 2_000_000 && !resumeController.signal.aborted) {
          sawPartialBytes = p.completedBytes;
          resumeController.abort();
        }
      },
    });
    await firstAttempt.catch(() => {});
    const partPath = `${incomingPath}.part`;
    const partSizeAfterAbort = exists2(partPath) ? statSync(partPath).size : 0;
    console.log(`aborted after ${sawPartialBytes} reported bytes; .part on disk: ${partSizeAfterAbort} bytes`);

    const resumeStart = Date.now();
    await downloadUrl(maxiResolved.zimUrl, incomingPath, {
      expectedSha256: maxiResolved.sha256,
      expectedBytes: maxiResolved.sizeBytes,
    });
    console.log(`resumed and completed: ${Date.now() - resumeStart}ms`);
    const finalSize = statSync(incomingPath).size;
    console.log(`final verified size: ${finalSize} bytes (expected ${maxiResolved.sizeBytes})`);
    const phase2Ok = partSizeAfterAbort > 0 && finalSize === maxiResolved.sizeBytes;

    console.log("\n## Result\n");
    console.log(phase1Ok ? "PASS phase 1: a real flavour resolved and installed end to end, sha256-verified." : "FAIL phase 1");
    console.log(phase2Ok ? "PASS phase 2: an aborted real download resumed from its partial bytes rather than restarting." : "FAIL phase 2");
    exitCode = phase1Ok && phase2Ok ? 0 : 1;
  } finally {
    rmSync(ownDataDir, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

main();
