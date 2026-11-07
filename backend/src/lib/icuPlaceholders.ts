// The argument names of an ICU message, shared by the server renderer (lib/i18nServer.ts) and the catalog check (frontend/scripts/i18n-check.ts).
// The branches of a select or plural (`no {Alarm}`, `one {# vez}`) are text, not arguments. No imports, so a script can load it.
interface Argument { name: string; kind: "plain" | "select" | "plural" }

function argumentsOf(template: string): Argument[] {
  const found: Argument[] = [];
  const stack: Array<"branches" | "other"> = [];
  for (let i = 0; i < template.length; i += 1) {
    const char = template[i];
    if (char === "}") { stack.pop(); continue; }
    if (char !== "{") continue;
    if (stack[stack.length - 1] === "branches") { stack.push("other"); continue; }
    const head = /^\{\s*(\w+)\s*(?:,\s*(select|plural|selectordinal)\s*,|[,}])/.exec(template.slice(i));
    if (head) found.push({ name: head[1]!, kind: head[2] === "select" ? "select" : head[2] ? "plural" : "plain" });
    stack.push(head?.[2] ? "branches" : "other");
  }
  return found;
}

/** Every argument in order of appearance, repeats included (the catalog check compares them one for one). */
export function placeholderOccurrences(template: string): string[] {
  return argumentsOf(template).map((argument) => argument.name);
}

/** Every argument name a template uses (select and plural arguments included), sorted, for the consistency tests. */
export function placeholdersOf(template: string): string[] {
  return [...new Set(argumentsOf(template).map((argument) => argument.name))].sort();
}

/** The values a template cannot render without: a `select` argument is optional (a missing one takes the `other` branch). */
export function requiredPlaceholdersOf(template: string): string[] {
  const arguments_ = argumentsOf(template);
  return placeholdersOf(template).filter((name) => arguments_.some((argument) => argument.name === name && argument.kind !== "select"));
}
