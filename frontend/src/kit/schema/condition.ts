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

  // A bare dotted path: truthy check.
  const value = readField(state, withoutBang);
  const truthy = Boolean(value);
  return negated ? !truthy : truthy;
}
