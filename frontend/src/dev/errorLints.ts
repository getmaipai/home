import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export type ErrorCategory = "toastError" | "destructiveClass" | "rawErrorMessage";
export type ErrorBaseline = Record<ErrorCategory, Record<string, number>>;
export type ErrorFinding = { file: string; category: ErrorCategory; count: number; patterns: string[] };

const BASELINE_PATH = join(import.meta.dir, "error-lint-baseline.json");
const CATEGORIES: ErrorCategory[] = ["toastError", "destructiveClass", "rawErrorMessage"];
// The admin error indicator intentionally exposes raw tool details to admins. Chat turn errors use shipped parts and crisis copy.
export const EXEMPT: Record<string, string> = {
  "shell/pages/TurnErrorDetails.tsx": "Admin-only raw tool error details indicator.",
  "shell/pages/ChatPage.tsx": "Chat turn failures and shipped error parts are governed by RULES.md.",
  "apps/chat/ChatThread.tsx": "Chat turn errors render through the shipped chat Elements.",
  "apps/chat/chatErrorSlot.tsx": "Chat turn errors render through the shipped chat Elements.",
};
const SHARED_COMPONENTS = new Set(["src/elements/", "src/ui/", "src/dashboard/components/ui/"]);

function sourceFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(root, path);
    return /\.(?:css|tsx?|jsx?)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) ? [path] : [];
  });
}

function matches(source: string, regex: RegExp): string[] {
  regex.lastIndex = 0;
  return [...source.matchAll(regex)].map((match) => match[0]);
}

const TOAST_ERROR = /\btoast\.error\s*\(/g;
const DESTRUCTIVE_CLASS = /className\s*=\s*(?:\{[^}]*\}|"[^"]*"|'[^']*')/gs;

function destructiveMatches(source: string): string[] {
  return [...source.matchAll(DESTRUCTIVE_CLASS)].filter((match) => /\btext-destructive\b/.test(match[0])).map((match) => match[0]);
}

function rawMessageMatches(source: string): string[] {
  const completeRegex = /error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*[^,;)}]+/g;
  const completeMatches = matches(source, completeRegex);
  const remaining = source.replace(completeRegex, "").replace(/\btoast\.[\w]+\s*\([^)]*\)/g, "");
  const simpleMatches = matches(remaining, /\b(?:error|\w*[Ee]rror)\.message/g);
  return completeMatches.filter(() => /\b(?:toast\.[\w]+|set\w*(?:Problem|Error|Message)|setFlow|push\s*\(|<[^>]+>)/.test(source))
    .concat(simpleMatches.filter((match) => {
      const index = remaining.indexOf(match);
      const before = remaining.slice(Math.max(0, index - 220), index);
      return /\b(?:toast\.[\w]+|set\w*(?:Problem|Error|Message)|setFlow|push\s*\()/.test(before) || /<[^>]+>\s*\{?\s*$/.test(before);
    }));
}

export function errorFindings(srcRoot: string, fixtures?: Record<string, string>): ErrorFinding[] {
  const sources = fixtures ?? Object.fromEntries(sourceFiles(srcRoot).map((path) => [relative(srcRoot, path), readFileSync(path, "utf8")]));
  const found: ErrorFinding[] = [];
  for (const [file, source] of Object.entries(sources)) {
    if (!fixtures && (/\.test\.[jt]sx?$/.test(file) || Object.hasOwn(EXEMPT, file) || SHARED_COMPONENTS.has(file.split("/").slice(0, 3).join("/") + "/"))) continue;
    const categories: Array<[ErrorCategory, string[]]> = [
      ["toastError", matches(source, TOAST_ERROR)],
      ["destructiveClass", destructiveMatches(source)],
      ["rawErrorMessage", rawMessageMatches(source)],
    ];
    for (const [category, patterns] of categories) if (patterns.length) found.push({ file, category, count: patterns.length, patterns });
  }
  return found;
}

export function errorBaselineProblems(findings: ErrorFinding[], baseline: Partial<ErrorBaseline>): string[] {
  const measured: ErrorBaseline = { toastError: {}, destructiveClass: {}, rawErrorMessage: {} };
  for (const finding of findings) measured[finding.category][finding.file] = finding.count;
  const problems: string[] = [];
  for (const category of CATEGORIES) {
    const prior = baseline[category] ?? {};
    for (const [file, count] of Object.entries(measured[category])) {
      if (prior[file] === undefined) problems.push(`${category} ${file}: new finding(s) (${count}); review and fix before adding a baseline`);
      else if (count > prior[file]) problems.push(`${category} ${file}: grew from ${prior[file]} to ${count}; fix the new raw error display`);
    }
    for (const [file, count] of Object.entries(prior)) {
      const actual = measured[category][file] ?? 0;
      if (actual < count) problems.push(`${category} ${file}: baseline is stale (${count}, measured ${actual}); lower the baseline number`);
    }
  }
  return problems;
}

if (process.argv.includes("--write-baseline")) {
  const root = join(import.meta.dir, "..");
  const baseline: ErrorBaseline = { toastError: {}, destructiveClass: {}, rawErrorMessage: {} };
  for (const finding of errorFindings(root)) baseline[finding.category][finding.file] = finding.count;
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
}
