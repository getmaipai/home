"""The `compute` recipe step's real evaluator (session-d-packages-and-
store.md step 4), behaviorally mirroring interpreters/ts/compute.ts's own
mathjs-backed one: math and unit conversion, no network call, no host
access. Two libraries rather than one, since no single maintained Python
package does both a restricted arithmetic evaluator and unit conversion
the way mathjs does in one call: `simpleeval` (a safe, restricted AST-
walking evaluator - no attribute/name access, no import, the same posture
compute.ts's own disabled `import`/`createUnit` enforces) for plain
arithmetic, `pint` for unit conversion.
"""

import re

from pint import UnitRegistry
from simpleeval import simple_eval

_ureg = UnitRegistry()

# A quantity is a leading numeric literal (or a nested plain arithmetic
# expression, kept simple as a single number here since a package's own
# recipe.json is the only author of these expressions) plus a unit name;
# `to` splits it from the target unit. pint's own string parser
# (`Quantity(str)`) refuses this ambiguously for offset units like
# fahrenheit/celsius (`OffsetUnitCalculusError`), so the value and unit
# are parsed apart here and passed to `Quantity(value, unit)` instead,
# which every unit (offset or not) accepts.
_CONVERT_RE = re.compile(r"^(.+?)\s+to\s+([a-zA-Z][a-zA-Z_ ]*)$")
# The numeric half accepts scientific notation ("1e3") in addition to a
# plain decimal - mathjs's own expression grammar (compute.ts's side)
# already does on any number literal, and a code review (2026-09-06)
# caught this regex silently rejecting it as "not a recognized quantity"
# instead of converting.
_QUANTITY_RE = re.compile(
    r"^(-?[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)\s*([a-zA-Z][a-zA-Z_ ]*)$"
)

# 6 significant digits, matching compute.ts's own DISPLAY_PRECISION -
# unit conversion routinely produces a long repeating decimal
# (37.77777777777783 for 100 F to C), unreadable in a chat reply or
# spoken aloud.
_DISPLAY_PRECISION = 6


class ComputeError(Exception):
    pass


def _format(value: float) -> str:
    formatted = f"{value:.{_DISPLAY_PRECISION}g}"
    # Python's "g" format switches to exponential notation past a
    # magnitude threshold ("1e+06" for 1000000) where mathjs's own
    # `format()` still prints a plain decimal for numbers in this range -
    # undoing that keeps the two interpreters' output identical for the
    # conformance fixtures, not just close.
    if "e" in formatted:
        formatted = (
            f"{value:.0f}"
            if value == int(value)
            else f"{value:.{_DISPLAY_PRECISION}f}".rstrip("0").rstrip(".")
        )
    return formatted


def evaluate_expression(expression: str) -> str:
    convert_match = _CONVERT_RE.match(expression.strip())
    if convert_match:
        quantity_expr, target_unit = (
            convert_match.group(1).strip(),
            convert_match.group(2).strip(),
        )
        quantity_match = _QUANTITY_RE.match(quantity_expr)
        if not quantity_match:
            raise ComputeError(
                f'"{expression}" failed to evaluate: not a recognized "<number> <unit>" quantity'
            )
        value, unit = quantity_match.group(1), quantity_match.group(2).strip()
        try:
            converted = _ureg.Quantity(float(value), unit).to(target_unit)
        except Exception as err:  # pint raises several distinct error types; all mean "not a valid conversion"
            raise ComputeError(f'"{expression}" failed to evaluate: {err}') from err
        return f"{_format(converted.magnitude)} {target_unit}"

    try:
        result = simple_eval(expression)
    except Exception as err:  # simpleeval raises several distinct error types; all mean "not a valid expression"
        raise ComputeError(f'"{expression}" failed to evaluate: {err}') from err
    if not isinstance(result, (int, float)) or isinstance(result, bool):
        raise ComputeError(f'"{expression}" did not evaluate to a number or a unit')
    return _format(result)
