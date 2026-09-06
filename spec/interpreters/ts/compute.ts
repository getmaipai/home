// The `compute` recipe step's real evaluator (session-d-packages-and-
// store.md step 4): math and unit conversion, no network call, no host
// access - backs `math`/`convert` (step 7) without either package needing
// its own fetch-based service for plain arithmetic or a unit table.
//
// mathjs's own security docs name `import` and `createUnit` as functions
// "not meant to be run by an end user" against untrusted expression
// strings: they can redefine the library's own behavior for every later
// call in the same process. A recipe's `expression` field is
// household-authored (a package's own recipe.json), not something a third
// party ever supplies directly to this evaluator - but a recipe step
// interpolates `{variable}` values into the string first (the same
// substitution every other step's text fields already do), and one of
// those variables can be a chat turn's own free-text input. Disabling
// both here means an interpolated expression can never do more than
// evaluate to a number/unit, regardless of what ends up inside the
// braces.
import { create, all, type FactoryFunctionMap } from "mathjs";

// `all` (backend's own bundler-resolution tsconfig, unlike spec's, infers
// it as `FactoryFunctionMap | undefined` from mathjs's own generated
// .d.ts - a real, narrow type-resolution quirk between the two
// tsconfigs, not an actual runtime possibility mathjs's own docs or
// source ever describe) needs this cast so both packages' `tsc --noEmit`
// stay clean against the identical call.
const limitedMath = create(all as FactoryFunctionMap, {});
limitedMath.import(
  {
    import: function () {
      throw new Error("Function import is disabled in the compute step's restricted evaluator");
    },
    createUnit: function () {
      throw new Error("Function createUnit is disabled in the compute step's restricted evaluator");
    },
  },
  { override: true },
);

export class ComputeError extends Error {}

/** Evaluates one `compute` step's expression (already `{variable}`-
 * interpolated by the caller) and returns a display string - mathjs's
 * own `.toString()` on a `Unit` result already renders "7.5 km"-style
 * output, and a plain number renders as its own decimal string, so no
 * separate formatting branch is needed for either shape. */
// 6 significant digits, not mathjs's own unrounded default (unit
// conversion routinely produces a long repeating decimal, e.g.
// "37.77777777777778 celsius" for 100°F - unreadable in a chat reply or
// spoken aloud) and not a fixed decimal count either (that would print
// "0.00" for a small result like 0.001 kg to g). Matches weather's own
// one-decimal rounding in spirit: round for a person to read, not for
// floating-point exactness.
const DISPLAY_PRECISION = 6;

export function evaluateExpression(expression: string): string {
  try {
    const result: unknown = limitedMath.evaluate(expression);
    if (typeof result === "number" || typeof result === "bigint") return limitedMath.format(result, { precision: DISPLAY_PRECISION });
    if (result && typeof result === "object" && "toString" in result) return limitedMath.format(result, { precision: DISPLAY_PRECISION });
    throw new ComputeError(`"${expression}" did not evaluate to a number or a unit`);
  } catch (err) {
    if (err instanceof ComputeError) throw err;
    throw new ComputeError(`"${expression}" failed to evaluate: ${(err as Error).message}`);
  }
}
