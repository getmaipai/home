#!/usr/bin/env bun
// PACK-06: install a companion pack into a household companion (dev tool, no UI yet).
//   bun run scripts/pack/install_pack.ts <companion-id> <pack folder> [--data-dir <dir>]
// Validates the folder with the PACK-02 checks first, then copies it to <data dir>/companions/<id>/pack/.
// The data dir is --data-dir, else MAIPAI_DATA_DIR, else ./data.
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { validatePackDir } from "./validate_pack";

const args = process.argv.slice(2);
const at = args.indexOf("--data-dir");
const dataDir = resolve(at >= 0 ? args.splice(at, 2)[1]! : process.env.MAIPAI_DATA_DIR || "data");
const [id, source] = args;
if (!id || !source) { console.error("Usage: bun run scripts/pack/install_pack.ts <companion-id> <pack folder> [--data-dir <dir>]"); process.exit(2); }
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) { console.error(`"${id}" is not a companion id; use the folder name under data/companions.`); process.exit(2); }
const companion = join(dataDir, "companions", id);
if (!existsSync(companion)) { console.error(`No companion folder at ${companion}; create the companion first or pass --data-dir.`); process.exit(1); }
const result = await validatePackDir(resolve(source));
if (result.problems.length) {
  for (const p of result.problems) console.error(`PROBLEM ${result.id}: ${p}`);
  console.error("Not installed: fix the problems above and run again.");
  process.exit(1);
}
const target = join(companion, "pack");
rmSync(target, { recursive: true, force: true });
cpSync(resolve(source), target, { recursive: true });
console.log(`Installed ${result.id} (${result.bytes} bytes) into ${target}`);
