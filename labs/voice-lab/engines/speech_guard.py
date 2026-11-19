"""Runaway guard for streamed speech: a simple length estimate from the text, and the limit built on it.

A model that loses the end of a sentence keeps talking (babble, a repeated syllable, a long drone).
The guard compares the audio made so far for one piece of text with what the text can plausibly
take and stops the piece when the audio is far longer. Nothing here looks at the audio content.
"""
CHARS_PER_SECOND = 14.0   # casual speech, including a little pause between sentences
MIN_SECONDS = 1.5
RUNAWAY_FACTOR = 2.2


def estimate_seconds(text):
    """Plain length estimate: characters / 14 per second, never below 1.5 s."""
    return max(MIN_SECONDS, len(text.strip()) / CHARS_PER_SECOND)


def runaway_limit_seconds(text):
    """Audio longer than this for the text is treated as a runaway."""
    return RUNAWAY_FACTOR * estimate_seconds(text)
