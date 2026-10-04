// H2 (tools-ecosystem-design-2026-10-03.md section 4): reduce a tool's JSON
// Schema to the small subset llama-server's grammar converter accepts.
// Unknown keywords are dropped, local $refs are inlined, and nothing here
// throws: a schema it cannot read costs that tool its argument hints, not
// the turn (rule 6). Never a source of text for the model beyond the
// `description` strings the server itself wrote.

type Json = Record<string, unknown>;

const MAX_DEPTH = 24;
const TYPES = new Set(["string", "number", "integer", "boolean", "array", "object", "null"]);
const NUMBER_KEYS = ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"] as const;

const EMPTY_OBJECT = (): Json => ({ type: "object", properties: {} });

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Resolve a local `#/a/b` pointer inside the root schema; undefined when it is not local or not found. */
function resolveRef(root: Json, ref: unknown): Json | undefined {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let cur: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    if (!isObj(cur)) return undefined;
    cur = cur[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return isObj(cur) ? cur : undefined;
}

function clean(node: unknown, root: Json, refs: readonly string[], seen: WeakSet<object>, depth: number): Json {
  if (!isObj(node) || depth > MAX_DEPTH || seen.has(node)) return {};
  seen.add(node);
  try {
    if (typeof node.$ref === "string") {
      if (refs.includes(node.$ref)) return {};
      const target = resolveRef(root, node.$ref);
      return target ? clean(target, root, [...refs, node.$ref], seen, depth + 1) : {};
    }
    const out: Json = {};
    const t = node.type;
    if (typeof t === "string" && TYPES.has(t)) out.type = t;
    else if (Array.isArray(t)) {
      const alts = t.filter((x): x is string => typeof x === "string" && TYPES.has(x));
      if (alts.length === 1) out.type = alts[0];
      else if (alts.length > 1) out.anyOf = alts.map((type) => ({ type }));
    }
    for (const key of ["anyOf", "oneOf"] as const) {
      const list = node[key];
      if (Array.isArray(list) && list.length > 0) {
        out.anyOf = list.map((n) => clean(n, root, refs, seen, depth + 1));
        break;
      }
    }
    if (typeof node.description === "string") out.description = node.description;
    if (Array.isArray(node.enum) && node.enum.every((v) => ["string", "number", "boolean"].includes(typeof v))) out.enum = node.enum;
    if (["string", "number", "boolean"].includes(typeof node.const)) out.const = node.const;
    if (["string", "number", "boolean"].includes(typeof node.default)) out.default = node.default;
    if (typeof node.pattern === "string") out.pattern = node.pattern;
    for (const key of NUMBER_KEYS) {
      if (typeof node[key] === "number" && Number.isFinite(node[key])) out[key] = node[key];
    }
    if (isObj(node.properties)) {
      const props: Json = {};
      for (const [name, sub] of Object.entries(node.properties)) props[name] = clean(sub, root, refs, seen, depth + 1);
      out.properties = props;
      if (Array.isArray(node.required)) {
        const names = node.required.filter((n): n is string => typeof n === "string" && n in props);
        if (names.length > 0) out.required = names;
      }
    }
    if (node.items !== undefined && isObj(node.items)) out.items = clean(node.items, root, refs, seen, depth + 1);
    if (typeof node.additionalProperties === "boolean") out.additionalProperties = node.additionalProperties;
    return out;
  } finally {
    // A node reused in two places (not a cycle) must be cleaned in both.
    seen.delete(node);
  }
}

/** The tool's `inputSchema` reduced to what the grammar accepts; the top level is always an object schema. */
export function sanitiseSchema(schema: unknown): Json {
  try {
    if (!isObj(schema) || (schema.type !== undefined && schema.type !== "object")) return EMPTY_OBJECT();
    const out = clean(schema, schema, [], new WeakSet(), 0);
    out.type = "object";
    if (out.properties === undefined) out.properties = {};
    return out;
  } catch {
    return EMPTY_OBJECT();
  }
}
