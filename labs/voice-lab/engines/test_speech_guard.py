"""Plain asserts for speech_guard. Run: python test_speech_guard.py"""
from speech_guard import estimate_seconds, runaway_limit_seconds

assert estimate_seconds("") == 1.5
assert estimate_seconds("Hi.") == 1.5
assert estimate_seconds("   Hi.   ") == 1.5                      # outer blanks do not count
assert estimate_seconds("x" * 21) == 1.5                         # 21 / 14 = 1.5 exactly
assert abs(estimate_seconds("x" * 28) - 2.0) < 1e-9
assert abs(estimate_seconds("x" * 130) - 130 / 14) < 1e-9        # the long benchmark phrase, 9.29 s
assert abs(estimate_seconds("x" * 140) - 10.0) < 1e-9
assert estimate_seconds("a" * 60) > estimate_seconds("a" * 20)   # longer text, longer estimate
assert abs(runaway_limit_seconds("x" * 28) - 4.4) < 1e-9         # 2.2 times 2.0
assert abs(runaway_limit_seconds("Hi.") - 3.3) < 1e-9            # 2.2 times the 1.5 s floor
print("speech_guard: all asserts passed")
