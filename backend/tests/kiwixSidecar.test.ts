// KIWIX-SIDECAR-01. Deterministic and offline: `regenerateLibrary()`
// and `registerKiwixSidecar()` are driven with a scripted stand-in for
// kiwix-manage/kiwix-serve (this file never downloads the real pinned
// binary or reaches kiwix.org), the same "drive the code, don't touch
// the network" shape every other test in this repo uses. The real
// binary, the real pinned download, and a real kiwix-serve spawn
// against the committed fixture ZIM are proven live instead
// (scripts/bench/kiwix-sidecar-01-live.ts, dev.md has the numbers).
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { selectKiwixBinary } from "@/lib/kiwixCatalog";
import { referenceLibraryDir, regenerateLibrary, registerKiwixSidecar, kiwixBaseUrl, KIWIX_SIDECAR_ID, KIWIX_SERVE_PORT } from "@/lib/kiwixSidecar";
import { getSidecar, __resetSidecarsForTests } from "@/lib/sidecars";
import { __resetFixHandlersForTests } from "@/lib/issues";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { defaultReferenceLibraryDir } from "@/lib/paths";

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
  __resetSidecarsForTests();
});

afterEach(() => {
  __resetSidecarsForTests();
});

describe("selectKiwixBinary()", () => {
  test("matches this repo's own real pin for darwin/arm64", () => {
    const pin = selectKiwixBinary({ platform: "darwin", arch: "arm64" });
    expect(pin?.id).toBe("kiwix-tools-3.8.2-macos-arm64");
  });

  test("an unpinned platform/arch pair returns null, never a guess", () => {
    expect(selectKiwixBinary({ platform: "linux", arch: "x64" })).toBeNull();
  });

  test("a pin with no real sha256 (the Windows placeholder) is never selected - a real pin only, never an unverified one", () => {
    expect(selectKiwixBinary({ platform: "win32", arch: "x64" })).toBeNull();
  });
});

describe("referenceLibraryDir()", () => {
  test("resolves to Home's own data folder when the setting is unset", () => {
    expect(referenceLibraryDir()).toBe(defaultReferenceLibraryDir);
  });

  test("resolves to the household's own chosen directory once set", () => {
    setHouseholdSettingValue("reference.library_dir", "/Volumes/library-drive/maipai-reference");
    expect(referenceLibraryDir()).toBe("/Volumes/library-drive/maipai-reference");
  });
});

describe("regenerateLibrary()", () => {
  // A scripted stand-in for kiwix-manage: appends one <book> line per
  // "add" call, real enough to prove regenerateLibrary()'s own
  // orchestration (one call per .zim file, the library path it wrote
  // to) without the real binary or a real ZIM's metadata.
  const fakeManage = join(import.meta.dir, "fixtures", "fakeKiwixManage.sh");

  test("writes a valid, empty library.xml when the directory has no ZIM files", async () => {
    const dir = join(process.env.MAIPAI_DATA_DIR!, "empty-library");
    const libraryPath = await regenerateLibrary(fakeManage, dir);
    expect(libraryPath).toBe(join(dir, "library.xml"));
    const xml = readFileSync(libraryPath, "utf-8");
    expect(xml).toContain("<library");
    expect(xml).not.toContain("<book");
  });

  test("calls kiwix-manage once per .zim file found, ignoring everything else", async () => {
    const dir = join(process.env.MAIPAI_DATA_DIR!, "populated-library");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.zim"), "");
    writeFileSync(join(dir, "b.zim"), "");
    writeFileSync(join(dir, "not-a-zim.txt"), "");
    const libraryPath = await regenerateLibrary(fakeManage, dir);
    const xml = readFileSync(libraryPath, "utf-8");
    expect((xml.match(/<book/g) ?? []).length).toBe(2);
    expect(xml).toContain("a.zim");
    expect(xml).toContain("b.zim");
    expect(xml).not.toContain("not-a-zim.txt");
  });

  test("regenerating twice replaces the file rather than appending to a stale one", async () => {
    const dir = join(process.env.MAIPAI_DATA_DIR!, "regen-library");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.zim"), "");
    await regenerateLibrary(fakeManage, dir);
    writeFileSync(join(dir, "b.zim"), "");
    const libraryPath = await regenerateLibrary(fakeManage, dir);
    const xml = readFileSync(libraryPath, "utf-8");
    expect((xml.match(/<book/g) ?? []).length).toBe(2);
  });
});

describe("registerKiwixSidecar()", () => {
  // A scripted stand-in for kiwix-serve: a plain HTTP server on the
  // exact port/health shape the real binary would answer on, so
  // startSidecar() (called separately, sidecars.test.ts's own domain)
  // could reach "running" against it exactly as it would against the
  // real thing - this describe block only proves what gets registered,
  // not the spawn/health-poll machinery sidecars.test.ts already covers.
  const fakeServe = join(import.meta.dir, "fixtures", "fakeKiwixServe.sh");
  const fakeManage = join(import.meta.dir, "fixtures", "fakeKiwixManage.sh");

  test("registers with the real port, loopback health URL, and backupMode exclude", async () => {
    await registerKiwixSidecar({ serveBin: fakeServe, manageBin: fakeManage });
    expect(getSidecar(KIWIX_SIDECAR_ID)).toEqual({ status: "stopped", baseUrl: `http://127.0.0.1:${KIWIX_SERVE_PORT}` });
  });

  test("kiwixBaseUrl() reads the same registered sidecar's own base URL", async () => {
    expect(kiwixBaseUrl()).toBeNull();
    await registerKiwixSidecar({ serveBin: fakeServe, manageBin: fakeManage });
    expect(kiwixBaseUrl()).toBe(`http://127.0.0.1:${KIWIX_SERVE_PORT}`);
  });

  test("writes library.xml under the reference library directory before registering", async () => {
    // Its own isolated directory, not the shared defaultReferenceLibraryDir
    // other tests in this file also register against - sibling tests
    // running first would otherwise already have written this exact file.
    const dir = join(process.env.MAIPAI_DATA_DIR!, "writes-library-xml");
    setHouseholdSettingValue("reference.library_dir", dir);
    const libraryPath = join(dir, "library.xml");
    expect(existsSync(libraryPath)).toBe(false);
    await registerKiwixSidecar({ serveBin: fakeServe, manageBin: fakeManage });
    expect(existsSync(libraryPath)).toBe(true);
  });
});
