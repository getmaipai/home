// Pinned kiwix-tools binaries (KIWIX-SIDECAR-01, docs/plans/
// knowledge-sources-2026-09-24.md). Same "download, don't vendor" rule
// as the engine binaries (engineCatalog.ts, org CLAUDE.md > Third-party
// code and assets): a pinned version, a pinned URL, a checksum this
// repo recorded itself by downloading each asset once and hashing it -
// download.kiwix.org publishes an MD5 alongside each release (verified
// against it before computing this file's own sha256), never a binary
// tracked in git.
//
// One archive holds kiwix-serve, kiwix-manage and kiwix-search
// together (kiwixSidecar.ts uses both serve and manage from the same
// extracted directory) - one pin per platform is the whole install.
//
// The legacy notes' own warning (docs/plans/knowledge-sources-2026-09-24.md,
// "From the legacy code"): "Kiwix purges old kiwix-tools builds, so a
// pinned binary URL eventually returns 404. The release process re-pins,
// and a missing pin is a clear repair message, never a silent failure" -
// kiwixSidecar.ts's own install error path is that message; this file
// only ever names the binary, never guesses at one.
import type { HardwareInfo } from "@/lib/hardware";

export interface KiwixArchive {
  url: string;
  sha256: string;
  approxBytes: number;
}

export interface KiwixBinaryPin {
  id: string;
  /** Node's os.platform()/os.arch(), the same values hardware.ts's own
   * detection reports - no translation table, the same reason
   * engineCatalog.ts's own pin uses them directly. */
  platform: NodeJS.Platform;
  arch: string;
  label: string;
  archive: KiwixArchive;
  /** Verified end to end this session (downloaded, hashed against the
   * publisher's own MD5, extracted, `--version` and a real kiwix-serve
   * spawn against a fixture ZIM proven) - see docs/dev.md's KIWIX-SIDECAR-01
   * entry. False means the pin is real but unproven on real hardware,
   * the same meaning engineCatalog.ts's own flag carries. */
  verified: boolean;
}

export const KIWIX_BINARIES: KiwixBinaryPin[] = [
  {
    id: "kiwix-tools-3.8.2-macos-arm64",
    platform: "darwin",
    arch: "arm64",
    label: "kiwix-tools (macOS, Apple Silicon), 3.8.2",
    archive: {
      url: "https://download.kiwix.org/release/kiwix-tools/kiwix-tools_macos-arm64-3.8.2.tar.gz",
      sha256: "5c64d43176627e558a117146b02ea36b7da2b0cd3a332cbff075cde05d9585f9",
      approxBytes: 10_283_222,
    },
    verified: true,
  },
  {
    id: "kiwix-tools-3.8.1-win-x64",
    platform: "win32",
    arch: "x64",
    // Kiwix's own release directory has no 3.8.2 build for this
    // platform yet (checked live, 2026-09-24 - only win-x86_64-3.8.1.zip
    // exists; 3.8.2 exists for macOS and every Linux target). A real,
    // named version skew, not a guess: the next build that publishes a
    // matching Windows release re-pins this to 3.8.2.
    label: "kiwix-tools (Windows, x64), 3.8.1",
    archive: {
      url: "https://download.kiwix.org/release/kiwix-tools/kiwix-tools_win-x86_64-3.8.1.zip",
      sha256: "",
      approxBytes: 0,
    },
    // Real pin awaiting a real download+hash pass on this platform (no
    // Windows box in this session, the same gap engineCatalog.ts's own
    // Windows/CUDA pin names) - sha256/approxBytes are placeholders, not
    // a real pin yet, and selectKiwixBinary() below refuses to return an
    // entry with an empty sha256 so nothing can spawn an unverified
    // download by accident.
    verified: false,
  },
];

/** Written by kiwixSidecar.ts's ensureKiwixInstalled() only once the
 * archive has downloaded, verified and extracted successfully - the
 * same completion gate ENGINE_READY_MARKER gives llama-server, so a
 * crash mid-extraction is never mistaken for "already installed". */
export const KIWIX_READY_MARKER = ".kiwix-ready";

/** The one binary that matches this box, or null when nothing does (an
 * unsupported platform, or a real gap like the Windows placeholder
 * above with no real pin yet) - kiwixSidecar.ts's own install step
 * reports "no kiwix-tools build is pinned for this computer's platform
 * yet" rather than guessing. */
export function selectKiwixBinary(hw: Pick<HardwareInfo, "platform" | "arch">): KiwixBinaryPin | null {
  return (
    KIWIX_BINARIES.find(
      (b) => b.platform === hw.platform && b.arch === hw.arch && b.archive.sha256.length > 0,
    ) ?? null
  );
}
