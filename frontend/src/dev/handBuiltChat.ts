// ELEMENTS-LINT-01: finds chat components that draw their own markup (a
// PascalCase component whose body renders an intrinsic DOM tag such as
// <div> or <span>), so the list of hand-built chat components can only
// shrink (RULES.md rule 9). A component that only composes kit Elements and
// primitives is not flagged. handBuiltChat.test.ts holds the baseline check.
import ts from "typescript";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type HandBuiltBaseline = Record<string, string[]>;

function tsxUnder(src: string, dir: string): string[] {
  return (readdirSync(join(src, dir), { recursive: true }) as string[])
    .map((name) => `${dir}/${name.replaceAll("\\", "/")}`)
    .filter((rel) => rel.endsWith(".tsx") && !rel.endsWith(".test.tsx"));
}

const CHAT_IMPORT = /from\s*["'](?:@assistant-ui\/|@maipai\/ui\/src\/elements\/(?:thread-list(?:\.aui)?|thread-search|markdown-text|model-selector|canvas-split|hooks\/use-copy-to-clipboard)(?:["'/]|$))/;

/** The chat screen's own source, relative to `frontend/src`: everything
 * under `apps/chat/`, plus every `shell/pages/` file that draws with assistant-ui
 * or the kit's Elements (the chat page, its error details, the markdown
 * document view, the shortcut sheet). Tests are excluded. */
export function chatSourceFiles(src: string): string[] {
  const shellPages = existsSync(join(src, "shell/pages")) ? tsxUnder(src, "shell/pages").filter((rel) => CHAT_IMPORT.test(readFileSync(join(src, rel), "utf8"))) : [];
  return [...tsxUnder(src, "apps/chat"), ...shellPages].sort();
}

function firstIntrinsicTag(node: ts.Node): string | undefined {
  let found: string | undefined;
  const walk = (n: ts.Node) => {
    if (found) return;
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ts.isIdentifier(n.tagName) && /^[a-z]/.test(n.tagName.text)) {
      found = n.tagName.text;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

function componentsDrawingMarkup(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names: string[] = [];
  const visit = (n: ts.Node) => {
    let name: string | undefined;
    let body: ts.Node | undefined;
    if (ts.isFunctionDeclaration(n) && n.name && /^[A-Z]/.test(n.name.text)) {
      name = n.name.text;
      body = n;
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /^[A-Z][A-Za-z0-9]*[a-z]/.test(n.name.text) && n.initializer) {
      name = n.name.text;
      body = n.initializer;
    }
    if (name && body) {
      if (firstIntrinsicTag(body)) names.push(name);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return names;
}

/** Every hand-built chat component, by file. `overrides` maps a relative
 * path to source text, for tests. */
export function handBuiltChatComponents(src: string, overrides?: Record<string, string>): HandBuiltBaseline {
  const files = overrides ? Object.keys(overrides) : chatSourceFiles(src);
  const result: HandBuiltBaseline = {};
  for (const rel of files) {
    const names = componentsDrawingMarkup(rel, overrides?.[rel] ?? readFileSync(join(src, rel), "utf8"));
    if (names.length) result[rel] = names;
  }
  return result;
}

/** The Elements the adoption plan says replace hand-built code in `rel`
 * (its `replacesHandBuilt` pointers), named in the lint's failure message. */
export function elementsReplacing(src: string, rel: string): string[] {
  const plan = JSON.parse(readFileSync(join(src, "dev/elements-plan.json"), "utf8")) as { items: { name: string; replacesHandBuilt?: string[] }[] };
  const path = `frontend/src/${rel}`;
  return [...new Set(plan.items.filter((item) => item.replacesHandBuilt?.some((pointer) => pointer.split(":")[0] === path)).map((item) => item.name))];
}

/** Wire-now Elements not yet imported, named in the lint's failure message. */
export function wireNowElements(src: string): string[] {
  const adoption = JSON.parse(readFileSync(join(src, "dev/elements-adoption.json"), "utf8")) as { items: { name: string; verdict: string; implemented: boolean }[] };
  return adoption.items.filter((item) => item.verdict === "wire-now" && !item.implemented).map((item) => item.name);
}
