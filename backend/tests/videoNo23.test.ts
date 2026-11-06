import { describe, expect, test } from "bun:test";
import { chooseVideoQuality, VIDEO_QUALITY_NOTE_LINE } from "@/lib/videos/quality";
import { readyVideoStatusForTests } from "@/lib/videos/ready";
import { loraUsable } from "@/lib/loras/access";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("retired video maker and style base", () => {
  test("no lane, style, picture, requested quality, readiness or Max combination selects a retired maker", () => {
    const cases: Array<Parameters<typeof chooseVideoQuality>[0]> = [];
    for (const adultLane of [false, true]) for (const quickOnly of [false, true])
      for (const style of [undefined, { base_model: "wan2.2-ti2v-5b" }, { base_model: "ltx-2.5" }, { base_model: "ltx-2.3" }])
        for (const hasPicture of [false, true]) for (const requested of [undefined, "quick", "detailed"] as const)
          for (const ltx25 of ["missing", "ready"] as const) for (const max of [false, true]) {
            cases.push({ adultLane, quickOnly, style, hasPicture, requested, engine: readyVideoStatusForTests({ ltx25, ltx25max: max ? "ready" : "missing", ltx25Picture: true, ltx25maxPicture: true }), max });
          }
    for (const input of cases) expect(chooseVideoQuality(input).maker).not.toBe("ltx23");
  });

  test("old style records are unusable, while their base remains readable", () => {
    const old = { removed_at: null, base_model: "ltx-2.3", compatible_with: ["ltx-2.3"] } as never;
    expect(loraUsable(old)).toBe(false);
    expect(chooseVideoQuality({ style: { base_model: "ltx-2.3" }, engine: readyVideoStatusForTests({ ltx25: "ready" }), adultLane: true }).maker).toBe("wan");
  });

  test("quality note lines contain no retired or technical model names", () => {
    for (const line of Object.values(VIDEO_QUALITY_NOTE_LINE)) expect(line).not.toMatch(/2\.3|LTX|Detailed model/i);
  });

  test("setup plan and models package copy do not tell anyone to install the retired version", () => {
    const roots = [join(import.meta.dir, "../src"), join(import.meta.dir, "../packages")];
    const files = roots.flatMap((root) => {
      const visit = (dir: string): string[] => require("node:fs").readdirSync(dir, { withFileTypes: true }).flatMap((entry: { name: string; isDirectory(): boolean }) => entry.isDirectory() ? visit(join(dir, entry.name)) : [join(dir, entry.name)]);
      return visit(root);
    });
    for (const file of files) {
      if (!/setup|model|plan/i.test(file)) continue;
      const copy = readFileSync(file, "utf8");
      expect(copy).not.toMatch(/install[^\n]{0,100}2\.3|2\.3[^\n]{0,100}install/i);
    }
  });
});
