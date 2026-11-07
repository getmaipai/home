// I18N-F0 (design note section 7): fill untranslated catalog entries through the household's own Stack chat role, flag every
// fill `needs-review`, and never touch protected copy. Run: bun scripts/translate-catalog.ts --locale es [--file <text>]
// [--max-batches N] [--dry-run] [--redo] [--review] [--accept <file|id>]. The only host it talks to is the Stack.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePo, rewriteEntries, type PoEntry } from "./po";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type Glossary = { dialect?: string; style?: string[]; [term: string]: unknown };
export type Report = { filled: string[]; failed: string[]; refused: string[]; batches: number; stopped?: string };

export const MAX_BATCH_ENTRIES = 150;
// Child, teen, crisis, consent, refusal, spoken clip, robot and SEARCH-DOWN-EMPTY-01 copy: a reviewer must write it, never the model.
const PROTECTED = /child|teen|crisis|consent|refusal|spoken|robot|SEARCH-DOWN-EMPTY-01/i;

export const isProtected = (refs: string[], id: string): boolean => PROTECTED.test(`${refs.join(" ")} ${id}`);
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

const tokens = (value: string): string[] => [...(value.match(/\{\s*\w+(?=\s*[,}])|<\/?\d+\/?>/g) ?? [])].map((token) => token.replace(/\s+/g, "")).sort();

/** Null when the translation is acceptable, else the reason it is not. */
export function validateTranslation(source: string, msgstr: string): string | null {
  if (!msgstr.trim()) return "empty";
  if (msgstr.includes("—")) return "em dash";
  if (msgstr.includes("!") && !source.includes("!")) return "exclamation point";
  if (JSON.stringify(tokens(source)) !== JSON.stringify(tokens(msgstr))) return "placeholders differ";
  if (msgstr.length > source.length * 3 + 20) return "too long";
  return null;
}

export function buildPrompt(locale: string, glossary: Glossary, batch: { file: string; entries: PoEntry[] }): string {
  const { dialect, style, ...terms } = glossary;
  return [
    `Translate product copy into ${locale === "es" ? "Spanish" : "British English (spelling and vocabulary only, never rewrite meaning; leave out entries that need no change)"}.`,
    dialect ? `Dialect: ${dialect}` : "",
    `Style rules:\n${(style ?? []).map((rule) => `- ${rule}`).join("\n")}`,
    `Glossary (term to ${locale}): ${JSON.stringify(terms)}`,
    `Source file: ${batch.file}`,
    `Reply with only a JSON array of {"id": string, "msgstr": string}, one per entry, ids unchanged.`,
    `Entries: ${JSON.stringify(batch.entries.map((entry) => ({ id: entry.id, from: entry.refs.slice(0, 2) })))}`,
  ].filter(Boolean).join("\n\n");
}

const parseReply = (content: string): Array<{ id: string; msgstr: string }> => {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("reply is not a list");
  return parsed.filter((item): item is { id: string; msgstr: string } => typeof item?.id === "string" && typeof item?.msgstr === "string");
};

/** A fetch that refuses every host but the Stack's (nothing leaves the home, PRIVACY.md). */
export function stackOnlyFetch(stackUrl: string, inner: Fetch = fetch): Fetch {
  const host = new URL(stackUrl).host;
  return (url, init) => {
    if (new URL(url).host !== host) throw new Error(`Refusing a request to ${new URL(url).host}: only the Stack is allowed.`);
    return inner(url, init);
  };
}

async function chatReady(stack: string, doFetch: Fetch): Promise<boolean> {
  try {
    const res = await doFetch(`${stack}/stack/v1/roles`);
    if (!res.ok) return false;
    const body = (await res.json()) as { roles?: Array<{ id: string; state?: { state?: string } }> };
    return body.roles?.find((role) => role.id === "chat")?.state?.state === "ready";
  } catch {
    return false;
  }
}

async function ask(stack: string, doFetch: Fetch, prompt: string): Promise<string> {
  const res = await doFetch(`${stack}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "chat", stream: false, messages: [{ role: "user", content: prompt }] }) });
  if (!res.ok) throw new Error(`Stack chat answered ${res.status}`);
  return ((await res.json()) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "";
}

export type TranslateOptions = {
  locale: string; poPath: string; glossary: Glossary; stackUrl: string; fetch?: Fetch;
  file?: string; maxBatches?: number; dryRun?: boolean; redo?: boolean;
};

/** Returns the new .po text (unchanged on a dry run) and a report. Writing the file is the caller's job. */
export async function translateCatalog(options: TranslateOptions): Promise<{ text: string; report: Report }> {
  const doFetch = stackOnlyFetch(options.stackUrl, options.fetch);
  const stack = options.stackUrl.replace(/\/$/, "");
  const original = readFileSync(options.poPath, "utf8");
  const report: Report = { filled: [], failed: [], refused: [], batches: 0 };
  const all = candidates(parsePo(original), options.redo).filter((entry) => !options.file || sourceFile(entry).includes(options.file));
  for (const entry of all) if (isProtected(entry.refs, entry.id)) report.refused.push(entry.id);
  const batches = planBatches(all.filter((entry) => !isProtected(entry.refs, entry.id)));
  if (options.dryRun) { report.batches = batches.length; return { text: original, report }; }
  const changes = new Map<string, { msgstr: string; flag: true }>();
  for (const batch of batches.slice(0, options.maxBatches ?? batches.length)) {
    if (!(await chatReady(stack, doFetch))) { report.stopped = "Stack chat is not ready; nothing more was translated. Try again when chat is ready."; break; }
    report.batches += 1;
    const accept = (batchEntries: PoEntry[], reply: Array<{ id: string; msgstr: string }>) => {
      const answered = new Set<string>();
      for (const item of reply) {
        const entry = batchEntries.find((candidate) => candidate.id === item.id);
        if (!entry || answered.has(item.id)) continue;
        answered.add(item.id);
        if (validateTranslation(entry.id, item.msgstr) === null) changes.set(entry.id, { msgstr: item.msgstr, flag: true });
      }
    };
    try { accept(batch.entries, parseReply(await ask(stack, doFetch, buildPrompt(options.locale, options.glossary, batch)))); } catch { /* retried one at a time below */ }
    // en-GB answers only the entries that differ, so a silent entry there is not a failure.
    if (options.locale === "en-GB") continue;
    for (const entry of batch.entries.filter((candidate) => !changes.has(candidate.id))) {
      try { accept([entry], parseReply(await ask(stack, doFetch, buildPrompt(options.locale, options.glossary, { file: batch.file, entries: [entry] })))); } catch { /* left empty */ }
      if (!changes.has(entry.id)) report.failed.push(entry.id);
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
      const reply = parseReply(await ask(stack, doFetch, `Translate each msgstr back to plain English, literally. Reply with only a JSON array of {"id","msgstr"}.\n${JSON.stringify(flagged.map((entry) => ({ id: entry.id, msgstr: entry.msgstr })))}`));
      back = Object.fromEntries(reply.map((item) => [item.id, item.msgstr]));
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
  const { text, report } = await translateCatalog({ locale, poPath, glossary, stackUrl, file: value("--file"), maxBatches: value("--max-batches") ? Number(value("--max-batches")) : undefined, dryRun: flag("--dry-run"), redo: flag("--redo") });
  if (!flag("--dry-run")) writeFileSync(poPath, text);
  if (flag("--review")) {
    const dir = join(process.cwd(), "../data-scratch/i18n-review");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${locale}.md`), await reviewList({ locale, poPath, stackUrl }));
  }
  console.log(`Batches ${report.batches}, filled ${report.filled.length} (all flagged needs-review), failed ${report.failed.length}, refused ${report.refused.length}.`);
  if (report.stopped) { console.error(report.stopped); process.exit(1); }
}
