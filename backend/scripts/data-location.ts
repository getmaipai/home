import { readFileSync } from "node:fs";
import { DATA_CLASSES } from "../src/lib/dataClasses";
import { checkPlacement } from "../src/lib/placement";
import { classDir } from "../src/lib/paths";

const [command, layoutFile] = process.argv.slice(2);
if (command !== "check") {
  console.error("Usage: bun backend/scripts/data-location.ts check [layout.json]");
  process.exit(2);
}
let layout: Record<string, string> = Object.fromEntries(DATA_CLASSES.map((item) => [item.id, classDir(item.id)]));
if (layoutFile) {
  try { layout = { ...layout, ...(JSON.parse(readFileSync(layoutFile, "utf8")) as Record<string, string>) }; }
  catch (error) { console.error(`Could not read layout: ${error instanceof Error ? error.message : String(error)}`); process.exit(2); }
}
const rows = await checkPlacement(layout, { runAs: process.env.MAIPAI_SERVICE_ACCOUNT });
for (const item of rows) console.log(`${item.kind.toUpperCase()}\t${item.id}\t${item.text}\tFix: ${item.fix}`);
if (rows.length === 0) console.log("PASS\tplacement\tAll data folders pass placement checks.");
