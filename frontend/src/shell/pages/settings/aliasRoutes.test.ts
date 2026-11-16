// An alias route that lands on its own path redirects to itself forever: the page renders nothing and shows the loading colour.
// `/settings/backups` did this when Backups became a Settings area; this keeps any alias in App.tsx from doing it again.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aliasTarget } from "@/shell/pages/settings/settingsRedirects";

const appSource = readFileSync(join(import.meta.dir, "../../../App.tsx"), "utf8");
const aliasPaths = [...appSource.matchAll(/<AliasRedirect path="([^"]+)"/g)].map((match) => match[1]!);

describe("App.tsx alias routes", () => {
  test("every alias lands somewhere other than itself", () => {
    expect(aliasPaths.length).toBeGreaterThan(0);
    for (const path of aliasPaths) {
      for (const canManageHousehold of [true, false]) {
        expect({ path, lands: aliasTarget(path, { canManageHousehold }).split("?")[0] }).not.toEqual({ path, lands: path });
      }
    }
  });
  test("/settings/backups is the Backups area, not an alias", () => {
    expect(aliasPaths).not.toContain("/settings/backups");
  });
});
