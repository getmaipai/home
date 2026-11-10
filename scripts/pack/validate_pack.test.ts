import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadSpec, validatePack, validatePackDir } from "./validate_pack";

const read = async (name: string) => {
  const spec = await loadSpec();
  return JSON.parse(readFileSync(join(spec.dir, "fixtures", "companion-pack", `${name}.json`), "utf8"));
};

describe("companion pack validator", () => {
  for (const id of ["man", "clay", "pixar"]) {
    test(`valid-${id} fixture has no problems`, async () => {
      expect(await validatePack(await read(`valid-${id}`))).toEqual([]);
    });
  }

  test("a track whose length is not frames fails", async () => {
    const pack = await read("valid-man");
    pack.states.idle[0].track.pop();
    const problems = await validatePack(pack);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" ")).toContain("track");
  });

  test("a pack over the desktop byte limit fails", async () => {
    const problems = await validatePack(await read("valid-man"), { "clips/idle1.mp4": 13_000_000 });
    expect(problems.join(" ")).toContain("12582912");
  });

  test("a folder missing the files pack.json names reports them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-validate-"));
    mkdirSync(join(dir, "clips"));
    writeFileSync(join(dir, "pack.json"), JSON.stringify(await read("valid-clay")));
    writeFileSync(join(dir, "clips", "idle1.mp4"), "x");
    const r = await validatePackDir(dir);
    expect(r.problems.some((p) => p.includes("clips/idle2.mp4") && p.includes("not in the folder"))).toBe(true);
    expect(r.problems.some((p) => p.includes("phone twin"))).toBe(true);
  });
});

/** Width and height of a WebP file (VP8, VP8L or VP8X), read from its header. */
export function webpSize(b: Uint8Array): [number, number] {
  const kind = String.fromCharCode(...b.slice(12, 16));
  if (kind === "VP8X") return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
  if (kind === "VP8L") {
    const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)];
  }
  return [(b[26] | (b[27] << 8)) & 0x3fff, (b[28] | (b[29] << 8)) & 0x3fff];
}

/** data-scratch/packs of the main checkout: MAIPAI_PACKS_DIR, else searched upward from here (this repo, or home/ beside a worktree). */
function packsRoot(): string {
  if (process.env.MAIPAI_PACKS_DIR) return process.env.MAIPAI_PACKS_DIR;
  for (let d = import.meta.dir; dirname(d) !== d; d = dirname(d)) {
    for (const c of [join(d, "data-scratch", "packs"), join(d, "home", "data-scratch", "packs")]) if (existsSync(c)) return c;
  }
  return "";
}

describe("built packs (skipped when data-scratch/packs has none)", () => {
  const root = packsRoot();
  for (const id of ["man", "clay", "pixar"]) {
    const dir = join(root, id);
    test(`${id}: mouth meta.json matches the atlas dimensions`, () => {
      if (!existsSync(join(dir, "pack.json"))) return;
      for (const set of ["calm", "shout"]) {
        const meta = JSON.parse(readFileSync(join(dir, "mouth", set, "meta.json"), "utf8"));
        const [w, h] = webpSize(readFileSync(join(dir, "mouth", set, "atlas.webp")));
        const tiles = meta.base + 64 * meta.ts.length;
        expect([w, h]).toEqual([meta.cols * meta.tw, Math.ceil(tiles / meta.cols) * meta.th]);
        if ("nt" in meta) expect(meta.nt).toBe(meta.ts.length);
      }
    });
    test(`${id}: validates and stays within the desktop budget`, async () => {
      if (!existsSync(join(dir, "pack.json"))) return;
      const r = await validatePackDir(dir);
      expect(r.problems).toEqual([]);
      expect(r.bytes).toBeLessThanOrEqual(12582912);
    });
  }
});

test("a flow file whose extension disagrees with flowEncoding fails", async () => {
  const pack = await read("valid-man");
  pack.head.flowEncoding = "int16-deflate";
  const problems = await validatePack(pack, { "head/meta.json": 1, "head/head.flow.bin": 10 });
  expect(problems.join(" ")).toContain("int16-deflate");
});
