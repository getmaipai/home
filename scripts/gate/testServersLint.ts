import ts from "../../backend/node_modules/typescript/lib/typescript.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../backend/tests");
const files: string[] = [];
function collect(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
}
collect(root);

const errors: string[] = [];
for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const visit = (node: any): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(source) === "Bun" && node.expression.name.text === "serve") {
      const options = node.arguments[0];
      if (options && ts.isObjectLiteralExpression(options)) {
        const hasHostname = options.properties.some((property: any) =>
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
          property.name?.getText(source).replaceAll(/["']/g, "") === "hostname");
        if (!hasHostname) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          errors.push(`${file}:${line + 1}: Bun.serve test server needs hostname: "127.0.0.1"`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`test server hostname lint: ${files.length} backend test files checked`);
