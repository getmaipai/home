import { readField } from "@/kit/schema/fieldPath";

// spec/ui/schema.json's own description: "a simple expression string
// evaluated against page state." Deliberately minimal (no page authored
// this session actually needs one - docs/plans/session-b-ui.md step 5's
// scope was People/Privacy/Settings staying hand-written React, Memory's
// own schema page has no conditional sections) and deliberately not
// `eval`/`Function`: a JSON page is trusted content today, but a real
// expression evaluator is exactly the kind of primitive the plan says
// not to invent ahead of an actual need - three forms cover what "simple"
// can mean without reaching for one.
export function evaluateCondition(condition: string | undefined, state: Record<string, unknown>): boolean {
  if (!condition) return true;
  const trimmed = condition.trim();

  const negated = trimmed.startsWith("!");
  const withoutBang = negated ? trimmed.slice(1).trim() : trimmed;

  const equals = withoutBang.match(/^([\w.]+)\s*==\s*'([^']*)'$/);
  if (equals) {
    const [, path, expected] = equals;
    const actual = readField(state, path!);
    const result = String(actual) === expected;
    return negated ? !result : result;
  }

  // A bare dotted path is the only other supported form - a code review
  // (2026-09-05) found an unsupported operator (`!=`, `>`, `&&`...)
  // silently fell all the way through to here, where it doesn't match a
  // real path either, so `readField` just returns `undefined` and the
  // section renders as always-hidden with no signal that the syntax was
  // never valid. A dotted path only ever contains word characters and
  // dots; anything else is a genuine authoring mistake, loud now rather
  // than a silently-wrong render later.
  if (!/^[\w.]+$/.test(withoutBang)) {
    throw new Error(
      `kit/schema: unsupported condition "${condition}" - only a bare dotted path, "!path", "path == 'value'" or "!path == 'value'" are supported`,
    );
  }
  const value = readField(state, withoutBang);
  const truthy = Boolean(value);
  return negated ? !truthy : truthy;
}
