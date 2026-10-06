// ELEMENTS-LINT-02 and ELEMENTS-LINT-03 (RULES.md rule 9, "Kit Elements
// as they ship"): two static scans over every non-test .tsx under
// frontend/src, each held to a committed baseline that may only shrink.
//
// LINT-02 finds a className (or class) on a kit Element, or on one of its
// parts, that changes the Element's shape, border, radius, shadow,
// background, padding, margin, size or layout. A kit Element is any binding
// imported from `@maipai/ui/src/elements/**`, `@maipai/ui/src/ui/**` or the
// vendored shadcn primitives under `@maipai/ui/src/dashboard/components/ui/**`.
//
// LINT-02's CSS leg finds a rule in Home's own stylesheets whose selector
// targets a kit part (a kit `data-slot` Home's markup does not set, or an
// `aui-*` class) and sets a shape, size, layout, spacing, border, shadow,
// background or display property. Home CSS may only define custom
// properties (tokens) the kit reads.
//
// LINT-03 finds a Home "wrapper": a component whose returned root is a kit
// Element; a component that draws its own DOM box (an overlay, a row, a
// frame) around an assistant-ui Element; or a component named like a
// wrapper (*Panel, *Card, *Wrapper, by its own name or its file's) in a file
// that imports a kit Element.
//
// The baselines and tests live beside this file in kitElementLints.test.ts.
import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

/** Import roots whose bindings count as kit Elements for both lints. */
export const KIT_ELEMENT_IMPORT = /^@maipai\/ui\/src\/(?:elements|ui|dashboard\/components\/ui)\//;

/** The assistant-ui Elements alone (the chat's parts), for the "hand-drawn
 * box around an Element" check, which would flag every page if it counted
 * plain kit primitives such as Card and Button. */
export const ASSISTANT_ELEMENT_IMPORT = /^@maipai\/ui\/src\/elements\//;

/** Every non-test .tsx under `src`, relative to it, sorted. */
export function frontendSourceFiles(src: string): string[] {
  return (readdirSync(src, { recursive: true }) as string[])
    .map((name) => name.replaceAll("\\", "/"))
    .filter((rel) => rel.endsWith(".tsx") && !rel.endsWith(".test.tsx"))
    .sort();
}

function parse(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** Local names bound to a kit Element import (named, default or namespace). */
export function kitBindings(file: ts.SourceFile, from: RegExp = KIT_ELEMENT_IMPORT): Set<string> {
  const names = new Set<string>();
  for (const stmt of file.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!from.test(stmt.moduleSpecifier.text)) continue;
    const clause = stmt.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) if (!el.isTypeOnly) names.add(el.name.text);
    }
  }
  return names;
}

/** The kit Element a JSX tag names (`CanvasSplit`, `Tooltip.Root`), if any. */
function kitTag(tag: ts.JsxTagNameExpression, kit: Set<string>): string | undefined {
  let root: ts.Node = tag;
  while (ts.isPropertyAccessExpression(root)) root = root.expression;
  if (!ts.isIdentifier(root) || !kit.has(root.text)) return undefined;
  return tag.getText();
}

// ---------------------------------------------------------------- LINT-02

/** Tailwind utilities that place an Element in its parent without changing
 * its own shape, border, surface, spacing or size. Checked before the
 * forbidden set, so `flex-1` passes while `flex` and `flex-col` do not. */
export const ALLOWED_PLACEMENT = [
  /^flex-(?:1|auto|initial|none)$/,
  /^(?:shrink|grow)(?:-\d+)?$/,
  /^(?:self|justify-self|place-self)-/,
  /^order-/,
  /^(?:col|row)-(?:span|start|end)-/,
];

/** The forbidden families, each with the words its failure message uses. */
export const FORBIDDEN_UTILITIES: { family: string; pattern: RegExp }[] = [
  { family: "radius", pattern: /^rounded(?:-|$)/ },
  { family: "border", pattern: /^(?:border|divide)(?:-|$)/ },
  { family: "shadow", pattern: /^shadow(?:-|$)/ },
  { family: "background", pattern: /^bg-/ },
  { family: "padding", pattern: /^p[xytrblse]?-/ },
  { family: "margin", pattern: /^-?m[xytrblse]?-/ },
  { family: "size", pattern: /^(?:w|h|size|min-w|min-h|max-w|max-h)-/ },
  { family: "layout", pattern: /^(?:flex|inline-flex|grid|inline-grid)$/ },
  { family: "layout", pattern: /^(?:flex|grid|gap|space|items|justify|content|place)-/ },
  { family: "position", pattern: /^(?:absolute|fixed|relative|sticky)$/ },
  { family: "position", pattern: /^-?(?:inset|top|left|right|bottom|start|end)-/ },
];

/** The utility with its variant prefixes (`md:`, `hover:`, `[&>p]:`) and
 * important marks removed. */
export function bareUtility(token: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!/, "").replace(/!$/, "");
}

/** The forbidden family a class token belongs to, or undefined when it is
 * allowed (a token, color, type or placement utility). */
export function forbiddenFamily(token: string): string | undefined {
  const bare = bareUtility(token);
  if (!bare || ALLOWED_PLACEMENT.some((re) => re.test(bare))) return undefined;
  return FORBIDDEN_UTILITIES.find(({ pattern }) => pattern.test(bare))?.family;
}

/** Calls whose string arguments are class lists (`cn("px-2", ...)`). Any
 * other call's arguments are data, not classes, and are not read. */
const CLASS_HELPERS = new Set(["cn", "clsx", "classNames", "twMerge", "twJoin"]);

const isClassExpression = (e: ts.Expression): boolean =>
  ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e) ||
  (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && CLASS_HELPERS.has(e.expression.text));

/** Same-file `const` declarations holding a class list (a string, a
 * template or a class-helper call), by name, so a className held in a
 * constant is read the same as one written inline. Other variables are
 * never followed, so an unrelated value is not read as classes. */
function stringConstants(file: ts.SourceFile): Map<string, ts.Expression> {
  const map = new Map<string, ts.Expression>();
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isClassExpression(n.initializer) &&
      ts.isVariableDeclarationList(n.parent) && n.parent.flags & ts.NodeFlags.Const) map.set(n.name.text, n.initializer);
    ts.forEachChild(n, visit);
  };
  visit(file);
  return map;
}

/** Same-file `const` object literals (or one indexed by a key, as in
 * `const look = {...}[verdict]`), by name, so `look.className` is read. */
function objectConstants(file: ts.SourceFile): Map<string, ts.Expression> {
  const map = new Map<string, ts.Expression>();
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isVariableDeclarationList(n.parent) && n.parent.flags & ts.NodeFlags.Const) {
      let init: ts.Expression = n.initializer;
      while (ts.isElementAccessExpression(init) || ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) map.set(n.name.text, init);
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return map;
}

const COMPARISONS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.InKeyword, ts.SyntaxKind.InstanceOfKeyword,
]);

/** Every class string a className expression can apply: literals,
 * template text, class-helper (`cn`) arguments, both arms of a
 * conditional, the value side of `&&` / `||`, and same-file class
 * constants (followed once). Comparison operands (`variant === "flex"`),
 * other calls' arguments and property names are never read as classes. */
function classStrings(expr: ts.Node, consts: Map<string, ts.Expression>, seen = new Set<string>(), objects = objectConstants(expr.getSourceFile())): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      out.push(n.text);
      return;
    }
    if (ts.isTemplateExpression(n)) {
      out.push(n.head.text);
      for (const span of n.templateSpans) {
        visit(span.expression);
        out.push(span.literal.text);
      }
      return;
    }
    if (ts.isBinaryExpression(n)) {
      if (COMPARISONS.has(n.operatorToken.kind)) return;
      // `cond && "x"` applies only the right side; `a || "x"` / `a ?? "x"` either.
      if (n.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) visit(n.left);
      visit(n.right);
      return;
    }
    if (ts.isConditionalExpression(n)) {
      visit(n.whenTrue);
      visit(n.whenFalse);
      return;
    }
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression) && CLASS_HELPERS.has(n.expression.text)) n.arguments.forEach(visit);
      return;
    }
    if (ts.isPropertyAccessExpression(n)) {
      // `look.className` where `const look = { a: { className: "..." } }[k]`:
      // read every same-named property in that constant's object literal.
      const base = n.expression;
      const init = ts.isIdentifier(base) ? objects.get(base.text) : undefined;
      if (init) {
        const prop = n.name.text;
        const find = (m: ts.Node): void => {
          if (ts.isPropertyAssignment(m) && m.name.getText().replace(/["']/g, "") === prop) visit(m.initializer);
          else ts.forEachChild(m, find);
        };
        find(init);
      }
      return;
    }
    if (ts.isElementAccessExpression(n)) return;
    if (ts.isIdentifier(n)) {
      if (consts.has(n.text) && !seen.has(n.text)) {
        seen.add(n.text);
        out.push(...classStrings(consts.get(n.text)!, consts, seen, objects));
      }
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(expr);
  return out;
}

export type OverrideFinding = { file: string; element: string; line: number; tokens: string[] };
/** file -> Element -> forbidden class tokens. */
export type OverrideBaseline = Record<string, Record<string, string[]>>;

function overridesIn(rel: string, source: string): OverrideFinding[] {
  const file = parse(rel, source);
  const kit = kitBindings(file);
  if (!kit.size) return [];
  const consts = stringConstants(file);
  const objects = objectConstants(file);
  const found: OverrideFinding[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const element = kitTag(n.tagName, kit);
      if (element) {
        for (const attr of n.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
          if (attr.name.text !== "className" && attr.name.text !== "class") continue;
          if (!attr.initializer) continue;
          const tokens = classStrings(attr.initializer, consts, new Set(), objects)
            .flatMap((s) => s.split(/\s+/))
            .filter((t) => t && forbiddenFamily(t));
          if (tokens.length) {
            const line = file.getLineAndCharacterOfPosition(n.getStart()).line + 1;
            found.push({ file: rel, element, line, tokens: [...new Set(tokens)] });
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return found;
}

/** Every className override on a kit Element, as findings with lines.
 * `overrides` maps a relative path to source text, for tests. */
export function classNameOverrideFindings(src: string, overrides?: Record<string, string>): OverrideFinding[] {
  const files = overrides ? Object.keys(overrides) : frontendSourceFiles(src);
  return files.flatMap((rel) => overridesIn(rel, overrides?.[rel] ?? readFileSync(join(src, rel), "utf8")));
}

/** The findings folded into the baseline's shape (no line numbers, so an
 * unrelated edit above an Element never moves the baseline). */
export function overrideBaselineOf(findings: OverrideFinding[]): OverrideBaseline {
  const out: OverrideBaseline = {};
  for (const f of findings) {
    const byElement = (out[f.file] ??= {});
    const tokens = new Set([...(byElement[f.element] ?? []), ...f.tokens]);
    byElement[f.element] = [...tokens].sort();
  }
  return out;
}

// ---------------------------------------------------------------- LINT-03

/** Component and file names that read as a wrapper around an Element. */
export const WRAPPER_NAME = /(?:Panel|Card|Wrapper)$/;

export type WrapperFinding = { file: string; component: string; line: number; why: string };
/** file -> component -> the reason it is allowed to stay (shrink-only). */
export type WrapperBaseline = Record<string, Record<string, string>>;

/** The JSX roots a component can return: an arrow's expression body, or
 * each `return` in its own body (not in nested functions), with parens,
 * `as`, both arms of `?:` and the right side of `&&` / `||` unwrapped. */
function returnedRoots(body: ts.Node): ts.Node[] {
  const roots: ts.Node[] = [];
  const unwrap = (e: ts.Node) => {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) unwrap(e.expression);
    else if (ts.isConditionalExpression(e)) {
      unwrap(e.whenTrue);
      unwrap(e.whenFalse);
    } else if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken || e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
      unwrap(e.right);
    } else roots.push(e);
  };
  if (!ts.isBlock(body)) {
    unwrap(body);
    return roots;
  }
  const walk = (n: ts.Node) => {
    if (ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression) unwrap(n.expression);
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(body, walk);
  return roots;
}

/** The function a component declaration holds: a function declaration, an
 * arrow or function expression, or one wrapped in `forwardRef(...)` /
 * `memo(...)`. */
function componentFunction(n: ts.Node): ts.SignatureDeclaration & { body?: ts.Node } | undefined {
  if (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return n;
  if (ts.isCallExpression(n)) {
    for (const arg of n.arguments) {
      const fn = componentFunction(arg);
      if (fn) return fn;
    }
  }
  return undefined;
}

/** A returned fragment's own top-level children, with `{cond && <x/>}`
 * and `{a ? <x/> : <y/>}` unwrapped, so a component that returns
 * `<>...{open && <div>...</div>}</>` is read by its real boxes. */
function fragmentChildren(root: ts.Node): ts.Node[] {
  const isFragment = ts.isJsxFragment(root) || (ts.isJsxElement(root) && /^(?:React\.)?Fragment$/.test(root.openingElement.tagName.getText()));
  if (!isFragment) return [root];
  const out: ts.Node[] = [];
  const add = (e: ts.Node) => {
    if (ts.isParenthesizedExpression(e)) add(e.expression);
    else if (ts.isConditionalExpression(e)) {
      add(e.whenTrue);
      add(e.whenFalse);
    } else if (ts.isBinaryExpression(e)) add(e.right);
    else out.push(...fragmentChildren(e));
  };
  for (const child of (root as ts.JsxFragment | ts.JsxElement).children) {
    if (ts.isJsxExpression(child) && child.expression) add(child.expression);
    else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) add(child);
  }
  return out;
}

/** When a component returns an intrinsic DOM tag (`<div>`, `<span>`) as
 * its root, or as a top-level child of a returned fragment, and that tag's
 * own tree renders an assistant-ui Element: the tag and the first such
 * Element. That is a hand-drawn box (overlay, row, frame) around it. */
function boxedElement(roots: ts.Node[], chat: Set<string>): { box: string; element: string } | undefined {
  if (!chat.size) return undefined;
  for (const root of roots.flatMap(fragmentChildren)) {
    const tag = ts.isJsxElement(root) ? root.openingElement.tagName : ts.isJsxSelfClosingElement(root) ? root.tagName : undefined;
    if (!tag || !ts.isIdentifier(tag) || !/^[a-z]/.test(tag.text)) continue;
    let element: string | undefined;
    const walk = (n: ts.Node) => {
      if (element) return;
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) element = kitTag(n.tagName, chat);
      if (!element) ts.forEachChild(n, walk);
    };
    walk(root);
    if (element) return { box: tag.text, element };
  }
  return undefined;
}

function isExported(n: ts.Node): boolean {
  const stmt = ts.isVariableDeclaration(n) ? n.parent.parent : n;
  return ts.canHaveModifiers(stmt) && (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function wrappersIn(rel: string, source: string): WrapperFinding[] {
  const file = parse(rel, source);
  const kit = kitBindings(file);
  if (!kit.size) return [];
  const chat = kitBindings(file, ASSISTANT_ELEMENT_IMPORT);
  const fileNamedLikeWrapper = WRAPPER_NAME.test(basename(rel, ".tsx"));
  const found: WrapperFinding[] = [];
  const visit = (n: ts.Node) => {
    let name: string | undefined;
    let fn: ReturnType<typeof componentFunction>;
    if (ts.isFunctionDeclaration(n) && n.name && /^[A-Z]/.test(n.name.text)) {
      name = n.name.text;
      fn = n;
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /^[A-Z][A-Za-z0-9]*[a-z]/.test(n.name.text) && n.initializer) {
      name = n.name.text;
      fn = componentFunction(n.initializer);
    }
    if (name && fn?.body) {
      const line = file.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      const roots = returnedRoots(fn.body);
      const rootTags = roots
        .filter((r): r is ts.JsxElement | ts.JsxSelfClosingElement => ts.isJsxElement(r) || ts.isJsxSelfClosingElement(r))
        .map((r) => kitTag(ts.isJsxElement(r) ? r.openingElement.tagName : r.tagName, kit))
        .filter((t): t is string => Boolean(t));
      const boxed = rootTags.length ? undefined : boxedElement(roots, chat);
      if (rootTags.length) found.push({ file: rel, component: name, line, why: `returns <${[...new Set(rootTags)].join(">, <")}> as its root` });
      else if (boxed) found.push({ file: rel, component: name, line, why: `draws its own <${boxed.box}> box around <${boxed.element}>` });
      else if (WRAPPER_NAME.test(name)) found.push({ file: rel, component: name, line, why: "named like a wrapper in a file that imports a kit Element" });
      else if (fileNamedLikeWrapper && isExported(n)) found.push({ file: rel, component: name, line, why: "exported from a file named like a wrapper that imports a kit Element" });
    }
    // Keep descending: a component defined inside another one is checked too.
    ts.forEachChild(n, visit);
  };
  visit(file);
  return found;
}

/** Every Home wrapper around a kit Element. `overrides` maps a relative
 * path to source text, for tests. */
export function wrapperFindings(src: string, overrides?: Record<string, string>): WrapperFinding[] {
  const files = overrides ? Object.keys(overrides) : frontendSourceFiles(src);
  return files.flatMap((rel) => wrappersIn(rel, overrides?.[rel] ?? readFileSync(join(src, rel), "utf8")));
}

// ------------------------------------------------------- LINT-02, CSS leg

/** Properties that change a part's shape, size, layout, spacing, border,
 * shadow, background or display. Custom properties (`--x`), colors, type,
 * opacity, cursor and `content` are not in it. */
export const FORBIDDEN_CSS_PROPERTY =
  /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|aspect-ratio|margin(?:-.+)?|padding(?:-.+)?|gap|row-gap|column-gap|border(?:-.+)?|box-shadow|background(?:-.+)?|display|position|inset(?:-.+)?|top|right|bottom|left|grid(?:-.+)?|flex(?:-.+)?|align-(?:items|content|self)|justify-(?:items|content|self)|place-(?:items|content|self)|order)$/;

/** `data-slot` values Home itself puts on the markup it draws (a JSX
 * `data-slot="..."` attribute in a non-test .tsx). A CSS selector on one
 * of these targets Home's own element; any other `data-slot` is a kit
 * part's. */
export function homeOwnedSlots(src: string): Set<string> {
  const slots = new Set<string>();
  for (const rel of frontendSourceFiles(src)) {
    const source = readFileSync(join(src, rel), "utf8");
    if (!source.includes("data-slot")) continue;
    const visit = (n: ts.Node) => {
      if (ts.isJsxAttribute(n) && n.name.getText() === "data-slot" && n.initializer && ts.isStringLiteral(n.initializer)) slots.add(n.initializer.text);
      ts.forEachChild(n, visit);
    };
    visit(parse(rel, source));
  }
  return slots;
}

/** The kit part a selector targets, if any: an `.aui-*` class, or a
 * `data-slot` value Home does not own. */
export function kitPartInSelector(selector: string, homeSlots: Set<string>): string | undefined {
  const aui = /\.(aui-[\w-]+)/.exec(selector);
  if (aui) return `.${aui[1]}`;
  for (const m of selector.matchAll(/\[data-slot\s*[~|^$*]?=\s*["']?([^"'\]]+)["']?\s*\]/g)) {
    if (m[1] && !homeSlots.has(m[1])) return `[data-slot="${m[1]}"]`;
  }
  return undefined;
}

export type CssRule = { selector: string; line: number; properties: string[] };

/** The style rules of a stylesheet, one per selector in a comma list, with
 * the properties each declares. `@media`, `@supports`, `@layer` and
 * `@container` blocks are entered; other at-rules (`@keyframes`,
 * `@font-face`, `@theme`) are skipped. */
export function cssRules(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const rules: CssRule[] = [];
  const lineAt = (offset: number) => text.slice(0, offset).split("\n").length;
  const walk = (start: number, end: number) => {
    let i = start;
    let preludeStart = start;
    while (i < end) {
      const ch = text[i];
      if (ch === ";") preludeStart = i + 1;
      if (ch === "}") preludeStart = i + 1;
      if (ch !== "{") {
        i++;
        continue;
      }
      let depth = 1;
      let j = i + 1;
      while (j < end && depth) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      const prelude = text.slice(preludeStart, i).trim();
      const body = text.slice(i + 1, j - 1);
      if (prelude.startsWith("@")) {
        if (/^@(?:media|supports|layer|container)\b/.test(prelude)) walk(i + 1, j - 1);
      } else if (prelude) {
        const properties = body
          .split(";")
          .map((d) => d.split(":")[0]?.trim().toLowerCase() ?? "")
          .filter((p) => p && !p.includes("{") && !p.includes("}"));
        const line = lineAt(preludeStart + (text.slice(preludeStart, i).length - text.slice(preludeStart, i).trimStart().length));
        for (const selector of prelude.split(",")) rules.push({ selector: selector.replace(/\s+/g, " ").trim(), line, properties });
      }
      i = j;
      preludeStart = j;
    }
  };
  walk(0, text.length);
  return rules;
}

/** Every non-test .css under `src`, relative to it, sorted. */
export function frontendCssFiles(src: string): string[] {
  return (readdirSync(src, { recursive: true }) as string[])
    .map((name) => name.replaceAll("\\", "/"))
    .filter((rel) => rel.endsWith(".css"))
    .sort();
}

export type CssOverrideFinding = { file: string; selector: string; part: string; line: number; properties: string[] };
/** file -> selector -> forbidden properties. */
export type CssOverrideBaseline = Record<string, Record<string, string[]>>;

/** Every Home CSS rule that sets a forbidden property on a kit part.
 * `overrides` maps a relative path to stylesheet text, for tests;
 * `homeSlots` defaults to the slots Home's own markup sets. */
export function cssOverrideFindings(src: string, overrides?: Record<string, string>, homeSlots: Set<string> = homeOwnedSlots(src)): CssOverrideFinding[] {
  const files = overrides ? Object.keys(overrides) : frontendCssFiles(src);
  return files.flatMap((rel) =>
    cssRules(overrides?.[rel] ?? readFileSync(join(src, rel), "utf8")).flatMap((rule) => {
      const part = kitPartInSelector(rule.selector, homeSlots);
      const properties = [...new Set(rule.properties.filter((p) => !p.startsWith("--") && FORBIDDEN_CSS_PROPERTY.test(p)))];
      return part && properties.length ? [{ file: rel, selector: rule.selector, part, line: rule.line, properties }] : [];
    }));
}

/** The findings folded into the baseline's shape (no line numbers). */
export function cssOverrideBaselineOf(findings: CssOverrideFinding[]): CssOverrideBaseline {
  const out: CssOverrideBaseline = {};
  for (const f of findings) {
    const bySelector = (out[f.file] ??= {});
    bySelector[f.selector] = [...new Set([...(bySelector[f.selector] ?? []), ...f.properties])].sort();
  }
  return out;
}
