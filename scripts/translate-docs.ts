import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { translateItems, type Completer } from "../backend/src/lib/translate/core";
import { stackCompleter, stackOnlyFetch, type Fetch } from "../backend/src/lib/translate/engine";
import { splitMarkdown, joinMarkdown } from "../backend/src/lib/translate/markdown";
import { parsePo } from "../frontend/scripts/po";

type Glossary = { dialect?: string; style?: string[]; [term: string]: unknown };
export type TranslateDocsOptions = { locale: string; date: string; root?: string; dryRun?: boolean; check?: boolean; path?: string; completer?: Completer; spot?: boolean };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const listFiles = (dir: string): string[] => !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? listFiles(join(dir, entry.name)) : /\.mdx?$/.test(entry.name) ? [join(dir, entry.name)] : []);
function frontmatter(source: string): string { const match = source.match(/^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$))/); return match?.[1] ?? "---\n---\n"; }
function withMetadata(source: string, hash: string, date: string): string {
  const fm = frontmatter(source);
  const additions = `machine_translated: true\nsource_sha256: ${hash}\ntranslated_at: ${date}`;
  const cleaned = fm.replace(/^(machine_translated|source_sha256|translated_at):.*(?:\r?\n|$)/gm, "");
  const base = cleaned.replace(/\r?\n---(?:\r?\n|$)$/, "\n");
  return `${base}${additions}\n---\n${source.slice(fm.length)}`;
}
export function isTranslationStale(source: string, translated: string | null): boolean {
  const match = translated?.match(/^source_sha256:\s*([a-f\d]+)/m);
  return !match || match[1] !== sha(source);
}
function sourceOutput(root: string, file: string): string {
  const userRoot = join(root, "docs/user");
  if (file.startsWith(userRoot + sep)) return join(userRoot, "<locale>", relative(userRoot, file));
  const content = join(root, "docs/site-fumadocs/content/docs");
  return join(content, "<locale>", relative(content, file));
}
export async function translateDocs(options: TranslateDocsOptions): Promise<{ stale: string[]; written: string[]; untranslated: number }> {
  const root = options.root ?? process.cwd();
  const userRoot = join(root, "docs/user");
  const contentRoot = join(root, "docs/site-fumadocs/content/docs");
  let files = [...listFiles(userRoot), ...listFiles(contentRoot).filter((file) => !relative(contentRoot, file).split(sep).some((part) => ["es", "en", "fr", "de", "ja", "zh"].includes(part)))];
  files = files.filter((file) => !file.includes("/docs/design/") && !file.includes("/docs/api/") && !file.includes("/docs/dev/"));
  if (options.path) files = files.filter((file) => file === join(root, options.path!));
  const glossary = JSON.parse(readFileSync(join(root, "frontend/src/locales/glossary.json"), "utf8")) as Glossary;
  const po = parsePo(readFileSync(join(root, `frontend/src/locales/${options.locale}/messages.po`), "utf8"));
  const catalog = new Map(po.filter((entry) => entry.msgstr && !entry.flags.includes("fuzzy")).map((entry) => [entry.id, entry.msgstr]));
  const note = "Translated by your home's AI. It may read oddly.";
  const stale: string[] = [];
  const written: string[] = [];
  let untranslated = 0;
  const stack = (process.env.MAIPAI_STACK_URL ?? "http://127.0.0.1:8770").replace(/\/$/, "");
  const doFetch = stackOnlyFetch(stack);
  const completer = options.completer ?? stackCompleter(stack, doFetch as Fetch);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const output = sourceOutput(root, file).replace("<locale>", options.locale);
    const existing = existsSync(output) ? readFileSync(output, "utf8") : null;
    if (!isTranslationStale(source, existing)) continue;
    stale.push(output);
    if (options.check || options.dryRun) continue;
    const split = splitMarkdown(source);
    const labels = Object.fromEntries(split.segments.flatMap((segment) => [...segment.text.matchAll(/\*\*([^*]+)\*\*/g)].flatMap((match) => {
      const entry = catalog.get(match[1]!);
      return entry ? [[match[1]!, entry] as const] : [];
    })));
    const baseGlossary = Object.fromEntries(Object.entries(glossary).filter(([key]) => key !== "dialect" && key !== "style"));
    const allGlossary = { ...baseGlossary, ...labels };
    const keep = [...new Set(split.segments.flatMap((segment) => [
      ...segment.keep,
      ...[...segment.text.matchAll(/!?\[[^\]]*\]\([^)]*\)/g)].map((match) => match[0]!),
    ]))];
    const items = split.segments.map((segment) => segment.text.trim());
    const result = await translateItems({ items, from: "en", to: options.locale, kind: "doc", completer, keep, spot: options.spot === true, glossary: allGlossary, dialect: glossary.dialect, style: glossary.style });
    untranslated += result.failed.length;
    const translated = split.segments.map((segment, i) => {
      const original = segment.text;
      const leading = original.match(/^\s*/)?.[0] ?? "";
      const trailing = original.match(/\s*$/)?.[0] ?? "";
      const candidate = result.results[i] ?? original.trim();
      const rebuilt = leading + candidate + trailing;
      const count = (text: string, token: string) => text.split(token).length - 1;
      const intact = ["**", "[", "](", "`"] .every((token) => count(rebuilt, token) === count(original, token));
      if (!intact) { untranslated += 1; return original; }
      return rebuilt;
    });
    let body = joinMarkdown(source, split.segments, translated);
    body = body.replace(/^(# .*\r?\n)/m, `$1\n${note}\n`);
    const finalText = withMetadata(body, sha(source), options.date);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, finalText);
    written.push(output);
  }
  return { stale, written, untranslated };
}
if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (key: string) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  const locale = value("--locale");
  if (!locale) { console.error("Use --locale <locale>."); process.exit(2); }
  const result = await translateDocs({ locale, date: value("--date") ?? new Date().toISOString().slice(0, 10), path: value("--path"), dryRun: args.includes("--dry-run"), check: args.includes("--check"), spot: args.includes("--spot") });
  if (args.includes("--check")) {
    for (const path of result.stale) console.log(path);
    if (result.stale.length) process.exit(1);
  } else if (args.includes("--dry-run")) for (const path of result.stale) console.log(path);
  else console.log(`Translated ${result.written.length} documents.${result.untranslated ? ` ${result.untranslated} lines stayed in English because the model could not translate them.` : ""}`);
}
