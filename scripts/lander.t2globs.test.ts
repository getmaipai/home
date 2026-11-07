import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("lander matches new paths with T2 globs literally", async () => {
  const root = mkdtempSync(join(tmpdir(), "lander-t2-"));
  try {
    mkdirSync(join(root, "backend/src/db/migrations"), { recursive: true });
    mkdirSync(join(root, "backend/src/routes"), { recursive: true });
    writeFileSync(join(root, "backend/src/db/migrations/0001_a.sql"), "-- fixture\n");
    const source = await Bun.file(join(import.meta.dir, "lander.sh")).text();
    const start = source.indexOf("safety_surface_files() {");
    const end = source.indexOf("\n}\n", start) + 2;
    const fn = source.slice(start, end);
    writeFileSync(join(root, "test.sh"), `#!/usr/bin/env bash\nset -euo pipefail\ncheckout='${root}'\ndata='${root}'\npipeline_main_sha() { echo main; }\ngit() { printf '%s\\n' 'export WT_T2_GLOBS="backend/src/db/migrations/* backend/src/routes/auth*.ts"'; }\n${fn}\nsafety_surface_files 'backend/src/db/migrations/0002_new.sql backend/src/routes/auth.ts frontend/src/App.tsx'`);
    const out = spawnSync("bash", [join(root, "test.sh")], { encoding: "utf8" });
    expect(out.status).toBe(0);
    expect(out.stdout.trim().split("\n")).toEqual(["backend/src/db/migrations/0002_new.sql", "backend/src/routes/auth.ts"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
