// Imported FIRST by the memory benches, before "@/db" can open a database:
// that module opens, migrates, and applies any staged restore to whatever
// MAIPAI_DATA_DIR names (or the household default) at import time, so a
// guard inside main() runs too late. Only a directory under the OS temp
// root is accepted, the same shape tests/reset-db.ts insists on.
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const dir = process.env.MAIPAI_DATA_DIR;
if (!dir || !resolve(dir).startsWith(resolve(tmpdir()))) {
  console.error("MAIPAI_DATA_DIR must name a fresh directory under the system temp root; this bench seeds and deletes rows and never runs against a household's data directory.");
  process.exit(2);
}
