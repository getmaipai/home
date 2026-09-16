// Interprets a Tier 0 Recipe (spec/schemas/recipe.schema.json) natively,
// executing each step against a host (platform plan 5.2). No process, no
// eval: every step is one of the seventeen declared primitives. This must
// stay behaviorally identical to spec/interpreters/py/recipe_interpreter.py;
// the conformance fixtures in spec/fixtures/recipes/ prove that.
import { decode } from "he";
import type { Recipe } from "../../gen/ts/recipe.js";
import type { Host } from "../../emulators/ts/host-emulator.js";
import { evaluateExpression } from "./compute.js";

export interface PluginResult {
  reply?: { text: string; speech?: string };
  /** Named fields beside the reply (a `format` step's `data`): what a
   * composer phrases from, typed as the recipe bound them. */
  data?: Record<string, unknown>;
  /** CHAT-16: a `format` step's literal hint that `data` answers the
   * question and needs phrasing; the composer always composes a result
   * carrying it, and a step that gives it may omit its `text`. */
  synthesis_hint?: string;
  actions: { kind: string; payload?: unknown }[];
  ask?: { prompt: string; expects?: string };
  /** Fix B (docs/dev.md's "Chat reliability: the 2026-09-07 incident"
   * note): a handler's own typed report that it could not answer, never
   * alongside `reply` - see result.schema.json's own `error` field for
   * the full reasoning. Not produced by this file's own runRecipe() (a
   * Tier 0 recipe step failure already throws a real HostError, mapped
   * at the route layer), only by a Tier 1 package's handle() -
   * denoHost.ts's parseHandleResult() is the real producer. */
  error?: { code: string; message: string };
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
// written here, mirroring recipe.schema.json's 17 step defs exactly, so
// the switch gets real per-branch types and a real `never` check back.
type RecipeStep =
  | { op: "fetch"; as: string; url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: unknown }
  | { op: "pick"; as: string; from: string; path?: string }
  | { op: "lookup"; as: string; from: string; table: Record<string, string>; default?: string }
  | { op: "format"; as: string; text?: string; speech?: string; data?: Record<string, string>; synthesis_hint?: string }
  | { op: "home.call_service"; domain: string; service: string; target: Record<string, unknown>; data?: Record<string, unknown> }
  | { op: "action"; kind: string; payload?: Record<string, unknown> }
  | { op: "remember"; text: string; category?: string; scope?: string }
  | { op: "recall"; as: string; query: string; scope?: string; limit?: number }
  | { op: "schedule"; when: string; job?: string; inputs?: Record<string, unknown> }
  | { op: "integration.call"; as: string; id: string; method: string; args?: Record<string, unknown> }
  | { op: "compute"; as: string; expression: string }
  | { op: "llm_complete"; as: string; prompt: string }
  | { op: "list_add"; text: string }
  | { op: "list_view"; as: string }
  | { op: "remind"; as: string; text: string }
  | { op: "timer"; as: string; text: string }
  | { op: "ask"; prompt: string; expects?: string };

// No conditional step exists in this declarative language to branch a
// reply on "did recall find anything" - a `format` step only ever
// interpolates a scalar. So the recall step itself resolves that here,
// binding one ready-to-speak string either way, the same "resolve it at
// the interpreter, not by asking the recipe author for a branch that
// doesn't exist" call `remember`'s own fixed confirmation text already
// makes.
/** What a `recall` step binds when nothing matched. Exported (#93) so
 * the hub's turn engine can tell an empty recall from an answer on the
 * tool path without a second copy of the phrase. */
export const NOTHING_RECALLED = "I don't remember anything about that.";

// Decodes HTML entities in the SUBSTITUTED VALUE, never the template
// itself (the template is always our own authored manifest/recipe text,
// which never contains entities; the value can come from `fetch`, an
// arbitrary external API). Found building the `trivia` plugin (2026-09-05):
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

// Recurses through an object/array, interpolating every string it finds -
// `integration.call`'s `args` is the one step field that needs this: a
// recipe reading Home Assistant state for "the porch light" has to pass
// the real entity id, not a literal "{entity_id}" (found writing this
// step's own conformance fixture). `fetch`'s `body` deliberately stays
// uninterpolated (no bundled package has ever needed one to vary), so
// this is scoped to `integration.call` only, not a general change to
// every step's object-shaped field.
function interpolateDeep(value: unknown, scope: Scope): unknown {
  if (typeof value === "string") return interpolate(value, scope);
  if (Array.isArray(value)) return value.map((v) => interpolateDeep(v, scope));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolateDeep(v, scope)]));
  }
  return value;
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
export async function runRecipe(recipe: Recipe, inputs: Scope, host: Host): Promise<PluginResult> {
  const scope: Scope = { ...inputs };
  const actions: { kind: string; payload?: unknown }[] = [];
  let reply: { text: string; speech?: string } | undefined;
  let data: Record<string, unknown> | undefined;
  let synthesisHint: string | undefined;
  let ask: { prompt: string; expects?: string } | undefined;

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
      case "lookup": {
        // A code from an upstream API to the household's word for it.
        // The key is the variable's value as text, so a numeric
        // weather_code finds its "61" row.
        const key = String(scope[step.from] ?? "");
        scope[step.as] = Object.prototype.hasOwnProperty.call(step.table, key) ? step.table[key] : (step.default ?? key);
        break;
      }
      case "format": {
        // CHAT-16: a step with a `synthesis_hint` and no `text` binds no
        // reply: the result is its `data` and the hint, phrased by the
        // composer (recipe.schema.json requires one of the two).
        if (step.text === undefined) {
          if (step.synthesis_hint === undefined) throw new Error("a format step needs text or synthesis_hint");
          reply = undefined;
          scope[step.as] = null;
        } else {
          const text = interpolate(step.text, scope);
          const speech = step.speech ? interpolate(step.speech, scope) : text;
          scope[step.as] = { text, speech };
          reply = { text, speech };
        }
        synthesisHint = step.synthesis_hint;
        // Named fields beside the text (result.schema.json's `data`): a
        // template that is exactly one {variable} keeps the variable's
        // own type, so a temperature stays a number for whoever phrases
        // it (CHAT-16); anything else is interpolated text.
        if (step.data) {
          data = {};
          for (const [name, template] of Object.entries(step.data)) {
            const single = /^\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/.exec(template);
            // A bound variable keeps its own value, and a bound-but-empty
            // one (a pick that found nothing) is null, the same in both
            // interpreters; an unbound one interpolates to its literal
            // placeholder.
            data[name] = single && single[1]! in scope ? (scope[single[1]!] ?? null) : interpolate(template, scope);
          }
        }
        break;
      }
      case "home.call_service": {
        // target/data interpolation (session-d-packages-and-store.md
        // step 9, the lights package's own dynamic-room case): every
        // string value, at any depth, may reference {variable} names,
        // the same interpolate-before-send convention integration.call's
        // own `args` already uses. Has no bearing on the security-domain
        // confirmation gate (packageHost.ts) - that checks `domain` and
        // the manifest's own `consequential` flag only.
        const target = interpolateDeep(step.target, scope) as Record<string, unknown>;
        const data = step.data ? (interpolateDeep(step.data, scope) as Record<string, unknown>) : null;
        await host.home.call_service(step.domain, step.service, target, data);
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
        // Step 5 (session-a-intelligence.md): the real host now embeds
        // the query before scoring, real I/O this step has to wait on -
        // `await` on a plain (non-Promise) array, the emulator's own
        // case, is a documented JS no-op, so this line is correct
        // against either host.
        const matches = await host.memory.recall(query, { scope: step.scope });
        const top = matches.slice(0, step.limit ?? 3);
        scope[step.as] = top.length > 0 ? top.map((m) => m.text).join("; ") : NOTHING_RECALLED;
        break;
      }
      case "schedule": {
        // `inputs` (session-d-packages-and-store.md step 8) closes a
        // real, previously-documented gap: this used to always pass
        // nothing, so a job scheduled from within a recipe re-fired the
        // package with an empty input scope, not the inputs the
        // original call had.
        const when = interpolate(step.when, scope);
        const inputs = step.inputs ? (interpolateDeep(step.inputs, scope) as Record<string, unknown>) : {};
        host.schedule(when, step.job ?? recipe.id, inputs);
        break;
      }
      case "integration.call": {
        const args = step.args ? (interpolateDeep(step.args, scope) as Record<string, unknown>) : undefined;
        scope[step.as] = await host.integration.call(step.id, step.method, args);
        break;
      }
      case "compute": {
        // evaluateExpression() throws ComputeError for a household
        // member's own bad input (an expression compute's restricted
        // evaluator can't parse) - a real, expected, recoverable case
        // now that `math`/`convert` (step 7) hand it free-typed text
        // rather than a package's own hardcoded template. A real gap
        // found while building those: this used to re-wrap it as a
        // bare `Error`, losing the type `lib/plugins.ts`'s own
        // runPlugin() needs to tell "bad input, a clean 400" apart from
        // a real bug worth throwing all the way up - fixed by
        // preserving ComputeError's own identity instead of erasing it.
        const expression = interpolate(step.expression, scope);
        scope[step.as] = evaluateExpression(expression);
        break;
      }
      case "llm_complete": {
        // Raw-object binding, same style as `fetch`'s own `as` - a
        // `pick` step reads `.text` out before a `format` step
        // interpolates it, rather than this step special-casing its own
        // result shape the way `compute`/`recall` bind a ready-to-use
        // scalar directly. `host.llm.complete`'s own wire shape is a
        // `messages` array (packageHost.ts's real implementation passes
        // it straight to lib/llm.ts's own `complete()`, unchanged, which
        // is already tested against that shape - backend/tests/
        // packageHost.test.ts) - this step's own `prompt` field is a
        // friendlier single-string template for a recipe author, wrapped
        // into one user-role message here rather than asking recipe.json
        // itself to spell out a messages array. No system prompt, no
        // history: a one-shot lookup completion (step 7's own translate
        // package is the first caller), not a chat turn.
        const prompt = interpolate(step.prompt, scope);
        scope[step.as] = await host.llm.complete({ messages: [{ role: "user", content: prompt }] });
        break;
      }
      case "list_add": {
        // Fire-and-forget, same shape `remember` already takes: nothing
        // is bound, a recipe's own `format` step confirms using the
        // input it already has (session-d-packages-and-store.md step 8).
        const text = interpolate(step.text, scope);
        host.lists.add(text);
        break;
      }
      case "list_view": {
        scope[step.as] = host.lists.view();
        break;
      }
      case "remind": {
        // Raw-object binding, same style as `llm_complete`'s own `as` -
        // a `pick` step reads each field out before a `format` step
        // interpolates it. host.reminders.set does the real natural-
        // language time/task parsing and the real scheduling, both
        // host-side: this step is declarative, neither is.
        const text = interpolate(step.text, scope);
        scope[step.as] = host.reminders.set(text);
        break;
      }
      case "timer": {
        const text = interpolate(step.text, scope);
        scope[step.as] = host.timers.set(text);
        break;
      }
      case "ask": {
        // Always the recipe's last meaningful step (the schema's own
        // description): nothing after it can depend on an answer that
        // hasn't arrived yet. Interpolated the same as any other prompt
        // text, so a recipe can ask "which {thing}" using whatever
        // ambiguity it just found.
        ask = { prompt: interpolate(step.prompt, scope), expects: step.expects };
        break;
      }
      default: {
        const exhaustive: never = step;
        throw new Error(`unhandled recipe step: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return { reply, actions, ...(ask ? { ask } : {}), ...(data ? { data } : {}), ...(synthesisHint !== undefined ? { synthesis_hint: synthesisHint } : {}) };
}
