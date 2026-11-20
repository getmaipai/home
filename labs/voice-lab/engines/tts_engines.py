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
import os
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
    native_instruct = {}      # style -> delivery instruction (opts["instruct"]), for models that take one
    builtin_voice = True      # can speak with no reference clip
    min_ref_s = 3.0
    rate = SR
    note = ""
    takes_opts = False        # stream() accepts opts={"seed": int, "context": [...]}
    takes_context = False     # opts["context"] is used (earlier chat turns)
    guard = False             # the server's runaway guard applies (see speech_guard.py)

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


class VoxCPM2(Engine):
    """VoxCPM2 (2B, bf16). Native 48 kHz, the server resamples to 24 kHz. The voice is the reference
    clip, cached as its two latent encodings plus the transcript. Streams through voxcpm_stream."""
    key = "voxcpm2"
    repo = os.environ.get("LAB_VOX_REPO", "mlx-community/VoxCPM2-bf16")   # LAB_VOX_REPO=mlx-community/VoxCPM2-4bit for the reduced voice
    mem_gb = 6.5
    needs_text = True
    builtin_voice = False
    takes_opts = True
    guard = True
    min_ref_s = 3.0
    # Defaults picked by the word-accuracy experiments (data-scratch/voices/server_bench2.md).
    cfg = dict(mode="cont", cfg_value=2.0, timesteps=int(os.environ.get("LAB_VOX_STEPS", "6")), noise=1.0, schedule=(1, 2, 4), sep=" ")
    # 300 ms of silence after the reference clip and a space between its transcript and the new text: the model then starts
    # a fresh sentence instead of a hesitation ("um") that the casual reference voice teaches it. 39 of 40 exact, against 16 of 40.
    prep_tail_s = 0.3

    def prepare(self, wav24, text):
        import tempfile
        from scipy.io import wavfile
        from voxcpm_stream import encode_reference
        if self.prep_tail_s:
            wav24 = np.concatenate([wav24, np.zeros(int(self.prep_tail_s * SR), np.float32)])
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            wavfile.write(f.name, SR, (np.clip(wav24, -1, 1) * 32767).astype(np.int16))
            prompt, ref = encode_reference(self.model, f.name)
        return {"prompt_feat": prompt, "ref_feat": ref, "text": text}

    def to_arrays(self, prep):
        import mlx.core as mx
        return {"prompt_feat": np.array(prep["prompt_feat"].astype(mx.float32)),
                "ref_feat": np.array(prep["ref_feat"].astype(mx.float32)), "text": np.array(prep["text"])}

    def from_arrays(self, arrs):
        import mlx.core as mx
        return {"prompt_feat": mx.array(arrs["prompt_feat"]), "ref_feat": mx.array(arrs["ref_feat"]),
                "text": str(arrs["text"])}

    def stream(self, text, prep, temperature=None, opts=None):
        from voxcpm_stream import stream_patches
        c = dict(self.cfg)
        if temperature is not None:
            c["noise"] = temperature
        opts = opts or {}
        yield from stream_patches(self.model, text, prep, seed=opts.get("seed"), **c)


class CSM1B(Engine):
    """Sesame CSM-1B (fp16), 24 kHz. The voice is the reference clip as Mimi codes plus its
    transcript; the clip and its words lead the text (the model's voice-match mode), so the model
    carries on in that voice. Optional earlier chat turns go in front as text-only context."""
    key = "csm-1b"
    repo = "mlx-community/csm-1b-fp16"
    mem_gb = 4.7
    needs_text = True
    builtin_voice = False
    takes_opts = True
    takes_context = True
    guard = True
    min_ref_s = 3.0
    cfg = dict(temperature=0.9, top_k=50, schedule=(2, 3, 4), context_chars=300, voice_match=False, sep=" ")
    # voice_match=False: the clip is an earlier finished utterance and the new text is the next one. The package default
    # (True) merges the clip words with the new text and dropped or changed the first words in 16 of 40 lines (24 of 40 exact);
    # False was 40 of 40 exact and closer to the voice (similarity 0.59 against 0.49).
    prep_tail_s = 0.0   # silence added after the reference clip before it is encoded
    USER_SPEAKER, VOICE_SPEAKER = 1, 0

    def prepare(self, wav24, text):
        import mlx.core as mx
        if self.prep_tail_s:
            wav24 = np.concatenate([wav24, np.zeros(int(self.prep_tail_s * SR), np.float32)])
        frames, _ = self.model._tokenize_audio(mx.array(wav24), add_eos=False)  # (n, 33): 32 codebooks + a text slot
        mx.eval(frames)
        return {"tokens": frames, "text": text}

    def to_arrays(self, prep):
        return {"tokens": np.array(prep["tokens"]), "text": np.array(prep["text"])}

    def from_arrays(self, arrs):
        import mlx.core as mx
        return {"tokens": mx.array(arrs["tokens"]), "text": str(arrs["text"])}

    def stream(self, text, prep, temperature=None, opts=None):
        import time
        import mlx.core as mx
        from mlx_audio.lm.sample_utils import make_sampler
        m, c, opts = self.model, self.cfg, opts or {}
        if opts.get("seed") is not None:
            mx.random.seed(opts["seed"])
        # prompt: earlier turns (text only), then the reference words + the new text, then the reference audio
        toks, masks = [], []
        for turn in opts.get("context") or []:
            t, mk = m._tokenize_text_segment(turn["text"][:c["context_chars"]],
                                             self.USER_SPEAKER if turn["speaker"] == "user" else self.VOICE_SPEAKER)
            toks.append(t), masks.append(mk)
        frame = prep["tokens"].astype(mx.int32)
        fmask = mx.zeros(frame.shape).astype(mx.bool_)
        fmask[:, :-1] = True
        if c["voice_match"]:
            # the reference words and the new text come first, then the reference audio: the model carries on from it
            t, mk = m._tokenize_text_segment((prep["text"] + c["sep"] + text).strip(), self.VOICE_SPEAKER)
            toks.append(t), masks.append(mk)
            toks.append(frame), masks.append(fmask)
        else:
            # a finished earlier utterance (words, audio, end frame), then the new text as the next utterance
            t, mk = m._tokenize_text_segment(prep["text"], self.VOICE_SPEAKER)
            toks.append(t), masks.append(mk)
            toks.append(frame), masks.append(fmask)
            toks.append(mx.zeros((1, m._frame_size)).astype(mx.int32)), masks.append(fmask[:1])  # end-of-utterance frame
            t, mk = m._tokenize_text_segment(text, self.VOICE_SPEAKER)
            toks.append(t), masks.append(mk)
        curr = mx.expand_dims(mx.concat(toks, axis=0).astype(mx.int32), axis=0)
        curr_mask = mx.expand_dims(mx.concat(masks, axis=0).astype(mx.bool_), axis=0)
        pos = mx.expand_dims(mx.arange(0, curr.shape[1]), axis=0).astype(mx.int32)
        from speech_guard import estimate_seconds
        max_frames = int(12.5 * (estimate_seconds(text) * 4 + 2))
        if curr.shape[1] + max_frames >= 2048:
            raise ValueError("The text and the context are too long for this model. Send a shorter piece.")
        sampler = make_sampler(temp=temperature if temperature is not None else c["temperature"], top_k=c["top_k"])
        m.model.reset_caches()
        m._streaming_decoder.reset()
        samples, n, start, sched_i = [], 0, time.perf_counter(), 0
        want = c["schedule"][0]
        try:
            for _ in range(max_frames):
                sample = m.model.generate_frame(curr, curr_mask, pos, sampler)
                if mx.all(sample == 0):
                    break
                samples.append(sample)
                curr = mx.expand_dims(mx.concat([sample, mx.zeros((1, 1)).astype(mx.int32)], axis=1), axis=1)
                curr_mask = mx.expand_dims(mx.concat([mx.ones_like(sample).astype(mx.bool_),
                                                      mx.zeros((1, 1)).astype(mx.bool_)], axis=1), axis=1)
                pos = pos[:, -1:] + 1
                if len(samples) >= want:
                    yield self._f32(m.generate_result(samples, start, stream=True).audio)
                    samples, sched_i = [], sched_i + 1
                    want = c["schedule"][min(sched_i, len(c["schedule"]) - 1)]
            if samples:
                yield self._f32(m.generate_result(samples, start, stream=True, is_final_chunk=True).audio)
        finally:
            mx.clear_cache()


class Breeze2(Engine):
    """Breeze TTS 2, 24 kHz. The voice is the reference clip's codec frames plus its transcript, cached as
    the finished prompt embeddings. `instruct` (a delivery instruction) is the one style control; the server
    maps `style` to it. The package streams in fixed pieces, so this repeats its loop with small first pieces."""
    key = "breeze-tts-2"
    repo = "mlx-community/Breeze-TTS-2-mlx"          # bf16; the 4-bit build is mlx-community/Breeze-TTS-2-mlx-4bit
    mem_gb = 8.6
    needs_text = True
    builtin_voice = False
    takes_opts = True
    guard = True
    min_ref_s = 3.0
    native_instruct = {
        "whisper": "Whisper softly, very quietly.",
        "shout": "Shout loudly and urgently.",
        "angry": "Speak in an angry tone.",
        "excited": "Speak in a very excited, happy tone.",
        "sad": "Speak in a sad, subdued tone.",
    }
    cfg = dict(temperature=0.9, top_p=1.0, top_k=50, cfg_scale=None, schedule=(2, 3, 4), speaker="S0")

    def prepare(self, wav24, text):
        import mlx.core as mx
        m = self.model
        sp = m._speaker(self.cfg["speaker"])
        t = m.text_encoder_proj(m.text_encoder(m._text_ids(f"{sp}{text}")[None, :]))
        a = m.backbone_model.embed_tokens(m._encode_reference(mx.array(wav24)))
        eos = m.backbone_model.embed_tokens(mx.full((1, 1, m.num_codebooks), m.config.codebook_eos_token_id))
        prefix = mx.concatenate([t, a, eos], axis=1)
        mx.eval(prefix)
        return {"prefix": prefix, "text": text}

    def to_arrays(self, prep):
        import mlx.core as mx
        return {"prefix": np.array(prep["prefix"].astype(mx.float32)), "text": np.array(prep["text"])}

    def from_arrays(self, arrs):
        import mlx.core as mx
        return {"prefix": mx.array(arrs["prefix"]).astype(mx.bfloat16), "text": str(arrs["text"])}

    def _target(self, text, instruct):
        sp = self.model._speaker(self.cfg["speaker"])
        t = f"{sp}<ins_bos>{instruct}<ins_eos>{text}" if instruct else f"{sp}{text}"
        m = self.model
        return m.text_encoder_proj(m.text_encoder(m._text_ids(t)[None, :]))

    def stream(self, text, prep, temperature=None, opts=None):
        import mlx.core as mx
        m, c, opts = self.model, self.cfg, opts or {}
        if opts.get("seed") is not None:
            mx.random.seed(opts["seed"])
        instruct = opts.get("instruct")
        temp = temperature if temperature is not None else c["temperature"]
        cfg_scale = c["cfg_scale"]
        use_cfg = bool(instruct) and cfg_scale not in (None, 1.0)
        pre = prep["prefix"]
        cond = mx.concatenate([pre, self._target(text, instruct).astype(pre.dtype)], axis=1)
        cache = m.backbone_model.make_cache()
        hidden = m.backbone_model(input_embeddings=cond, cache=cache)[:, -1, :]
        if use_cfg:
            ucond = mx.concatenate([pre, self._target(text, None).astype(pre.dtype)], axis=1)
            ucache = m.backbone_model.make_cache()
            uhidden = m.backbone_model(input_embeddings=ucond, cache=ucache)[:, -1, :]
        from speech_guard import estimate_seconds
        max_frames = int(12.5 * (estimate_seconds(text) * 4 + 2))
        dec = m.audio_tokenizer.decoder
        dec.reset_streaming_state()
        pending, sched_i = [], 0
        want = c["schedule"][0]

        def decode(frames):
            codes = mx.array(frames, dtype=mx.int32)[None, :, :]
            return self._f32(m._audio_vector(dec.streaming_step(mx.transpose(codes, (0, 2, 1)))))
        try:
            for _ in range(max_frames):
                logits = m.lm_head(hidden)
                if use_cfg:
                    ul = m.lm_head(uhidden)
                    logits = ul + cfg_scale * (logits - ul)
                logits = m._mask_reserved_codec_logits(logits)
                first = m._sample(logits, temperature=temp, top_p=c["top_p"], top_k=c["top_k"], allow_eos=True)
                if first == m.vocab_size:
                    break
                frame = m._depth_tokens(first, hidden, unconditional_hidden=uhidden if use_cfg else None,
                                        cfg_scale=1.0 if cfg_scale is None else cfg_scale, temperature=temp,
                                        top_p=c["top_p"], top_k=c["top_k"])
                pending.append(frame)
                if len(pending) >= want:
                    yield decode(pending)
                    pending, sched_i = [], sched_i + 1
                    want = c["schedule"][min(sched_i, len(c["schedule"]) - 1)]
                codes = mx.array(frame, dtype=mx.int32)[None, None, :]
                hidden = m.backbone_model(input_ids=codes, cache=cache)[:, -1, :]
                if use_cfg:
                    uhidden = m.backbone_model(input_ids=codes, cache=ucache)[:, -1, :]
            if pending:
                yield decode(pending)
        finally:
            dec.reset_streaming_state()
            mx.clear_cache()


ENGINES = {c.key: c for c in (ChatterboxTurbo, Pocket, Qwen3Base, Zonos3Mini, HiggsV3, VoxCPM2, CSM1B, Breeze2)}
DEFAULT_MODEL = "chatterbox-turbo"
