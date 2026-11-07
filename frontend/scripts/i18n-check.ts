// `bun run i18n:check` (design note section 6): catalogs are current, every locale has a catalog with a Language header,
// placeholders match the source, no U+2014, and no needs-review flag on protected copy (section 5).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SUPPORTED_LOCALES } from "../src/supportedLocales";
import { parsePo } from "./po";
import { isProtected } from "./translate-catalog";

const fail = (message: string): never => { console.error(message); process.exit(1); };
// Line numbers in `#:` origins move whenever a file is edited; a catalog is stale only when ids or files change.
const normalise = (po: string) => po.replace(/^"POT-Creation-Date:.*\n/m, "").replace(/^(#: \S+?):\d+$/gm, "$1");
const scratch = mkdtempSync(join(tmpdir(), "maipai-i18n-check-"));
try {
  cpSync("src/locales", join(scratch, "locales"), { recursive: true });
  const result = spawnSync("bunx", ["lingui", "extract", "--clean"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NODE_ENV: "development", MAIPAI_I18N_CATALOGS: join(scratch, "locales") } });
  if (result.status !== 0) { process.stderr.write(result.stderr + result.stdout); process.exit(result.status ?? 1); }
  for (const locale of SUPPORTED_LOCALES) {
    const committed = `src/locales/${locale}/messages.po`;
    if (!existsSync(committed)) fail(`${locale} is in supportedLocales.ts but ${committed} does not exist; run bun run i18n:extract.`);
    if (normalise(readFileSync(committed, "utf8")) !== normalise(readFileSync(join(scratch, "locales", locale, "messages.po"), "utf8"))) {
      fail(`${committed} is stale (an id was added, removed or moved in source); run bun run i18n:extract and commit the catalogs.`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const placeholders = (value: string) => [...value.matchAll(/\{\s*\w+(?=\s*[,}])|<\/?\d+\/?>/g)].map((match) => match[0].replace(/\s+/g, "")).sort();
for (const locale of SUPPORTED_LOCALES) {
  const text = readFileSync(`src/locales/${locale}/messages.po`, "utf8");
  if (!text.includes(`"Language: ${locale}\\n"`)) fail(`src/locales/${locale}/messages.po has no Language: ${locale} header.`);
  let flagged = 0;
  for (const entry of parsePo(text)) {
    if (locale === "en-US") continue;
    if (entry.msgstr.includes("—")) fail(`${locale}: "${entry.id}" contains an em dash (U+2014); rewrite the line.`);
    if (entry.msgstr && JSON.stringify(placeholders(entry.id)) !== JSON.stringify(placeholders(entry.msgstr))) fail(`${locale}: "${entry.id}" changes its placeholders; keep every {name} exactly.`);
    if (entry.flags.includes("needs-review")) {
      flagged += 1;
      if (isProtected(entry.refs, entry.id)) fail(`${locale}: "${entry.id}" is protected copy (child, teen, crisis, consent, refusal, spoken, robot or SEARCH-DOWN-EMPTY-01) and still has needs-review; a person must review it (--accept).`);
    }
  }
  if (flagged) console.log(`${locale}: ${flagged} entries await review.`);
}
// A -x-child or -x-teen catalog may not carry the flag at all.
for (const mode of ["child", "teen"]) for (const locale of SUPPORTED_LOCALES) {
  const path = `src/locales/${locale}-x-${mode}/messages.po`;
  if (existsSync(path) && parsePo(readFileSync(path, "utf8")).some((entry) => entry.flags.includes("needs-review"))) fail(`${path} has a needs-review entry; mode catalogs must be reviewed.`);
}
console.log("Catalogs are current; Search and Today still translate.");
