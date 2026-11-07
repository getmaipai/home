import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export type Finding = { file: string; line: number; text: string };
export type Baseline = Record<string, number>;
type Allow = { file: string; text: string; reason: string };

function sourceFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ["dev", "tests", "locales"].includes(entry.name) || entry.name === "node_modules" ? [] : sourceFiles(root, path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

const TEXT_PROPS = new Set(["title", "label", "placeholder", "aria-label", "alt", "description", "hint", "tooltip", "caption", "subtitle", "heading", "message", "text"]);
const WORDS = /[A-Za-z]{2,}/;
function looksUserFacing(value: string): boolean { return WORDS.test(value.trim()); }

export function i18nFindings(srcRoot: string, overrides?: Record<string, string>, allowlist: Allow[] = []): Finding[] {
  const sources = overrides ?? Object.fromEntries(sourceFiles(srcRoot).map((file) => [relative(srcRoot, file), readFileSync(file, "utf8")]));
  const findings: Finding[] = [];
  for (const [file, text] of Object.entries(sources)) {
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const allowed = (value: string) => allowlist.some((entry) => entry.file === file && entry.text === value && entry.reason.trim());
    const visit = (node: ts.Node, insideTrans = false) => {
      const isTrans = (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === "Trans";
      const covered = insideTrans || isTrans;
      if (!covered && ts.isJsxText(node) && looksUserFacing(node.text) && !allowed(node.text.trim())) findings.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, text: node.text.trim() });
      if (!covered && ts.isJsxAttribute(node) && TEXT_PROPS.has(node.name.getText(ast)) && node.initializer && ts.isStringLiteral(node.initializer) && looksUserFacing(node.initializer.text) && !allowed(node.initializer.text)) findings.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, text: node.initializer.text });
      if (!covered && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(ast) === "toast" && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && looksUserFacing(node.arguments[0].text) && !allowed(node.arguments[0].text)) findings.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, text: node.arguments[0].text });
      if (!covered && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "setError" && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && looksUserFacing(node.arguments[0].text) && !allowed(node.arguments[0].text)) findings.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, text: node.arguments[0].text });
      ts.forEachChild(node, (child) => visit(child, covered));
    };
    visit(ast);
  }
  return findings;
}

export function baselineProblems(findings: Finding[], baseline: Baseline): string[] {
  const counts: Record<string, number> = {};
  for (const finding of findings) counts[finding.file] = (counts[finding.file] ?? 0) + 1;
  const problems = Object.entries(counts).flatMap(([file, count]) => baseline[file] === undefined ? [`${file} has ${count} hardcoded strings and is not in the baseline`] : count > baseline[file]! ? [`${file} grew from ${baseline[file]} to ${count}`] : []);
  for (const [file, count] of Object.entries(baseline)) if ((counts[file] ?? 0) < count) problems.push(`${file} shrank from ${count} to ${counts[file] ?? 0}; shrink its baseline`);
  return problems;
}
