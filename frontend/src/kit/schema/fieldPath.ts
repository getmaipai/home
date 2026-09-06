/** Reads a dotted path ("scope" or "person.display_name") out of an
 * arbitrary bound record. Every *_field property in the schema (
 * item_label_field, item_subtitle_field, row_action's `{field}`
 * placeholders...) is one of these paths, resolved the same way
 * everywhere rather than each node kind growing its own lookup. */
export function readField(item: unknown, path: string): unknown {
  let value: unknown = item;
  for (const key of path.split(".")) {
    if (value === null || value === undefined || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Substitutes every `{field}` placeholder in `template` with
 * `readField(item, field)`, stringified. Used by action.call's target/
 * args and action.confirm's prompt (spec/ui/schema.json's own
 * description on each) - the interpreter's one templating mechanism,
 * not a different one per action kind. */
export function fillTemplate(template: string, item: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (whole, path: string) => {
    const value = readField(item, path);
    return value === undefined || value === null ? whole : String(value);
  });
}

/** Same substitution, applied to every string value in a plain object
 * (action.call's `args`) - object structure and non-string values pass
 * through untouched. */
export function fillTemplateDeep<T>(value: T, item: Record<string, unknown>): T {
  if (typeof value === "string") return fillTemplate(value, item) as T;
  if (Array.isArray(value)) return value.map((v) => fillTemplateDeep(v, item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplateDeep(v, item)])) as T;
  }
  return value;
}
