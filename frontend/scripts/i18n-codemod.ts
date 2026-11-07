import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Rewrites JSX text, text props, toast.* and setError strings into `i18n._({ id, message })` (never <Trans>: it throws in bare test renders).
// Text mixed with simple `{expressions}` becomes ONE message with named placeholders, so word order can change per language.
const TEXT_PROPS = ["title", "label", "placeholder", "aria-label", "alt", "description", "hint", "tooltip", "caption", "subtitle", "heading", "message", "text"];
const LETTERS = /[A-Za-z]{2,}/;
const q = JSON.stringify;
const paths = process.argv.slice(2).filter((arg) => arg !== "--");
if (!paths.length) throw new Error("Usage: bun scripts/i18n-codemod.ts -- <file.tsx...>");

const decode = (raw: string) => raw.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&");
// React's JSX whitespace rule: lines are trimmed (except the outer edges), empty lines dropped, the rest joined with one space.
export function cleanJsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((line, i) => { if (/[^ \t]/.test(line)) lastNonEmpty = i; });
  let out = "";
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, " ");
    if (i !== 0) l = l.trimStart();
    if (i !== lines.length - 1) l = l.trimEnd();
    if (l) { if (i !== lastNonEmpty) l += " "; out += l; }
  });
  return decode(out);
}
const hasJsx = (node: ts.Node): boolean => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node) || !!ts.forEachChild(node, (c) => hasJsx(c) || undefined);

for (const raw of paths) {
  const path = resolve(raw);
  const input = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, input, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits: { start: number; end: number; text: string }[] = [];
  const call = (text: string, values = "") => `i18n._({ id: ${q(text)}, message: ${q(text)}${values} })`;
  const done = new Set<ts.Node>();

  const branchEdits = (expr: ts.Node): { start: number; end: number; text: string }[] => {
    const found: { start: number; end: number; text: string }[] = [];
    const walk = (n: ts.Node) => {
      if (ts.isConditionalExpression(n)) for (const branch of [n.whenTrue, n.whenFalse]) {
        let b: ts.Expression = branch;
        while (ts.isParenthesizedExpression(b)) b = b.expression;
        if (ts.isStringLiteral(b) && LETTERS.test(b.text)) found.push({ start: b.getStart(ast), end: b.end, text: call(b.text) });
      }
      if (!ts.isArrowFunction(n) && !ts.isFunctionExpression(n) && !ts.isJsxElement(n) && !ts.isJsxFragment(n) && !ts.isJsxSelfClosingElement(n)) ts.forEachChild(n, walk);
    };
    walk(expr);
    return found;
  };
  // Source text of an expression with string literals in conditional branches wrapped in i18n._.
  const render = (node: ts.Expression): string => {
    const base = node.getStart(ast);
    let text = input.slice(base, node.end);
    for (const e of branchEdits(node).sort((a, b) => b.start - a.start)) text = `${text.slice(0, e.start - base)}${e.text}${text.slice(e.end - base)}`;
    return text;
  };
  const nameOf = (e: ts.Expression): string => {
    let x: ts.Expression = e;
    while (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
    if (ts.isIdentifier(x)) return x.text;
    if (ts.isPropertyAccessExpression(x)) return x.name.text;
    if (ts.isCallExpression(x) || ts.isElementAccessExpression(x)) return nameOf(x.expression);
    return "value";
  };

  type Part = { kind: "text"; node: ts.JsxText } | { kind: "expr"; node: ts.JsxExpression };
  const isSpaceLiteral = (n: ts.JsxExpression) => !!n.expression && ts.isStringLiteral(n.expression) && n.expression.text.trim() === "";
  const mergeRuns = (children: readonly ts.JsxChild[]) => {
    const flush = (run: Part[]) => {
      const hasText = run.some((p) => p.kind === "text" && LETTERS.test(cleanJsxText(p.node.text)));
      const hasExpr = run.some((p) => p.kind === "expr" && !isSpaceLiteral(p.node));
      if (!hasText || !hasExpr) return;
      const names = new Map<string, string>(); // expression source -> placeholder
      const used = new Set<string>();
      const entries: string[] = [];
      let message = "";
      for (const part of run) {
        if (part.kind === "text") { message += cleanJsxText(part.node.text); continue; }
        const e = part.node.expression!;
        if (isSpaceLiteral(part.node)) { message += (e as ts.StringLiteral).text; continue; }
        const src = render(e);
        let name = names.get(src);
        if (!name) {
          const base = nameOf(e).replace(/\W/g, "") || "value";
          name = base; let n = 2;
          while (used.has(name)) name = `${base}${n++}`;
          used.add(name); names.set(src, name);
          entries.push(name === src ? name : `${name}: ${src}`);
        }
        message += `{${name}}`;
      }
      const lead = /^\s/.test(message);
      const trail = /\s$/.test(message) && message.trim() !== "";
      const text = `${lead ? '{" "}' : ""}{${call(message.trim(), `, values: { ${entries.join(", ")} }`)}}${trail ? '{" "}' : ""}`;
      edits.push({ start: run[0]!.node.pos, end: run[run.length - 1]!.node.end, text });
      for (const part of run) done.add(part.node);
    };
    let run: Part[] = [];
    for (const child of children) {
      if (ts.isJsxText(child)) run.push({ kind: "text", node: child });
      else if (ts.isJsxExpression(child) && child.expression && !hasJsx(child.expression) && !ts.isArrowFunction(child.expression)) run.push({ kind: "expr", node: child });
      else { flush(run); run = []; }
    }
    flush(run);
  };

  const visit = (node: ts.Node, covered = false) => {
    const nowCovered = covered || (ts.isCallExpression(node) && node.expression.getText(ast) === "i18n._");
    if (!nowCovered && (ts.isJsxElement(node) || ts.isJsxFragment(node))) mergeRuns(node.children);
    if (nowCovered || done.has(node)) { ts.forEachChild(node, (c) => visit(c, nowCovered)); return; }
    if (ts.isJsxText(node) && LETTERS.test(node.text.trim())) {
      // Replace only the trimmed range so whitespace next to an adjacent {expression} stays.
      const text = node.text;
      const lead = text.length - text.trimStart().length;
      const trail = text.length - text.trimEnd().length;
      edits.push({ start: node.pos + lead, end: node.end - trail, text: `{${call(cleanJsxText(text.trim()))}}` });
    } else if (ts.isJsxAttribute(node) && TEXT_PROPS.includes(node.name.getText(ast)) && node.initializer) {
      if (ts.isStringLiteral(node.initializer) && LETTERS.test(node.initializer.text)) edits.push({ start: node.initializer.getStart(ast), end: node.initializer.end, text: `{${call(node.initializer.text)}}` });
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) edits.push(...branchEdits(node.initializer.expression));
    } else if (ts.isJsxExpression(node) && node.expression && ts.isConditionalExpression(node.expression) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      edits.push(...branchEdits(node.expression));
    } else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && LETTERS.test(node.arguments[0].text) && ((ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(ast) === "toast") || (ts.isIdentifier(node.expression) && node.expression.text === "setError"))) {
      edits.push({ start: node.arguments[0].getStart(ast), end: node.arguments[0].end, text: call(node.arguments[0].text) });
    }
    ts.forEachChild(node, (child) => visit(child, nowCovered));
  };
  visit(ast);
  // Edits nested inside a merged-run edit are already rendered into it.
  const merged = edits.filter((e) => e.text.includes("values: {"));
  const kept = edits.filter((e) => e.text.includes("values: {") || !merged.some((m) => e.start >= m.start && e.end <= m.end));
  let output = input;
  for (const edit of kept.sort((a, b) => b.start - a.start)) output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  if (kept.length) {
    if (!/import\s*\{[^}]*\bi18n\b[^}]*\}\s*from\s*"@lingui\/core"/.test(output)) {
      // Insert before the first import so a "use client" directive and header comments keep their place.
      const firstImport = ast.statements.find(ts.isImportDeclaration);
      const at = firstImport ? firstImport.getStart(ast) : ast.statements[0]?.getStart(ast) ?? 0;
      output = `${output.slice(0, at)}import { i18n } from "@lingui/core";\n${output.slice(at)}`;
    }
    writeFileSync(path, output);
  }
  console.log(`${path}: ${kept.length} candidate(s)`);
}
