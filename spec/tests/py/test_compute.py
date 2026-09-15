"""normalize_spoken_math (spec/interpreters/py/compute.py): the Python
twin of spec/interpreters/ts/compute.ts's own normalizeSpokenMath (#72).
Powers use `**`, not `^`, since simpleeval reads `^` as bitwise xor.
"""

import pytest

from interpreters.py.compute import (
    ComputeError,
    evaluate_expression,
    normalize_spoken_math,
)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("12 times 12", "12 * 12"),
        ("100 divided by 4", "100 / 4"),
        ("100 over 4", "100/4"),
        ("2 miles over there", "2 miles over there"),
        ("12 x 12", "12*12"),
        ("3x4", "3*4"),
        ("12 x12", "12*12"),
        ("12x 12", "12*12"),
        ("5 squared", "5**2"),
        ("2.5 squared", "2.5**2"),
        ("20 percent of 50", "(20/100)*50"),
        ("12.5 percent of 80", "(12.5/100)*80"),
        ("5 SQUARED", "5**2"),
        ("(2 + 3) * 4", "(2 + 3) * 4"),
        ("2 miles to km", "2 miles to km"),
        ("12 times?", "12 *"),
        ("seven times three", "seven * three"),
    ],
)
def test_normalize_spoken_math(text: str, expected: str) -> None:
    assert normalize_spoken_math(text) == expected


def test_normalize_spoken_math_trims_only_trailing_question_mark_or_period() -> None:
    assert normalize_spoken_math("   12 times 12   ") == "12 * 12"
    assert normalize_spoken_math("100 divided by 4.") == "100 / 4"
    assert normalize_spoken_math("5 squared!") == "5**2!"


def test_evaluate_expression_spoken_arithmetic() -> None:
    assert evaluate_expression("12 times 12") == "144"
    assert evaluate_expression("100 divided by 4") == "25"
    assert evaluate_expression("20 percent of 50") == "10"
    assert evaluate_expression("5 squared") == "25"
    assert evaluate_expression("2 to the power of 3") == "8"
    assert evaluate_expression("(2 + 3) * 4") == "20"


def test_evaluate_expression_unit_conversion_still_works_after_normalization() -> None:
    assert evaluate_expression("2 miles to km").startswith("3.21")


def test_evaluate_expression_keeps_hex_literals_untouched_and_evaluates_them() -> None:
    assert normalize_spoken_math("0x10") == "0x10"
    assert evaluate_expression("0x10") == "16"
    assert evaluate_expression("0xff plus 1") == "256"


def test_evaluate_expression_quantity_is_a_small_arithmetic_expression() -> None:
    assert (
        normalize_spoken_math("50 percent of 2 miles to km") == "(50/100)*2 miles to km"
    )
    assert evaluate_expression("50 percent of 2 miles to km").startswith("1.60934")
    assert evaluate_expression("(1+1) miles to km").startswith("3.21")
    assert evaluate_expression("2 ** 3 miles to km").startswith("12.87")


def test_evaluate_expression_quantity_with_a_letter_still_raises() -> None:
    with pytest.raises(ComputeError):
        evaluate_expression("x miles to km")


def test_evaluate_expression_raises_for_a_malformed_expression() -> None:
    with pytest.raises(ComputeError):
        evaluate_expression("12 times")
