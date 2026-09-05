// Interprets a Tier 0 Recipe (spec/schemas/recipe.schema.json) natively,
// executing each step against a host (platform plan 5.2). No process, no
// eval: every step is one of the seven declared primitives. This must stay
// behaviorally identical to spec/interpreters/py/recipe_interpreter.py; the
// conformance fixtures in spec/fixtures/recipes/ prove that.
import { decode } from "he";
import type { Recipe } from "../../gen/ts/recipe.js";
import type { Host } from "../../emulators/ts/host-emulator.js";

export interface SkillResult {
  reply?: { text: string; speech?: string };
  actions: { kind: string; payload?: unknown }[];
}

type Scope = Record<string, unknown>;

// json-schema-to-zod emits recipe.schema.json's oneOf-based `step` as
// `z.any().superRefine(...)`: the schema is validated at runtime, but
// z.infer gives Recipe["steps"][number] the static type `any`, not a
// discriminated union. That silently defeated this file's exhaustiveness
// check and, worse, meant every `step.xxx` access below was typed `any`
// throughout the switch (a typo'd property would have compiled). Found
// when backend/ first imported this file and its `tsc --noEmit` actually
// walked it (spec/ itself has never run a standalone typecheck). Hand-
// written here, mirroring recipe.schema.json's 7 step defs exactly, so
// the switch gets real per-branch types and a real `never` check back.
type RecipeStep =
  | { op: "fetch"; as: string; url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: unknown }
  | { op: "pick"; as: string; from: string; path?: string }
  | { op: "format"; as: string; text: string; speech?: string }
  | { op: "home.call_service"; domain: string; service: string; target: Record<string, unknown>; data?: Record<string, unknown> }
  | { op: "action"; kind: string; payload?: Record<string, unknown> }
  | { op: "remember"; text: string; category?: string; scope?: string }
  | { op: "recall"; as: string; query: string; scope?: string; limit?: number }
  | { op: "schedule"; when: string; job?: string };

// No conditional step exists in this declarative language to branch a
// reply on "did recall find anything" - a `format` step only ever
// interpolates a scalar. So the recall step itself resolves that here,
// binding one ready-to-speak string either way, the same "resolve it at
// the interpreter, not by asking the recipe author for a branch that
// doesn't exist" call `remember`'s own fixed confirmation text already
// makes.
const NOTHING_RECALLED = "I don't remember anything about that.";

// Decodes HTML entities in the SUBSTITUTED VALUE, never the template
// itself (the template is always our own authored manifest/recipe text,
// which never contains entities; the value can come from `fetch`, an
// arbitrary external API). Found building the `trivia` skill (2026-09-05):
// opentdb.com HTML-entity-encodes every response unconditionally
// ("Jojo&#039;s stand"), and nothing in this interpreter decoded it -
// every future text-returning API that does the same (a real, common
// practice for APIs meant to be embedded directly in a web page) would
// have shown raw entities in a chat reply or spoken them literally aloud.
// `he` (a maintained, complete HTML entity library, not a hand-rolled
// regex) per the org's "prebuilt over hand-built" rule - decoding plain
// text with no entities is a no-op, so this is safe for every existing
// interpolation (`define`, `weather`, `joke`, `remember`'s own text).
function interpolate(template: string, scope: Scope): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, name: string) => {
    const value = scope[name];
    return value === undefined ? match : decode(String(value));
  });
}

function pickPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    const key = /^[0-9]+$/.test(segment) ? Number(segment) : segment;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

// async (2026-09-05): the steps that need real network I/O (`fetch`, and
// as of the same day `home.call_service`) can no longer stay synchronous
// once they're backed by a real HTTP call instead of a canned emulator
// response - see backend/src/lib/packageHost.ts's own header comment on
// why this used to be out of scope. Every other step stays exactly as
// synchronous as it always was.
export async function runRecipe(recipe: Recipe, inputs: Scope, host: Host): Promise<SkillResult> {
  const scope: Scope = { ...inputs };
  const actions: { kind: string; payload?: unknown }[] = [];
  let reply: { text: string; speech?: string } | undefined;

  for (const step of recipe.steps as RecipeStep[]) {
    switch (step.op) {
      case "fetch": {
        const url = interpolate(step.url, scope);
        scope[step.as] = await host.fetch(url, { method: step.method, headers: step.headers, body: step.body });
        break;
      }
      case "pick": {
        scope[step.as] = pickPath(scope[step.from], step.path);
        break;
      }
      case "format": {
        const text = interpolate(step.text, scope);
        const speech = step.speech ? interpolate(step.speech, scope) : text;
        scope[step.as] = { text, speech };
        reply = { text, speech };
        break;
      }
      case "home.call_service": {
        await host.home.call_service(step.domain, step.service, step.target, step.data ?? null);
        break;
      }
      case "action": {
        host.action.emit(step.kind, step.payload ?? null);
        actions.push({ kind: step.kind, payload: step.payload ?? null });
        break;
      }
      case "remember": {
        const text = interpolate(step.text, scope);
        host.memory.remember(text, step.category, step.scope);
        break;
      }
      case "recall": {
        const query = interpolate(step.query, scope);
        const matches = host.memory.recall(query, { scope: step.scope });
        const top = matches.slice(0, step.limit ?? 3);
        scope[step.as] = top.length > 0 ? top.map((m) => m.text).join("; ") : NOTHING_RECALLED;
        break;
      }
      case "schedule": {
        const when = interpolate(step.when, scope);
        host.schedule(when, step.job ?? recipe.id);
        break;
      }
      default: {
        const exhaustive: never = step;
        throw new Error(`unhandled recipe step: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return { reply, actions };
}
