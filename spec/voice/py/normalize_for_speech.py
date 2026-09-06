"""Speech normalization, the Python twin of spec/voice/ts/normalizeForSpeech.ts
(session-c-brain-and-voice.md step 6: "one fixture set both must pass" -
spec/voice/fixtures/normalize-for-speech.json is that set, loaded by both
spec/tests/ts/speechNormalize.test.ts and spec/tests/py/test_speech_normalize.py).

Behaviorally mirrors the TypeScript file function-for-function, same pass
order, same rule for each case. See that file's own header for the scope
rationale (register/brevity is a prompt concern, not this file's job; this
is the purely mechanical half - numbers, times, dates, currency, units).
`num2words` (LGPL-2.1: a dependency, never vendored - org's own
third-party-code rule) plays the role `to-words` plays on the TS side.
"""

import re

from num2words import num2words

# ---------------------------------------------------------------------------
# Markup/emoji stripping
# ---------------------------------------------------------------------------

_FENCED_CODE_RE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")
_IMAGE_RE = re.compile(r"!\[([^\]]*)]\([^)]*\)")
_LINK_RE = re.compile(r"\[([^\]]+)]\([^)]*\)")
_BOLD_STAR_RE = re.compile(r"\*\*([^*\n]+)\*\*")
_BOLD_UNDERSCORE_RE = re.compile(r"__([^_\n]+)__")
_EMPHASIS_STAR_RE = re.compile(r"(?<!\w)\*([^*\n]+)\*(?!\w)")
_EMPHASIS_UNDERSCORE_RE = re.compile(r"(?<!\w)_([^_\n]+)_(?!\w)")
_HEADING_RE = re.compile(r"^[ \t]{0,3}#{1,6}[ \t]+", re.MULTILINE)
_BULLET_RE = re.compile(r"^[ \t]*([-*+]|\d+\.)[ \t]+", re.MULTILINE)
_BLOCKQUOTE_RE = re.compile(r"^[ \t]*>[ \t]?", re.MULTILINE)
_EMOJI_RE = re.compile("[\U0001f000-\U0001faff☀-➿⬀-⯿️‍]")


def _strip_markup_for_speech(text: str) -> str:
    s = _FENCED_CODE_RE.sub(" ", text)
    s = _INLINE_CODE_RE.sub(r"\1", s)
    s = _IMAGE_RE.sub(r"\1", s)
    s = _LINK_RE.sub(r"\1", s)
    s = _BOLD_STAR_RE.sub(r"\1", s)
    s = _BOLD_UNDERSCORE_RE.sub(r"\1", s)
    s = _EMPHASIS_STAR_RE.sub(r"\1", s)
    s = _EMPHASIS_UNDERSCORE_RE.sub(r"\1", s)
    s = _HEADING_RE.sub("", s)
    s = _BULLET_RE.sub("", s)
    s = _BLOCKQUOTE_RE.sub("", s)
    s = _EMOJI_RE.sub("", s)
    return s


# ---------------------------------------------------------------------------
# Number-to-words
# ---------------------------------------------------------------------------

_ONES = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
]
_TENS = [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
]

# A code review (2026-09-06) found this only matched "hundred and"
# (e.g. "one hundred and five"), missing that num2words also inserts the
# identical connective right before the final sub-100 chunk after a
# scale word with NO hundreds digit in that chunk ("one thousand and
# twenty-one", "one million and twenty-one" - verified live against the
# installed library). num2words never uses "and" any other way in a
# cardinal's English rendering, so this matches the connective itself
# (with its surrounding spaces, collapsed back to one), not just the one
# place it happens to follow "hundred".
_AND_RE = re.compile(r"\s+and\s+")


def _two_digits_to_words(n: int) -> str:
    if n < 20:
        return _ONES[n]
    tens, ones = divmod(n, 10)
    return _TENS[tens] if ones == 0 else f"{_TENS[tens]}-{_ONES[ones]}"


def number_to_words(n: int) -> str:
    """Whole numbers only, mirroring numberToWords() in the TS file.
    num2words's raw en output ("two hundred and thirty-four", "minus
    forty-two", comma-separated scales) doesn't match this domain's
    register any more than to-words's did on the TS side, so this is the
    identical thin adapter: drop the British "and", drop the thousands
    commas, and use "negative" in place of "minus"."""
    words = num2words(n, lang="en")
    words = _AND_RE.sub(" ", words)
    words = words.replace(",", "")
    if words.startswith("minus "):
        words = "negative " + words[len("minus ") :]
    return words


_ORDINAL_WORD = {
    "one": "first",
    "two": "second",
    "three": "third",
    "five": "fifth",
    "eight": "eighth",
    "nine": "ninth",
    "twelve": "twelfth",
    "twenty": "twentieth",
    "thirty": "thirtieth",
    "forty": "fortieth",
    "fifty": "fiftieth",
    "sixty": "sixtieth",
    "seventy": "seventieth",
    "eighty": "eightieth",
    "ninety": "ninetieth",
}


def _ordinal_words(n: int) -> str:
    cardinal = number_to_words(n)
    last_dash = cardinal.rfind("-")
    head = "" if last_dash == -1 else cardinal[: last_dash + 1]
    tail = cardinal if last_dash == -1 else cardinal[last_dash + 1 :]
    ordinal_tail = _ORDINAL_WORD.get(tail) or (
        f"{tail[:-1]}ieth" if tail.endswith("y") else f"{tail}th"
    )
    return head + ordinal_tail


# ---------------------------------------------------------------------------
# Times
# ---------------------------------------------------------------------------

_TIME_RE = re.compile(
    r"\b(?:([01]?\d|2[0-3]):([0-5]\d))(\s*(?:am|pm|a\.m\.|p\.m\.))?(?![a-zA-Z])",
    re.IGNORECASE,
)


def _meridiem_word(hour: int, marker: str | None) -> tuple[int, str]:
    clean = (marker or "").lower().replace(".", "").strip()
    if clean in ("am", "pm"):
        hour12 = 12 if hour % 12 == 0 else hour % 12
        return hour12, " in the morning" if clean == "am" else " in the evening"
    if hour == 0:
        return 12, ""
    if hour > 12:
        return hour - 12, ""
    return hour, ""


def _normalize_times(text: str) -> str:
    def replace(m: re.Match[str]) -> str:
        hour = int(m.group(1))
        minute = int(m.group(2))
        marker = m.group(3)
        hour12, suffix = _meridiem_word(hour, marker)
        clean = (marker or "").lower().replace(".", "").strip()
        if hour12 == 12 and minute == 0 and clean == "am":
            return "midnight"
        if hour12 == 12 and minute == 0 and clean == "pm":
            return "noon"
        hour_words = number_to_words(hour12)
        if minute == 0:
            return f"{hour_words} o'clock{suffix}"
        minute_words = (
            f"oh {number_to_words(minute)}" if minute < 10 else number_to_words(minute)
        )
        return f"{hour_words} {minute_words}{suffix}"

    return _TIME_RE.sub(replace, text)


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

_MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]
_MONTH_RE = re.compile(r"\b(" + "|".join(_MONTHS) + r")\s+(\d{1,2})(?:,\s*(\d{4}))?\b")
_ISO_DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def _spoken_year(year: int) -> str:
    if 2000 <= year <= 2099:
        rest = year - 2000
        return "twenty hundred" if rest == 0 else f"twenty {_two_digits_to_words(rest)}"
    if 1000 <= year <= 1999 and year % 100 != 0:
        return f"{_two_digits_to_words(year // 100)} {_two_digits_to_words(year % 100)}"
    return number_to_words(year)


def _normalize_dates(text: str) -> str:
    def month_day_year(m: re.Match[str]) -> str:
        month, day, year = m.group(1), m.group(2), m.group(3)
        spoken = f"{month} {_ordinal_words(int(day))}"
        return f"{spoken}, {_spoken_year(int(year))}" if year else spoken

    def iso_date(m: re.Match[str]) -> str:
        y, mo, d = m.group(1), m.group(2), m.group(3)
        month_index = int(mo) - 1
        if month_index < 0 or month_index >= len(_MONTHS):
            return m.group(0)
        return (
            f"{_MONTHS[month_index]} {_ordinal_words(int(d))}, {_spoken_year(int(y))}"
        )

    s = _MONTH_RE.sub(month_day_year, text)
    s = _ISO_DATE_RE.sub(iso_date, s)
    return s


# ---------------------------------------------------------------------------
# Currency
# ---------------------------------------------------------------------------

_CURRENCY_RE = re.compile(r"\$(\d[\d,]*)(?:\.(\d{2}))?")


def _dollars_and_cents(dollars: int, cents: int | None) -> str:
    dollar_word = "dollar" if dollars == 1 else "dollars"
    dollars_part = f"{number_to_words(dollars)} {dollar_word}"
    if not cents:
        return dollars_part
    cent_word = "cent" if cents == 1 else "cents"
    return f"{dollars_part} and {number_to_words(cents)} {cent_word}"


def _normalize_currency(text: str) -> str:
    def replace(m: re.Match[str]) -> str:
        dollars = int(m.group(1).replace(",", ""))
        cents = int(m.group(2)) if m.group(2) else None
        return _dollars_and_cents(dollars, cents)

    return _CURRENCY_RE.sub(replace, text)


# ---------------------------------------------------------------------------
# Percentages
# ---------------------------------------------------------------------------

_PERCENT_RE = re.compile(r"(\d+(?:\.\d+)?)\s?%")


def _spoken_decimal(n: str) -> str:
    parts = n.split(".", 1)
    whole_words = number_to_words(int(parts[0]))
    if len(parts) == 1:
        return whole_words
    frac_words = " ".join(_ONES[int(d)] for d in parts[1])
    return f"{whole_words} point {frac_words}"


def _normalize_percent(text: str) -> str:
    return _PERCENT_RE.sub(lambda m: f"{_spoken_decimal(m.group(1))} percent", text)


# ---------------------------------------------------------------------------
# Units and common abbreviations
# ---------------------------------------------------------------------------

_UNIT_ABBREVIATIONS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bmph\b", re.IGNORECASE), "miles per hour"),
    (re.compile(r"\bkm/h\b", re.IGNORECASE), "kilometers per hour"),
    (re.compile(r"°F\b"), " degrees Fahrenheit"),
    (re.compile(r"°C\b"), " degrees Celsius"),
    (re.compile(r"\bft\b", re.IGNORECASE), "feet"),
    (re.compile(r"(?<=\d)\s?in\.(?=\s|$)"), " inches"),
    (re.compile(r"\blbs?\b", re.IGNORECASE), "pounds"),
    (re.compile(r"\boz\b", re.IGNORECASE), "ounces"),
    (re.compile(r"\bkm\b", re.IGNORECASE), "kilometers"),
    (re.compile(r"\bkg\b", re.IGNORECASE), "kilograms"),
    (re.compile(r"\bmi\b", re.IGNORECASE), "miles"),
    (re.compile(r"\bhrs?\b", re.IGNORECASE), "hours"),
    (re.compile(r"\bmins?\b", re.IGNORECASE), "minutes"),
]

_WORD_ABBREVIATIONS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bMr\.\s?"), "Mister "),
    (re.compile(r"\bMrs\.\s?"), "Missus "),
    (re.compile(r"\bMs\.\s?"), "Miz "),
    (re.compile(r"\bDr\.\s?"), "Doctor "),
    (re.compile(r"\bSt\.\s?"), "Saint "),
    (re.compile(r"\bvs\.\s?"), "versus "),
    (re.compile(r"\betc\.\s?"), "et cetera "),
    (re.compile(r"\bapprox\.\s?"), "approximately "),
]


def _normalize_units_and_abbreviations(text: str) -> str:
    s = text
    for pattern, word in _UNIT_ABBREVIATIONS:
        s = pattern.sub(word, s)
    for pattern, word in _WORD_ABBREVIATIONS:
        s = pattern.sub(word, s)
    return s


# ---------------------------------------------------------------------------
# Generic numbers (the catch-all, run last)
# ---------------------------------------------------------------------------

_ORDINAL_DIGIT_RE = re.compile(r"\b(\d+)(st|nd|rd|th)\b", re.IGNORECASE)
_NUMBER_RE = re.compile(r"\b\d[\d,]*(?:\.\d+)?\b")
_SINGULAR_AGREEMENT_RE = re.compile(r"\bone ([a-z]+)s\b")
_ALREADY_SINGULAR_RE = re.compile(r"(ss|us|is|as|ens)$", re.IGNORECASE)


def _fix_singular_agreement(text: str) -> str:
    def replace(m: re.Match[str]) -> str:
        stem = m.group(1)
        if _ALREADY_SINGULAR_RE.search(f"{stem}s"):
            return m.group(0)
        return f"one {stem}"

    return _SINGULAR_AGREEMENT_RE.sub(replace, text)


def _normalize_generic_numbers(text: str) -> str:
    s = _ORDINAL_DIGIT_RE.sub(lambda m: _ordinal_words(int(m.group(1))), text)
    s = _NUMBER_RE.sub(lambda m: _spoken_decimal(m.group(0).replace(",", "")), s)
    return _fix_singular_agreement(s)


# ---------------------------------------------------------------------------
# The one, central, mechanical normalizer
# ---------------------------------------------------------------------------

_TRAILING_SPACE_RE = re.compile(r"[ \t]{2,}")
_SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([.,!?;:])")


def normalize_for_speech(text: str) -> str:
    """Pure and side-effect free; never call it on anything meant for the
    screen. See normalizeForSpeech.ts's own docstring for the full scope
    rationale - this mirrors it pass-for-pass, same order."""
    s = _strip_markup_for_speech(text)
    s = _normalize_dates(s)
    s = _normalize_times(s)
    s = _normalize_currency(s)
    s = _normalize_percent(s)
    s = _normalize_units_and_abbreviations(s)
    s = _normalize_generic_numbers(s)
    s = _TRAILING_SPACE_RE.sub(" ", s)
    s = _SPACE_BEFORE_PUNCT_RE.sub(r"\1", s)
    return s.strip()
