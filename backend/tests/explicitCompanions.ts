// DYNAMIC-COMPANION-01: no bundled companion is explicit, so tests of the age rule write two as packages.
// `installExplicitCompanions()` in beforeAll and `removeExplicitCompanions()` in afterAll; both re-read the persona catalog.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGES_DIR } from "../src/lib/paths";
import { __reloadPersonasForTests } from "../src/lib/persona";

const EXPLICIT = { "zz-test-teen": "teen", "zz-test-adult": "adult" } as const;

export function installExplicitCompanions(): void {
  for (const [id, audience] of Object.entries(EXPLICIT)) {
    mkdirSync(join(PACKAGES_DIR, id), { recursive: true });
    const manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, "lively-adult", "manifest.json"), "utf-8"));
    writeFileSync(join(PACKAGES_DIR, id, "manifest.json"), JSON.stringify({ ...manifest, id, display: id, min_role: audience, companion: { ...manifest.companion, display_name: id === "zz-test-teen" ? "Tester Teen" : "Tester Adult", audience } }));
  }
  __reloadPersonasForTests();
}

export function removeExplicitCompanions(): void {
  for (const id of Object.keys(EXPLICIT)) rmSync(join(PACKAGES_DIR, id), { recursive: true, force: true });
  __reloadPersonasForTests();
}
