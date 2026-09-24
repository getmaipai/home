// KIWIX-SIDECAR-01: the item's own live acceptance - "a fixture ZIM,
// searchable on loopback." kiwixSidecar.test.ts drives
// ensureKiwixInstalled()'s and registerKiwixSidecar()'s own
// orchestration against a scripted stand-in binary, deterministic and
// offline; this proves the real thing end to end instead - the real
// pinned kiwix-tools 3.8.2 build (a real download, sha256-verified,
// and a real extract), a real kiwix-manage invocation, and a real
// kiwix-serve process bound to loopback, against a real fixture ZIM.
// The fixture (openzim/zim-testing-suite's own "small.zim") is
// downloaded here, pinned by its own URL and sha256, the same "third-
// party binaries are fetched on demand, never vendored into the repo"
// rule every other pinned download in this codebase already follows -
// never a committed file under tests/fixtures. Picked because it has
// no full-text index (_ftindex:no in its own tags), so /search
// correctly reports "Fulltext search unavailable" and this bench uses
// /suggest (title matching, which the fixture does support) as its own
// "searchable" proof instead. A book with a real full-text index is
// REFERENCE-LIBRARY-01's own concern, not this sidecar's.
//
//   bun run backend/scripts/bench/kiwix-sidecar-01-live.ts
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refuseIfGateRunning } from "./liveHubQuiet";

const FIXTURE_ZIM_URL = "https://raw.githubusercontent.com/openzim/zim-testing-suite/main/data/nons/small.zim";
const FIXTURE_ZIM_SHA256 = "a4f516011116090ce96cff0767e3c9cfd74a00552b932038a5c5050fbf13db6b";
const FIXTURE_ZIM_BYTES = 41_155;

async function main(): Promise<void> {
  refuseIfGateRunning("kiwix-sidecar-01-live");

  const ownDataDir = mkdtempSync(join(tmpdir(), "kiwix-sidecar-01-live-"));
  process.env.MAIPAI_DATA_DIR = ownDataDir;
  // Its own port, never the household's real 8790 - this run installs
  // and spawns a real kiwix-serve, and never wants to collide with one
  // already running against the household's own reference library.
  process.env.MAIPAI_KIWIX_PORT = process.env.MAIPAI_KIWIX_PORT ?? "8799";

  const { ensureKiwixInstalled, registerKiwixSidecar, referenceLibraryDir, KIWIX_SIDECAR_ID, KIWIX_SERVE_PORT } = await import("@/lib/kiwixSidecar");
  const { startSidecar, stopSidecar, getSidecar } = await import("@/lib/sidecars");
  const { downloadUrl } = await import("@/lib/modelDownload");

  console.log("\n## Run header\n");
  console.log(JSON.stringify({ date: new Date().toISOString(), dataDir: ownDataDir, port: KIWIX_SERVE_PORT }, null, 2));

  let exitCode = 1;
  try {
    const installStart = Date.now();
    const bins = await ensureKiwixInstalled();
    console.log(`install (real pinned download + extract, or reused a prior run's own cache): ${Date.now() - installStart}ms`);
    console.log(`serve bin: ${bins.serveBin}`);
    console.log(`manage bin: ${bins.manageBin}`);

    const libraryDir = referenceLibraryDir();
    mkdirSync(libraryDir, { recursive: true });
    const fixtureDownloadStart = Date.now();
    await downloadUrl(FIXTURE_ZIM_URL, join(libraryDir, "kiwix-small.zim"), {
      expectedSha256: FIXTURE_ZIM_SHA256,
      expectedBytes: FIXTURE_ZIM_BYTES,
    });
    console.log(`fixture ZIM download (real, sha256-verified): ${Date.now() - fixtureDownloadStart}ms`);

    await registerKiwixSidecar(bins);
    await startSidecar(KIWIX_SIDECAR_ID);

    const status = getSidecar(KIWIX_SIDECAR_ID);
    console.log(`sidecar status after start: ${JSON.stringify(status)}`);
    if (status?.status !== "running" || !status.baseUrl) {
      console.error("FAIL: kiwix-serve never reached running");
    } else {
      const suggestUrl = `${status.baseUrl}/suggest?content=kiwix-small&term=Test`;
      const res = await fetch(suggestUrl);
      const body = await res.text();
      console.log(`\nGET ${suggestUrl} -> ${res.status}`);
      console.log(body);

      await stopSidecar(KIWIX_SIDECAR_ID);

      const matched = res.status === 200 && body.includes("Test ZIM file");
      console.log("\n## Result\n");
      console.log(matched
        ? "PASS: /suggest returned a real title match from the fixture ZIM, served live on loopback by the real pinned kiwix-serve binary."
        : "FAIL: /suggest did not return the expected fixture title.");
      exitCode = matched ? 0 : 1;
    }
  } finally {
    rmSync(ownDataDir, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

main();
