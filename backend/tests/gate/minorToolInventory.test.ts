import { describe, expect, test } from "bun:test";
import { decide } from "@/lib/gate/decide";
import { listInstalledManifests } from "@/lib/plugins";

// MINOR-SEARCH-01b: nobody can approve for a minor, so no tool offered in chat
// may ever answer "ask a parent" on a normal person turn. It either runs or is
// refused outright with its own line.
describe("MINOR-SEARCH-01b inventory: tools offered to a child or teen never ask a parent", () => {
  const offered = listInstalledManifests().filter((manifest) => manifest.offer);
  test("the inventory is not empty", () => {
    expect(offered.length).toBeGreaterThan(0);
  });
  for (const band of ["child", "teen"] as const) {
    for (const manifest of offered) {
      test(`${band}: ${manifest.id} never returns ask_parent`, () => {
        const result = decide({
          who: { personId: "inventory", role: band, band },
          what: { capabilities: manifest.permissions ?? [], consequential: manifest.consequential, minRole: manifest.min_role },
          context: { provenance: "person" },
        });
        expect(result.kind).not.toBe("ask_parent");
      });
    }
  }
});
