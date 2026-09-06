"""normalize_for_speech (spec/voice/py/normalize_for_speech.py): the Python
twin of spec/voice/ts/normalizeForSpeech.ts. The full-pipeline cases are
loaded from spec/voice/fixtures/normalize-for-speech.json, the same file
spec/tests/ts/speechNormalize.test.ts loads - session-c-brain-and-voice.md
step 6's "one fixture set both must pass," not two hand-maintained lists
that can silently drift apart.
"""

import json
from pathlib import Path

import pytest

from voice.py.normalize_for_speech import normalize_for_speech, number_to_words

SPEC_DIR = Path(__file__).resolve().parents[2]
FIXTURE_PATH = SPEC_DIR / "voice" / "fixtures" / "normalize-for-speech.json"

with open(FIXTURE_PATH) as f:
    fixtures = json.load(f)


@pytest.mark.parametrize("fixture", fixtures, ids=[fx["input"] for fx in fixtures])
def test_normalize_for_speech_fixture(fixture: dict) -> None:
    assert normalize_for_speech(fixture["input"]) == fixture["expected"]


def test_number_to_words_zero_and_small_numbers() -> None:
    assert number_to_words(0) == "zero"
    assert number_to_words(5) == "five"
    assert number_to_words(19) == "nineteen"


def test_number_to_words_tens_and_compound_tens() -> None:
    assert number_to_words(20) == "twenty"
    assert number_to_words(21) == "twenty-one"
    assert number_to_words(99) == "ninety-nine"


def test_number_to_words_hundreds() -> None:
    assert number_to_words(100) == "one hundred"
    assert number_to_words(234) == "two hundred thirty-four"
    assert number_to_words(905) == "nine hundred five"


def test_number_to_words_thousands_and_millions() -> None:
    assert number_to_words(1000) == "one thousand"
    assert number_to_words(1234) == "one thousand two hundred thirty-four"
    assert number_to_words(2_500_000) == "two million five hundred thousand"


def test_number_to_words_negative() -> None:
    assert number_to_words(-42) == "negative forty-two"


def test_number_to_words_no_stray_and_when_the_final_chunk_has_no_hundreds_digit() -> (
    None
):
    # A code review (2026-09-06) found num2words inserts "and" before the
    # final sub-100 chunk after ANY scale word (thousand/million/billion),
    # not only after "hundred" ("one thousand and twenty-one") - the
    # original _AND_RE only matched "hundred and", missing this case
    # entirely for a number like 1021 whose last chunk has no hundreds
    # digit. None of this file's other cases (1234, 2_500_000) have a
    # zero hundreds digit in their final chunk, so this slipped past both
    # test suites until reviewed.
    assert number_to_words(1021) == "one thousand twenty-one"
    assert number_to_words(100021) == "one hundred thousand twenty-one"
    assert number_to_words(1000021) == "one million twenty-one"
    assert number_to_words(1005) == "one thousand five"


def test_normalize_for_speech_is_pure() -> None:
    text = "It's 10:04 and 25% chance of rain, $5.50."
    assert normalize_for_speech(text) == normalize_for_speech(text)
    assert text == "It's 10:04 and 25% chance of rain, $5.50."
