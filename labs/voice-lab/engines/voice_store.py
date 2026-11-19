"""Voices on disk, and the audio helpers that clean a reference clip and a streamed reply.

    <store>/<id>/ref.wav, ref.txt, meta.json       the cleaned reference clip (24 kHz mono) and its transcript
    <store>/<id>/styles/<style>.wav, .txt          styled reference clips (made by higgs-v3, see style_refs.py)
    <store>/<id>/prep/<model>/<plain|style>.npz    the model's prepared form of that clip, cached per model
"""
import io
import json
import os
import re
import time
from math import gcd

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

SR = 24000
MIN_S, MAX_S = 3.0, 30.0
SIL_DB = -45.0  # below this (relative to the clip's peak for references, absolute for replies) counts as silence


class VoiceError(ValueError):
    pass


def resample(a, src, dst=SR):
    if src == dst:
        return a.astype(np.float32)
    g = gcd(src, dst)
    return resample_poly(a, dst // g, src // g).astype(np.float32)


class Resampler:
    """Streaming resample: each piece is filtered with a little of the previous piece in front,
    so piece borders have no clicks. Used only for models whose native rate is not 24 kHz."""
    def __init__(self, src, dst=SR):
        self.src, self.dst = src, dst
        g = gcd(src, dst)
        self.up, self.down = dst // g, src // g
        self.ctx = np.zeros(0, np.float32)
        self.keep = self.down * 4  # input samples of context, a multiple of `down` so the drop is exact

    def __call__(self, x):
        if self.src == self.dst:
            return x
        y = resample_poly(np.concatenate([self.ctx, x]), self.up, self.down).astype(np.float32)
        drop = len(self.ctx) * self.up // self.down
        self.ctx = np.concatenate([self.ctx, x])[-self.keep:]
        return y[drop:]


def read_wav_bytes(data):
    try:
        sr, a = wavfile.read(io.BytesIO(data))
    except Exception as e:
        raise VoiceError(f"The file is not a readable WAV ({type(e).__name__}). Send a PCM or float WAV file.")
    if a.dtype == np.int16:
        a = a.astype(np.float32) / 32768.0
    elif a.dtype == np.int32:
        a = a.astype(np.float32) / 2147483648.0
    elif a.dtype == np.uint8:
        a = (a.astype(np.float32) - 128) / 128.0
    else:
        a = a.astype(np.float32)
    if a.ndim > 1:
        a = a.mean(axis=1)
    return sr, a


def trim_silence(a, sr, pad_s=0.05, db=SIL_DB):
    if not len(a):
        return a
    thr = 10 ** (db / 20) * max(float(np.abs(a).max()), 1e-6)
    idx = np.where(np.abs(a) > thr)[0]
    if not len(idx):
        return a[:0]
    return a[max(0, idx[0] - int(pad_s * sr)): idx[-1] + int(pad_s * sr)]


def loudness_normalize(a, target_db=-20.0, peak=0.95):
    """Scale so the speech (frames above -40 dB of the loudest frame) has an RMS of target_db."""
    fl = 480
    if len(a) < fl * 2:
        return a
    fr = np.lib.stride_tricks.sliding_window_view(a, fl)[::fl // 2]
    e = np.sqrt((fr ** 2).mean(1))
    act = e > 10 ** (-40 / 20) * e.max()
    rms = np.sqrt((fr[act] ** 2).mean()) if act.any() else e.max()
    g = 10 ** (target_db / 20) / max(rms, 1e-6)
    g = min(g, peak / max(float(np.abs(a).max()), 1e-6))
    return (a * g).astype(np.float32)


def clean_reference(data, normalize=True):
    """Bytes of any WAV -> (24 kHz mono float32, source seconds). Raises VoiceError with a plain message."""
    sr, a = read_wav_bytes(data)
    src_s = len(a) / sr
    if src_s < MIN_S:
        raise VoiceError(f"The clip is {src_s:.1f} s long. Send a clip of {MIN_S:.0f} to {MAX_S:.0f} seconds of one person talking.")
    if src_s > MAX_S:
        raise VoiceError(f"The clip is {src_s:.1f} s long. Send a clip of {MIN_S:.0f} to {MAX_S:.0f} seconds; cut it shorter.")
    a = trim_silence(resample(a, sr), SR)
    if len(a) / SR < 1.0:
        raise VoiceError("The clip is almost all silence. Send a clip where someone is talking.")
    return (loudness_normalize(a) if normalize else a), src_s


def wav_bytes(a):
    b = io.BytesIO()
    wavfile.write(b, SR, (np.clip(a, -1, 1) * 32767).astype(np.int16))
    return b.getvalue()


def wav_header(rate=SR):
    """44-byte header for a stream of unknown length: sizes are the 0xFFFFFFFF placeholder."""
    import struct
    return (b"RIFF" + struct.pack("<I", 0xFFFFFFFF) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
            + b"data" + struct.pack("<I", 0xFFFFFFFF))


def pcm16(a):
    return (np.clip(a, -1, 1) * 32767).astype("<i2").tobytes()


class Store:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        os.makedirs(self.root, exist_ok=True)

    def dir(self, vid):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", vid or ""):
            raise VoiceError("A voice id is 1 to 40 letters, digits, dashes or underscores.")
        return os.path.join(self.root, vid)

    def exists(self, vid):
        try:
            return os.path.isfile(os.path.join(self.dir(vid), "ref.wav"))
        except VoiceError:
            return False

    def save(self, vid, a24, text, src_s):
        d = self.dir(vid)
        os.makedirs(d, exist_ok=True)
        wavfile.write(os.path.join(d, "ref.wav"), SR, (np.clip(a24, -1, 1) * 32767).astype(np.int16))
        self.set_text(vid, text)
        json.dump({"source_seconds": round(src_s, 2), "seconds": round(len(a24) / SR, 2), "created": int(time.time())},
                  open(os.path.join(d, "meta.json"), "w"))

    def set_text(self, vid, text, style=None):
        p = os.path.join(self.dir(vid), "ref.txt" if style is None else f"styles/{style}.txt")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if text is not None:
            open(p, "w").write(text.strip() + "\n")

    def text(self, vid, style=None):
        p = os.path.join(self.dir(vid), "ref.txt" if style is None else f"styles/{style}.txt")
        return open(p).read().strip() if os.path.isfile(p) else None

    def audio(self, vid, style=None):
        p = os.path.join(self.dir(vid), "ref.wav" if style is None else f"styles/{style}.wav")
        if not os.path.isfile(p):
            return None
        sr, a = wavfile.read(p)
        return resample(a.astype(np.float32) / 32768.0, sr)

    def save_style(self, vid, style, a24, text):
        p = os.path.join(self.dir(vid), "styles")
        os.makedirs(p, exist_ok=True)
        wavfile.write(os.path.join(p, f"{style}.wav"), SR, (np.clip(a24, -1, 1) * 32767).astype(np.int16))
        self.set_text(vid, text, style)

    def styles(self, vid):
        p = os.path.join(self.dir(vid), "styles")
        return sorted(f[:-4] for f in os.listdir(p) if f.endswith(".wav")) if os.path.isdir(p) else []

    def prep_path(self, vid, model, style=None):
        return os.path.join(self.dir(vid), "prep", model, f"{style or 'plain'}.npz")

    def load_prep(self, vid, model, style=None):
        p = self.prep_path(vid, model, style)
        if not os.path.isfile(p):
            return None
        with np.load(p, allow_pickle=False) as z:
            return {k: z[k] for k in z.files}

    def save_prep(self, vid, model, arrs, style=None):
        p = self.prep_path(vid, model, style)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        np.savez(p, **arrs)

    def list(self):
        out = []
        for vid in sorted(os.listdir(self.root)):
            if not self.exists(vid):
                continue
            d = self.dir(vid)
            meta = json.load(open(os.path.join(d, "meta.json"))) if os.path.isfile(os.path.join(d, "meta.json")) else {}
            prep = {}
            pd = os.path.join(d, "prep")
            for m in (sorted(os.listdir(pd)) if os.path.isdir(pd) else []):
                prep[m] = sorted(f[:-4] for f in os.listdir(os.path.join(pd, m)) if f.endswith(".npz"))
            out.append({"id": vid, "source_clip_seconds": meta.get("source_seconds"), "seconds": meta.get("seconds"),
                        "has_transcript": self.text(vid) is not None, "prepared_for": prep, "styles": self.styles(vid)})
        return out
