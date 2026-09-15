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

# A quantity is a leading plain arithmetic expression plus a unit name;
# `to` splits it from the target unit. #108: the numeric half is a small
# arithmetic expression (digits, decimals, spaces, parentheses, + - * / **
# only - the same character set simpleeval's own restricted grammar
# accepts for plain arithmetic), not a bare number, so "50 percent of 2
# miles to km" normalized to "(50/100)*2 miles to km" converts instead of
# raising; anything else keeps the existing error. The expression is
# evaluated with simple_eval, the same restricted evaluator the plain
# arithmetic path below already uses - no bare `eval`. pint's own string
# parser (`Quantity(str)`) refuses the split value+unit form anyway, and
# refuses it ambiguously for offset units like fahrenheit/celsius
# (`OffsetUnitCalculusError`), so the value and unit are parsed apart here
# and passed to `Quantity(value, unit)` instead, which every unit (offset
# or not) accepts.
_CONVERT_RE = re.compile(r"^(.+?)\s+to\s+([a-zA-Z][a-zA-Z_ ]*)$")
_QUANTITY_RE = re.compile(r"^([0-9.() \t+-/*]+)\s+([a-zA-Z][a-zA-Z_ ]*)$")

# 6 significant digits, matching compute.ts's own DISPLAY_PRECISION -
# unit conversion routinely produces a long repeating decimal
# (37.77777777777783 for 100 F to C), unreadable in a chat reply or
# spoken aloud.
_DISPLAY_PRECISION = 6


class ComputeError(Exception):
    pass


# Turns spoken arithmetic into calculator symbols for simpleeval. The
# math package's `calculate *` pattern hands the evaluator spoken text
# (#72); mirrors interpreters/ts/compute.ts's own normalizeSpokenMath()
# rule for rule, one deliberate difference: powers become `**`, not
# `^`, because simpleeval reads `^` as bitwise xor ("5^2" would give 7).
def normalize_spoken_math(text: str) -> str:
    # 1. Trim; drop a trailing "?" or "."; collapse repeated spaces
    result = re.sub(r"\s+", " ", re.sub(r"[?.]+$", "", text.strip()))

    # 2. Multi-word expressions
    result = re.sub(r"\bmultiplied by\b", "*", result, flags=re.IGNORECASE)
    result = re.sub(r"\bdivided by\b", "/", result, flags=re.IGNORECASE)
    result = re.sub(r"\bto the power of\b", "**", result, flags=re.IGNORECASE)

    # 3. Single words
    result = re.sub(r"\bplus\b", "+", result, flags=re.IGNORECASE)
    result = re.sub(r"\bminus\b", "-", result, flags=re.IGNORECASE)
    result = re.sub(r"\btimes\b", "*", result, flags=re.IGNORECASE)
    # Only replace "over" when it's between digits or parentheses
    result = re.sub(r"(?<=[\d)])\s+over\s+(?=[\d(])", "/", result, flags=re.IGNORECASE)

    # 4. The letter "x" as multiplication sign. #107: the rule's own
    # lookbehind fired inside a hex literal ("0x10" became "0*10"), so every
    # hex literal is swapped for a placeholder no other rule touches before
    # the rule runs and restored afterwards - the placeholder survives rule
    # 4 untouched ("0x10" reaches the evaluator unchanged) while "12 x 12",
    # "3x4", "12 x12" and "12x 12" still become multiplications.
    hex_literals = re.findall(r"\b0[xX][0-9a-fA-F]+\b", result)
    for i, literal in enumerate(hex_literals):
        result = result.replace(literal, f"@HEX{i}@")
    result = re.sub(r"(?<=\d)\s*x\s*(?=\d)", "*", result)
    for i, literal in enumerate(hex_literals):
        result = result.replace(f"@HEX{i}@", literal)

    # 5. Squared and cubed
    result = re.sub(
        r"(\d+(?:\.\d+)?|\([^)]+\))\s+squared", r"\1**2", result, flags=re.IGNORECASE
    )
    result = re.sub(
        r"(\d+(?:\.\d+)?|\([^)]+\))\s+cubed", r"\1**3", result, flags=re.IGNORECASE
    )

    # 6. Percent of
    result = re.sub(
        r"(\d+(?:\.\d+)?)\s+percent\s+of\s+(\d+(?:\.\d+)?)",
        r"(\1/100)*\2",
        result,
        flags=re.IGNORECASE,
    )

    # 7. Percent alone
    result = re.sub(
        r"\b(\d+(?:\.\d+)?)\s+percent\b", r"(\1/100)", result, flags=re.IGNORECASE
    )

    return result


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


def evaluate_expression(raw_expression: str) -> str:
    expression = normalize_spoken_math(raw_expression)
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
        # #108: the quantity half is a small arithmetic expression, not a
        # bare number - evaluate it with simple_eval, the same restricted
        # evaluator the plain arithmetic path below already uses (never a
        # bare `eval`), and hand pint the resulting number.
        try:
            value = simple_eval(quantity_match.group(1))
        except Exception as err:  # simpleeval raises several distinct error types; all mean "not a valid expression"
            raise ComputeError(
                f'"{expression}" failed to evaluate: not a valid quantity expression'
            ) from err
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ComputeError(
                f'"{expression}" failed to evaluate: not a valid quantity expression'
            )
        unit = quantity_match.group(2).strip()
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
