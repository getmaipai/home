"""Styled reference clips: higgs-v3 (the one model with real emotion controls) speaks a known
sentence in each style, cloned from the voice's plain reference. A fast cloning model can then
clone from that clip instead of the plain one. Made once per voice, offline, cached on disk.
"""
import numpy as np

from tts_engines import SR
from voice_store import resample, trim_silence

STYLES = ("whisper", "shout", "angry", "excited")
# About 9 s each when spoken; the words suit the style so the model has a reason to deliver it.
STYLE_TEXT = {
    "neutral": "The morning train arrives at the station a few minutes after eight, and most people simply wait quietly on the platform with a cup of coffee in hand.",
    "whisper": "Come a little closer and keep your voice down, because everyone else in the house is asleep, and I do not want to wake anybody up tonight.",
    "shout": "Get back from the edge right now! Everybody move to the left side of the road, and do not stop running until you reach the gate at the far end!",
    "angry": "I am done listening to excuses. You promised me this would be finished days ago, and every single time you just look away and say nothing at all.",
    "excited": "We did it, we really did it! The whole team just found out, and everyone is cheering and laughing, because we finally won!",
}


def make_style_refs(eng, store, vid, styles, log=print, tries=4, lo=7.5, hi=10.5):
    """`eng` is a loaded HiggsV3 engine. Saves styles/<style>.wav and .txt; returns {style: seconds}."""
    import mlx.core as mx
    prep = eng.prepare(store.audio(vid), store.text(vid))
    toks = {"neutral": "", **eng.native_styles}
    out = {}
    for st in styles:
        best = None
        for t in range(tries):
            mx.random.seed(100 + t)
            a = np.concatenate(list(eng.stream(toks[st] + STYLE_TEXT[st], prep)))
            a = trim_silence(resample(a, eng.rate, SR), SR)
            d = len(a) / SR
            log(f"style {st} try {t}: {d:.2f} s")
            if best is None or abs(d - 9) < abs(len(best) / SR - 9):
                best = a
            if lo <= d <= hi:
                break
        pk = float(np.abs(best).max())
        if pk > 0.95:  # keep the style's own level; only guard against clipping
            best = best * (0.95 / pk)
        store.save_style(vid, st, best.astype(np.float32), STYLE_TEXT[st])
        out[st] = round(len(best) / SR, 2)
    return out
