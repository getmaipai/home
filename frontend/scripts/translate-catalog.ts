// I18N-F0 (design note section 7): fill untranslated catalog entries through the household's own Stack chat role, flag every
// fill `needs-review`, and never touch protected copy. Run: bun scripts/translate-catalog.ts --locale es [--file <text>]
// [--max-batches N] [--dry-run] [--redo] [--review] [--accept <file|id>]. The only host it talks to is the Stack.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { englishSources, parsePo, rewriteEntries, type PoEntry } from "./po";
import { translateItems, type Completer } from "../../backend/src/lib/translate/core";
import { chatReady, stackCompleter, stackOnlyFetch, StackNotReadyError, type Fetch } from "../../backend/src/lib/translate/engine";
export { stackOnlyFetch, StackNotReadyError } from "../../backend/src/lib/translate/engine";
import { isProtected as coreIsProtected, validateTranslation as coreValidateTranslation } from "../../backend/src/lib/translate/validate";

export type { Fetch };
export type Glossary = { dialect?: string; style?: string[]; [term: string]: unknown };
export type Report = { filled: string[]; failed: string[]; refused: string[]; batches: number; stopped?: string };

export const MAX_BATCH_ENTRIES = 150;
export const isProtected = coreIsProtected;
export const validateTranslation = (source: string, msgstr: string): string | null => coreValidateTranslation(source, msgstr, "ui");
export const sourceFile = (entry: Pick<PoEntry, "refs">): string => (entry.refs[0] ?? "unknown").replace(/:\d+$/, "");

/** Entries to translate: empty msgstr (flagged ones too with --redo). A filled, unflagged entry is reviewed and final. */
export function candidates(entries: PoEntry[], redo = false): PoEntry[] {
  return entries.filter((entry) => entry.msgstr === "" || (redo && entry.flags.includes("needs-review")));
}

/** One batch per source file; a file past the limit is split. */
export function planBatches(entries: PoEntry[], limit = MAX_BATCH_ENTRIES): Array<{ file: string; entries: PoEntry[] }> {
  const byFile = new Map<string, PoEntry[]>();
  for (const entry of entries) byFile.set(sourceFile(entry), [...(byFile.get(sourceFile(entry)) ?? []), entry]);
  const batches: Array<{ file: string; entries: PoEntry[] }> = [];
  for (const [file, list] of byFile) for (let i = 0; i < list.length; i += limit) batches.push({ file, entries: list.slice(i, i + limit) });
  return batches;
}

export type TranslateOptions = {
  locale: string; poPath: string; glossary: Glossary; stackUrl: string; fetch?: Fetch;
  file?: string; maxBatches?: number; dryRun?: boolean; redo?: boolean; spot?: boolean;
};

/** Returns the new .po text (unchanged on a dry run) and a report. Writing the file is the caller's job. */
export async function translateCatalog(options: TranslateOptions): Promise<{ text: string; report: Report }> {
  const doFetch = stackOnlyFetch(options.stackUrl, options.fetch);
  const stack = options.stackUrl.replace(/\/$/, "");
  const original = readFileSync(options.poPath, "utf8");
  const report: Report = { filled: [], failed: [], refused: [], batches: 0 };
  const enUs = join(dirname(dirname(options.poPath)), "en-US", "messages.po");
  const sources = existsSync(enUs) ? englishSources(readFileSync(enUs, "utf8")) : new Map<string, string>();
  const all = candidates(parsePo(original), options.redo).map((entry) => ({ ...entry, source: sources.get(entry.id) })).filter((entry) => !options.file || sourceFile(entry).includes(options.file));
  for (const entry of all) if (isProtected(entry.refs, entry.id)) report.refused.push(entry.id);
  const batches = planBatches(all.filter((entry) => !isProtected(entry.refs, entry.id)));
  if (options.dryRun) { report.batches = batches.length; return { text: original, report }; }
  const changes = new Map<string, { msgstr: string; flag: true }>();
  for (const batch of batches.slice(0, options.maxBatches ?? batches.length)) {
    report.batches += 1;
    try {
      const result = await translateItems({
        items: batch.entries.map((entry) => entry.source ?? entry.id), from: "en",
        to: options.locale === "en-GB" ? "British English (spelling and vocabulary only; return the text unchanged when no change is needed)" : options.locale,
        kind: "ui", completer: stackCompleter(stack, doFetch), glossary: Object.fromEntries(Object.entries(options.glossary).filter(([key]) => key !== "dialect" && key !== "style")),
        dialect: options.glossary.dialect, style: options.glossary.style, batchSize: MAX_BATCH_ENTRIES, spot: options.spot ?? false,
      });
      result.results.forEach((out, index) => {
        const entry = batch.entries[index]!;
        if (out !== null && !(options.locale === "en-GB" && out === (entry.source ?? entry.id))) changes.set(entry.id, { msgstr: out, flag: true });
      });
      report.failed.push(...result.failed.filter((index) => options.locale !== "en-GB" || result.results[index] !== (batch.entries[index]!.source ?? batch.entries[index]!.id)).map((index) => batch.entries[index]!.id));
    } catch (error) {
      if (!(error instanceof StackNotReadyError)) throw error;
      report.stopped = error.message;
      report.batches -= 1;
      break;
    }
  }
  report.filled = [...changes.keys()];
  return { text: rewriteEntries(original, changes), report };
}

/** Clear the flag on entries a person has reviewed: by id or by source file. */
export function acceptEntries(text: string, selector: string): { text: string; accepted: string[] } {
  const hit = parsePo(text).filter((entry) => entry.flags.includes("needs-review") && (entry.id === selector || sourceFile(entry) === selector));
  return { text: rewriteEntries(text, new Map(hit.map((entry) => [entry.id, { flag: false }]))), accepted: hit.map((entry) => entry.id) };
}

/** data-scratch/i18n-review/<locale>.md rows: English, translation, back translation, source file. */
export async function reviewList(options: { locale: string; poPath: string; stackUrl: string; fetch?: Fetch }): Promise<string> {
  const doFetch = stackOnlyFetch(options.stackUrl, options.fetch);
  const stack = options.stackUrl.replace(/\/$/, "");
  const flagged = parsePo(readFileSync(options.poPath, "utf8")).filter((entry) => entry.flags.includes("needs-review"));
  let back: Record<string, string> = {};
  if (flagged.length && (await chatReady(stack, doFetch))) {
    try {
      const result = await translateItems({ items: flagged.map((entry) => entry.msgstr), from: options.locale, to: "en", kind: "ui", completer: stackCompleter(stack, doFetch), spot: false });
      back = Object.fromEntries(result.results.flatMap((text, index) => text === null ? [] : [[flagged[index]!.id, text]]));
    } catch { /* the list is still useful without back translations */ }
  }
  return flagged.map((entry) => `- ${entry.id}\n  - ${options.locale}: ${entry.msgstr}\n  - back: ${back[entry.id] ?? "(not available)"}\n  - file: ${sourceFile(entry)}`).join("\n") + "\n";
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const locale = value("--locale");
  if (!locale || !["es", "en-GB"].includes(locale)) { console.error("Use --locale es or --locale en-GB."); process.exit(2); }
  const poPath = join(process.cwd(), `src/locales/${locale}/messages.po`);
  const stackUrl = process.env.MAIPAI_STACK_URL ?? "http://127.0.0.1:8770";
  const accept = value("--accept");
  if (accept) {
    const result = acceptEntries(readFileSync(poPath, "utf8"), accept);
    writeFileSync(poPath, result.text);
    console.log(`Cleared the review flag on ${result.accepted.length} entries.`);
    process.exit(0);
  }
  const glossary = JSON.parse(readFileSync(join(process.cwd(), "src/locales/glossary.json"), "utf8")) as Glossary;
  const { text, report } = await translateCatalog({ locale, poPath, glossary, stackUrl, file: value("--file"), maxBatches: value("--max-batches") ? Number(value("--max-batches")) : undefined, dryRun: flag("--dry-run"), redo: flag("--redo"), spot: flag("--spot") });
  if (!flag("--dry-run")) writeFileSync(poPath, text);
  if (flag("--review")) {
    const dir = join(process.cwd(), "../data-scratch/i18n-review");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${locale}.md`), await reviewList({ locale, poPath, stackUrl }));
  }
  console.log(`Batches ${report.batches}, filled ${report.filled.length} (all flagged needs-review), failed ${report.failed.length}, refused ${report.refused.length}.`);
  if (report.stopped) { console.error(report.stopped); process.exit(1); }
}
