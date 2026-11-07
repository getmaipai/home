import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const paths = process.argv.slice(2).filter((arg) => arg !== "--");
if (!paths.length) throw new Error("Usage: bun scripts/i18n-codemod.ts -- <file.tsx...>");
for (const raw of paths) {
  const path = resolve(raw);
  const input = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, input, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: ts.Node, inTrans = false) => {
    const trans = (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === "Trans";
    if (!inTrans && ts.isJsxText(node) && /[A-Za-z]{2,}/.test(node.text.trim())) {
      const value = node.text.trim();
      edits.push({ start: node.getStart(ast), end: node.end, text: `<Trans id=${JSON.stringify(value)} message=${JSON.stringify(value)} />` });
    } else if (!inTrans && ts.isJsxAttribute(node) && ["title", "label", "placeholder", "aria-label", "alt", "description", "hint", "tooltip", "caption", "subtitle", "heading", "message", "text"].includes(node.name.getText(ast)) && node.initializer && ts.isStringLiteral(node.initializer) && /[A-Za-z]{2,}/.test(node.initializer.text)) {
      edits.push({ start: node.initializer.getStart(ast), end: node.initializer.end, text: `{t({ id: ${JSON.stringify(node.initializer.text)}, message: ${JSON.stringify(node.initializer.text)} })}` });
    }
    ts.forEachChild(node, (child) => visit(child, inTrans || trans));
  };
  visit(ast);
  let output = input;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  if (edits.length) {
    if (!/import\s*\{[^}]*\bTrans\b/.test(output)) output = `import { Trans } from "@lingui/react";\n${output}`;
    if (output.includes("{t({ id:")) output = `import { i18n } from "@lingui/core";\n${output.replaceAll("{t({ id:", "{i18n._({ id:")}`;
    writeFileSync(path, output);
  }
  console.log(`${path}: ${edits.length} candidate(s)`);
}
