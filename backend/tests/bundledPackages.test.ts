import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashPackageDir, type BundledProvenance } from "@/lib/bundledPackages";
import { PACKAGES_DIR } from "@/lib/paths";

// scripts/refresh-bundled-packages.ts writes this right after copying
// each bundled package's current content from the catalog repo - "the
// copy matches the index" (session-d-packages-and-store.md step 6) is
// checkable here without a live sibling catalog checkout (this test
// stays offline and deterministic, the org testing standard) by
// recomputing the SAME hash from whatever's on disk right now and
// comparing it to what refresh last recorded. A mismatch means someone
// hand-edited a bundled package's checked-in copy instead of running
// `bun run refresh-bundled-packages` against catalog.
const provenance: BundledProvenance = JSON.parse(readFileSync(join(PACKAGES_DIR, "bundled-provenance.json"), "utf-8"));

test("at least one bundled package has recorded provenance", () => {
  expect(Object.keys(provenance).length).toBeGreaterThan(0);
});

describe("every provenance-tracked bundled package matches its recorded hash", () => {
  for (const [id, entry] of Object.entries(provenance)) {
    test(id, () => {
      expect(hashPackageDir(join(PACKAGES_DIR, id))).toBe(entry.sha256);
    });
  }
});
