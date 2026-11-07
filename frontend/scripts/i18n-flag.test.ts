import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePo } from "./po";

// Design note section 6: the `#, needs-review` flag must survive `lingui extract --clean`, or the review workflow loses its marker.
test("the needs-review flag survives lingui extract", () => {
  const scratch = mkdtempSync(join(tmpdir(), "maipai-i18n-flag-"));
  try {
    cpSync("src/locales", join(scratch, "locales"), { recursive: true });
    const path = join(scratch, "locales/es/messages.po");
    const po = readFileSync(path, "utf8").replace(/(#: [^\n]+\n)(msgid "Today")/, "#, needs-review\n$1$2").replace(/#, needs-review\n(#: [^\n]+\n)msgid "Today"/, "$1#, needs-review\nmsgid \"Today\"");
    writeFileSync(path, po);
    expect(parsePo(po).find((entry) => entry.id === "Today")?.flags).toEqual(["needs-review"]);
    const result = spawnSync("bunx", ["lingui", "extract", "--clean"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NODE_ENV: "development", MAIPAI_I18N_CATALOGS: join(scratch, "locales") } });
    expect(result.stderr + result.stdout).toContain("Catalog statistics");
    expect(result.status).toBe(0);
    const after = parsePo(readFileSync(path, "utf8")).find((entry) => entry.id === "Today");
    expect(after?.flags).toContain("needs-review");
    expect(after?.msgstr).toBe("Hoy");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120000);
