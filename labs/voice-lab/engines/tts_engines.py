"""One adapter per voice model. Every adapter hides the model's own loading, cloning and
streaming calls behind the same four methods, so the server never branches on a model name:

    load() / unload()          weights in and out of memory (the server keeps ONE loaded at a time)
    prepare(wav24, text)       turn a 24 kHz mono reference clip into the model's cloned-voice form
    to_arrays / from_arrays    that form as plain numpy arrays, so it can be cached on disk
    stream(text, prep, temp)   yield float32 audio pieces at `self.rate`, as soon as each exists

Loading and streaming code is taken from the round 1 and round 2 bench (bench_clone.py).
"""
import copy
import gc
import re

import numpy as np

SR = 24000  # the server's output rate

# Canonical tag name -> accepted spellings. Anything not listed here is not a sound tag.
TAG_ALIASES = {
    "laugh": ("laugh", "laughs", "laughter", "laughing"),
    "sigh": ("sigh", "sighs"),
    "cough": ("cough", "coughs"),
    "gasp": ("gasp", "gasps"),
    "chuckle": ("chuckle", "chuckles"),
    "clear throat": ("clear throat", "clears throat"),
    "shush": ("shush",),
    "groan": ("groan", "groans"),
    "sniff": ("sniff", "sniffs"),
}
_ALIAS = {a: c for c, al in TAG_ALIASES.items() for a in al}
_TAG_RE = re.compile(r"\[\s*([A-Za-z ]{2,20}?)\s*\]")


def apply_tags(text, native):
    """Rewrite `[tag]` markers for one model. `native` maps canonical tag -> the model's own
    syntax. Supported tags are swapped in place; every other bracketed tag is removed. No
    other character of the text is touched (only the blank left behind by a removed tag)."""
    def sub(m):
        canon = _ALIAS.get(m.group(1).lower().strip())
        if canon is None:
            return m.group(0)  # not a sound tag: leave it, it may be ordinary text
        return native.get(canon, "\0")  # \0 marks a removed tag
    out = _TAG_RE.sub(sub, text)
    if "\0" in out:
        out = re.sub(r"[ \t]*\0[ \t]*", " ", out)
        out = re.sub(r" +([,.!?;:])", r"\1", out).strip()
    return out


def _free():
    import mlx.core as mx
    gc.collect()
    mx.clear_cache()


class Engine:
    key = ""
    repo = ""
    mem_gb = 0.0
    streams = True
    slow = False
    needs_text = False        # prepare() wants the reference transcript
    native_tags = {}          # canonical tag -> model syntax (only tags checked to work)
    native_styles = {}        # style -> (prefix inserted before the text)
    builtin_voice = True      # can speak with no reference clip
    min_ref_s = 3.0
    rate = SR
    note = ""

    def __init__(self):
        self.model = None

    def load(self):
        from mlx_audio.tts import load
        self.model = load(self.repo)
        self.rate = int(getattr(self.model, "sample_rate", SR) or SR)

    def unload(self):
        self.model = None
        _free()

    # reference clip -> prepared form
    def prepare(self, wav24, text):
        raise NotImplementedError

    def to_arrays(self, prep):
        raise NotImplementedError

    def from_arrays(self, arrs):
        raise NotImplementedError

    def builtin(self):
        return None

    def stream(self, text, prep, temperature=None):
        raise NotImplementedError

    @staticmethod
    def _f32(x):
        return np.asarray(x, dtype=np.float32).reshape(-1)


class ChatterboxTurbo(Engine):
    key = "chatterbox-turbo"
    repo = "mlx-community/chatterbox-turbo-fp16"
    mem_gb = 4.8
    min_ref_s = 5.1  # the model asserts a clip longer than 5 s
    # In the tokenizer and documented by the model maker; laugh and sigh were also heard to change audio in round 1.
    native_tags = {t: f"[{t}]" for t in ("laugh", "sigh", "cough", "gasp", "chuckle", "clear throat")}

    class _Sched:
        """Stands in for t3's `chunk_size` int. t3 tests `len(tokens) >= chunk_size`, which Python
        answers with our __le__. Token chunks start small (first sound fast) and grow, because the
        model re-decodes all tokens each chunk and small chunks everywhere would cost more."""
        def __init__(self, sizes):
            self.sizes, self.i = sizes, 0

        def __le__(self, n):
            if n >= self.sizes[min(self.i, len(self.sizes) - 1)]:
                self.i += 1
                return True
            return False

    def prepare(self, wav24, text):
        import tempfile
        from scipy.io import wavfile
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            wavfile.write(f.name, SR, (np.clip(wav24, -1, 1) * 32767).astype(np.int16))
            self.model.prepare_conditionals(f.name)
        return self.model._conds

    def to_arrays(self, c):
        out = {f"t3.{k}": np.array(v) for k, v in vars(c.t3).items() if v is not None}
        out.update({f"gen.{k}": np.array(v) for k, v in c.gen.items()})
        return out

    def from_arrays(self, arrs):
        import mlx.core as mx
        from mlx_audio.tts.models.chatterbox_turbo.chatterbox_turbo import Conditionals
        from mlx_audio.tts.models.chatterbox_turbo.models.t3.cond_enc import T3Cond
        t3 = T3Cond(**{k[3:]: mx.array(v) for k, v in arrs.items() if k.startswith("t3.")})
        gen = {k[4:]: mx.array(v) for k, v in arrs.items() if k.startswith("gen.")}
        return Conditionals(t3, gen)

    def builtin(self):
        return self.model._conds  # the voice that ships with the weights, set at load time

    def stream(self, text, prep, temperature=None):
        self.model._conds = prep
        kw = {} if temperature is None else {"temperature": temperature}
        for r in self.model.stream_generate(text, chunk_size=self._Sched([3, 6, 12, 25]), **kw):
            yield self._f32(r.audio)


class Pocket(Engine):
    key = "pocket"
    repo = "mlx-community/pocket-tts"
    mem_gb = 1.0
    min_ref_s = 3.0

    def prepare(self, wav24, text):
        import mlx.core as mx
        orig = getattr(self, "_orig", None) or self.model.get_state_for_audio_prompt
        self._orig = orig
        arr = mx.array(wav24)
        st = orig(arr)
        # state arrays are evaluated lazily; force them so the first request pays nothing
        fc = st["flow_cache"]
        mx.eval(*[getattr(c, n) for c in (fc.values() if isinstance(fc, dict) else fc)
                  for n in ("keys", "values") if getattr(c, n, None) is not None])
        return (arr, st)

    def to_arrays(self, prep):  # the cached form is the audio; the 20 to 80 ms state build reruns at load
        return {"wav": np.array(prep[0])}

    def from_arrays(self, arrs):
        return self.prepare(arrs["wav"], None)

    def builtin(self):
        return None

    def stream(self, text, prep, temperature=None):
        kw = {} if temperature is None else {"temperature": temperature}
        if prep is None:
            gen = self.model.generate(text, stream=True, streaming_interval=0.12, **kw)
        else:
            arr, st = prep
            # generate() rebuilds the voice state on every call; hand it our deep copy instead
            self.model.get_state_for_audio_prompt = lambda *_a, **_k: copy.deepcopy(st)
            gen = self.model.generate(text, ref_audio=arr, stream=True, streaming_interval=0.12, **kw)
        for r in gen:
            yield self._f32(r.audio)


class Qwen3Base(Engine):
    key = "qwen3-base-1.7b"
    repo = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit"
    mem_gb = 3.6
    needs_text = True
    builtin_voice = False

    def prepare(self, wav24, text):
        import mlx.core as mx
        arr = mx.array(wav24)
        r = self.model._prepare_icl_generation_inputs(text="Hello there.", ref_audio=arr, ref_text=text,
                                                      language="english")
        mx.eval(r[0])  # fills the model's own reference cache, keyed by clip and transcript
        return (arr, text)

    def to_arrays(self, prep):
        return {"wav": np.array(prep[0]), "text": np.array(prep[1])}

    def from_arrays(self, arrs):
        return self.prepare(arrs["wav"], str(arrs["text"]))

    def stream(self, text, prep, temperature=None):
        arr, ref_text = prep
        kw = {} if temperature is None else {"temperature": temperature}
        for r in self.model.generate(text, ref_audio=arr, ref_text=ref_text, lang_code="english",
                                     stream=True, streaming_interval=0.2, **kw):
            yield self._f32(r.audio)


class Zonos3Mini(Engine):
    key = "zonos3-mini"
    repo = "mlx-community/ZONOS3-Mini"
    mem_gb = 1.6
    rate = 44100

    def prepare(self, wav24, text):
        import tempfile
        from scipy.io import wavfile
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            wavfile.write(f.name, SR, (np.clip(wav24, -1, 1) * 32767).astype(np.int16))
            return self.model.extract_speaker_embedding(f.name)

    def to_arrays(self, prep):
        return {"emb": np.array(prep)}

    def from_arrays(self, arrs):
        import mlx.core as mx
        return mx.array(arrs["emb"])

    def builtin(self):
        return "jett"

    def stream(self, text, prep, temperature=None):
        kw = {} if temperature is None else {"temperature": temperature}
        if isinstance(prep, str):
            kw["voice"] = prep
        else:
            kw["speaker_embedding"] = prep
        for r in self.model.generate(text, stream=True, streaming_interval=0.2, **kw):
            yield self._f32(r.audio)


class HiggsV3(Engine):
    key = "higgs-v3"
    repo = "whitelabel/mlx-q6-higgs-tts-3-4b"
    mem_gb = 5.6
    streams = False  # one chunk at the end of generation
    slow = True
    needs_text = True
    builtin_voice = False
    # The sound tokens come with the words the model's README asks for (round 1 notes).
    native_tags = {"laugh": "<|emotion:amusement|><|sfx:laughter|>Ha ha.", "sigh": "<|sfx:sigh|>Hhh."}
    native_styles = {
        "whisper": "<|style:whispering|>",
        "shout": "<|style:shouting|>",
        "angry": "<|emotion:anger|>",
        "excited": "<|emotion:elation|><|prosody:expressive_high|>",
    }

    def prepare(self, wav24, text):
        import mlx.core as mx
        if self.rate != SR:
            from math import gcd
            from scipy.signal import resample_poly
            g = gcd(self.rate, SR)
            wav24 = resample_poly(wav24, self.rate // g, SR // g).astype(np.float32)
        codes = self.model.encode_reference_audio(wav24)
        mx.eval(codes)
        return (codes, text)

    def to_arrays(self, prep):
        return {"codes": np.array(prep[0]), "text": np.array(prep[1])}

    def from_arrays(self, arrs):
        import mlx.core as mx
        return (mx.array(arrs["codes"]), str(arrs["text"]))

    def stream(self, text, prep, temperature=None, max_new_tokens=1024):
        codes, ref_text = prep
        kw = {} if temperature is None else {"temperature": temperature}
        for r in self.model.generate(text, ref_audio_codes=codes, ref_text=ref_text, stream=True,
                                     max_new_tokens=max_new_tokens, **kw):
            yield self._f32(r.audio)


ENGINES = {c.key: c for c in (ChatterboxTurbo, Pocket, Qwen3Base, Zonos3Mini, HiggsV3)}
DEFAULT_MODEL = "chatterbox-turbo"
