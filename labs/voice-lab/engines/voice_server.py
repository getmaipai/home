"""Small local voice server: HTTP on 127.0.0.1, one voice model in memory, one synthesis at a time.

    python voice_server.py --model chatterbox-turbo --port 9923 --store <folder>

One worker thread owns every MLX call (loading, cloning, synthesis); HTTP threads only parse
requests and feed audio back, so requests queue instead of fighting over the GPU.
Endpoints are listed in README.md.
"""
import argparse
import email.parser
import email.policy
import json
import os
import queue
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import style_refs
import speech_guard
import voice_store as vs
from tts_engines import DEFAULT_MODEL, ENGINES, SR, apply_tags

HERE = os.path.dirname(os.path.abspath(__file__))
STYLES = ("neutral", "whisper", "shout", "angry", "excited", "sad")   # "sad" only where a model has an instruction for it
STT_REPO = "mlx-community/parakeet-tdt-0.6b-v2"  # the recognizer wordcheck.py uses
SIL = 10 ** (-45 / 20)  # replies: below this absolute level counts as silence


class Busy(Exception):
    pass


class NotFound(Exception):
    pass


def log(*a):
    print(*a, flush=True)


def speech_span(x, frame=120):
    """(first, last) sample of the frames whose RMS is above the silence level, or None. Frames
    (5 ms), not single samples, so a stray click in the silence does not count as speech."""
    n = len(x) // frame
    if n == 0:
        return None
    rms = np.sqrt((x[:n * frame].reshape(n, frame) ** 2).mean(1))
    idx = np.where(rms > SIL)[0]
    if not len(idx):
        return None
    return idx[0] * frame, min(len(x), (idx[-1] + 1) * frame)


class Shaper:
    """Cuts the dead air a model adds: leading silence goes, trailing silence is capped at 80 ms.
    Silence inside the speech is kept (it is the pause between phrases). Trailing silence of a
    piece is held back until the next piece shows whether speech follows."""
    FIRST_MIN = int(0.08 * SR)

    def __init__(self):
        self.started = False
        self.buf = np.zeros(0, np.float32)
        self.pending = np.zeros(0, np.float32)

    def feed(self, x):
        if not self.started:
            self.buf = np.concatenate([self.buf, x])
            sp = speech_span(self.buf)
            if sp is None:
                return None
            body = self.buf[max(0, sp[0] - int(0.01 * SR)):]
            if sp[1] - sp[0] < self.FIRST_MIN:
                return None  # a few ms of sound: wait for the next piece rather than emit a click
            self.started, x = True, body
        sp = speech_span(x)
        if sp is None:
            self.pending = np.concatenate([self.pending, x])
            return None
        out = np.concatenate([self.pending, x[:sp[1]]])
        self.pending = x[sp[1]:]
        return out

    def finish(self):
        return self.pending[:int(0.08 * SR)] if self.started else None


class Job:
    def __init__(self, fn, kind):
        self.fn, self.kind = fn, kind
        self.out = queue.Queue()
        self.cancel = threading.Event()
        self.runaway = False       # the runaway guard stopped this piece of speech
        self.text_edited = False   # the text given to the model differs from the request (sound tags only)


class Core:
    def __init__(self, store, model):
        self.store = vs.Store(store)
        self.want = model
        self.engine = None
        self.q = queue.Queue()
        self.task = "starting"      # None when idle
        self.maintenance = False    # true while a long job (style references) makes /tts unavailable
        self.preps = {}             # (voice, style) -> prepared form, for the loaded model only
        self.reply_tails = {}       # reply id -> (audio, text) of its latest phrase, for the continuation experiment
        threading.Thread(target=self._worker, daemon=True).start()

    # ---- worker -----------------------------------------------------------------------------
    def submit(self, fn, kind):
        job = Job(fn, kind)
        self.q.put(job)
        return job

    def _worker(self):
        self._switch(self.want)
        self.task = None
        while True:
            job = self.q.get()
            if job.cancel.is_set():
                job.out.put(("end", None))
                continue
            try:
                job.fn(job)
            except Exception as e:
                import traceback
                traceback.print_exc()
                job.out.put(("error", e))
            job.out.put(("end", None))

    def _switch(self, key, warm=True):
        """Unload what is loaded, free it fully, load `key`, warm it with one short phrase."""
        self.task = f"loading {key}"
        t0 = time.time()
        if self.engine is not None:
            self.engine.unload()
            self.engine = None
        self.preps = {}
        eng = ENGINES[key]()
        eng.load()
        t1 = time.time()
        self.engine = eng
        self.model_key = key
        if warm:
            try:
                n = sum(len(x) for x in eng.stream("Hello there.", self._prep(None, None)))
            except Exception as e:
                log(f"warm-up failed for {key}: {type(e).__name__}: {e}")
        log(f"model {key} loaded in {t1 - t0:.1f}s, warm-up {time.time() - t1:.1f}s")
        return {"model": key, "load_s": round(t1 - t0, 2), "warm_s": round(time.time() - t1, 2)}

    # ---- voices -----------------------------------------------------------------------------
    def default_voice(self):
        if self.engine and self.engine.builtin_voice:
            return "builtin"
        ids = [v["id"] for v in self.store.list()]
        return ids[0] if ids else None

    def _transcribe(self, vid, style=None):
        """The voice has no transcript and the model wants one: recognize it, then free the recognizer."""
        import gc
        import mlx.core as mx
        from mlx_audio.stt import load
        p = os.path.join(self.store.dir(vid), "ref.wav" if style is None else f"styles/{style}.wav")
        stt = load(STT_REPO)
        try:
            text = stt.generate(p).text.strip()
        finally:
            del stt
            gc.collect()
            mx.clear_cache()
        self.store.set_text(vid, text, style)
        log(f"transcribed {vid}{'/' + style if style else ''}: {len(text.split())} words")
        return text

    def _prep(self, vid, style):
        """Prepared voice for the loaded model, from memory, then disk, then the clip (and cached)."""
        eng = self.engine
        if vid is None or vid == "builtin":
            if eng.builtin_voice:
                return eng.builtin()
            vid = self.default_voice()
            if vid is None:
                raise vs.VoiceError(f"{eng.key} has no built-in voice. Upload a voice first with POST /voices.")
        if not self.store.exists(vid):
            raise NotFound(f"No voice named '{vid}'. List them with GET /voices or add one with POST /voices.")
        key = (vid, style)
        if key in self.preps:
            return self.preps[key]
        arrs = self.store.load_prep(vid, eng.key, style)
        if arrs is not None:
            prep = eng.from_arrays(arrs)
        else:
            a = self.store.audio(vid, style)
            if len(a) / SR < eng.min_ref_s:
                raise vs.VoiceError(f"{eng.key} needs a reference clip of at least {eng.min_ref_s:.0f} seconds; this one is {len(a) / SR:.1f}.")
            text = self.store.text(vid, style)
            if eng.needs_text and not text:
                text = self._transcribe(vid, style)
            t0 = time.time()
            prep = eng.prepare(a, text)
            self.store.save_prep(vid, eng.key, eng.to_arrays(prep), style)
            log(f"prepared {vid}{'/' + style if style else ''} for {eng.key} in {time.time() - t0:.2f}s")
        self.preps[key] = prep
        return prep

    # ---- jobs (each runs on the worker) -----------------------------------------------------
    def job_model(self, key):
        def run(job):
            self.maintenance = False
            try:
                job.out.put(("result", self._switch(key)))
            finally:
                self.task = None   # _switch reports "loading <model>"; without this /health stayed "loading" after a switch
        return self.submit(run, "model")

    def job_voice(self, vid, a24, text, src_s):
        def run(job):
            self.store.save(vid, a24, text, src_s)
            for old in (self.preps,):  # a re-upload under the same id replaces the old preparation
                for k in [k for k in old if k[0] == vid]:
                    del old[k]
            import shutil
            shutil.rmtree(os.path.join(self.store.dir(vid), "prep"), ignore_errors=True)
            t0 = time.time()
            try:
                self._prep(vid, None)
                msg = "ok"
            except Exception as e:
                msg = f"not prepared for {self.engine.key}: {e}"
            job.out.put(("result", {"id": vid, "seconds": round(len(a24) / SR, 2), "model": self.engine.key,
                                    "prepared": msg, "prep_s": round(time.time() - t0, 2),
                                    "transcript": self.store.text(vid)}))
        return self.submit(run, "voice")

    def job_styles(self, vid, styles):
        """Needs higgs-v3, so it swaps the loaded model out, then puts the previous one back."""
        def run(job):
            prev = self.engine.key
            self.maintenance = True
            try:
                self._switch("higgs-v3", warm=False)
                self.task = f"building styled references for {vid}"
                made = style_refs.make_style_refs(self.engine, self.store, vid, styles, log)
                job.out.put(("result", {"id": vid, "styles": made}))
            finally:
                self._switch(prev)
                self.maintenance = False
                self.task = None
        return self.submit(run, "styles")

    def job_tts(self, text, vid, style, temperature, opts=None):
        def run(job):
            eng = self.engine
            style_ref = None
            prefix = ""
            if style != "neutral":
                if vid not in (None, "builtin") and style in self.store.styles(vid):
                    style_ref = style  # clone from the styled clip of this voice
                elif style in eng.native_styles:
                    prefix = eng.native_styles[style]
            run_opts = dict(opts or {})
            if style != "neutral" and style in eng.native_instruct and style_ref is None:
                run_opts["instruct"] = eng.native_instruct[style]
            prep = self._prep(vid, style_ref)
            reply_id = run_opts.get("reply") if run_opts.get("cont") and hasattr(eng, "prepare_cont") else None
            if reply_id:
                prev = self.reply_tails.get(reply_id)
                if prev is not None and len(prev[0]) / SR <= 5.0:
                    try:
                        prep = eng.prepare_cont(prep, prev[0], prev[1])
                    except Exception as e:  # never fail the phrase over the experiment: fall back to the plain voice
                        log(f"cont prepare failed: {e}")
            txt = apply_tags(text, eng.native_tags)
            if not txt.strip():
                raise vs.VoiceError("The text is empty once the unsupported sound tags are removed.")
            # The words are never edited here: only sound tags are rewritten or removed (apply_tags).
            job.text_edited = txt != text
            if eng.takes_opts:
                gen = eng.stream(prefix + txt, prep, temperature, run_opts)
            else:
                gen = eng.stream(prefix + txt, prep, temperature)
            from voice_store import Resampler, pcm16
            rs, sh = Resampler(eng.rate), Shaper()
            kept = []
            # runaway guard: more audio than 2.2 times the text's length estimate ends the piece
            room = int(speech_guard.runaway_limit_seconds(txt) * SR) if eng.guard else None
            try:
                for piece in gen:
                    if job.cancel.is_set():
                        return
                    if not len(piece):
                        continue
                    audio = rs(piece)
                    if room is not None:
                        if len(audio) > room:
                            audio, job.runaway = audio[:max(room, 0)], True
                        room -= len(audio)
                    out = sh.feed(audio)
                    if out is not None and len(out):
                        if reply_id:
                            kept.append(out)
                        job.out.put(("audio", pcm16(out)))
                    if job.runaway:
                        break
                tail = sh.finish()
                if tail is not None and len(tail):
                    job.out.put(("audio", pcm16(tail)))
                if reply_id and kept:
                    self.reply_tails[reply_id] = (np.concatenate(kept).astype(np.float32), txt)
                    while len(self.reply_tails) > 16:
                        self.reply_tails.pop(next(iter(self.reply_tails)))
            finally:
                gen.close()
        self.task = self.task  # tts does not change the reported status
        return self.submit(run, "tts")


# ---- HTTP ---------------------------------------------------------------------------------
def parse_body(handler):
    n = int(handler.headers.get("Content-Length") or 0)
    if n > 60_000_000:
        raise vs.VoiceError("The upload is larger than 60 MB.")
    body = handler.rfile.read(n) if n else b""
    ct = handler.headers.get("Content-Type", "")
    fields, files = {}, {}
    if ct.startswith("application/json"):
        d = json.loads(body or b"{}")
        if not isinstance(d, dict):
            raise vs.VoiceError("The JSON body must be an object.")
        return d, files
    if ct.startswith("multipart/form-data"):
        msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
            b"Content-Type: " + ct.encode() + b"\r\nMIME-Version: 1.0\r\n\r\n" + body)
        for part in msg.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if part.get_filename() is not None or part.get_content_type() == "audio/wav":
                files[name] = part.get_payload(decode=True)
            else:
                fields[name] = part.get_payload(decode=True).decode("utf-8", "replace")
        return fields, files
    from urllib.parse import parse_qs
    return {k: v[0] for k, v in parse_qs(body.decode("utf-8", "replace")).items()}, files


def parse_context(raw):
    """The optional `context` field: a JSON list (or JSON text of one) of up to 3 earlier chat turns,
    each {"speaker": "user"|"assistant", "text": "..."}. Returns the cleaned list. Models that cannot
    use context ignore it."""
    if raw in (None, "", []):
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raise vs.VoiceError("The 'context' field must be JSON: a list of {\"speaker\": \"user\" or \"assistant\", \"text\": \"...\"}.")
    if not isinstance(raw, list) or len(raw) > 3:
        raise vs.VoiceError("The 'context' field takes a list of at most 3 earlier turns. Send the last three.")
    out = []
    for t in raw:
        if not isinstance(t, dict) or t.get("speaker") not in ("user", "assistant") or not isinstance(t.get("text"), str):
            raise vs.VoiceError("Each context turn is {\"speaker\": \"user\" or \"assistant\", \"text\": \"...\"}.")
        if t["text"].strip():
            out.append({"speaker": t["speaker"], "text": t["text"].strip()})
    return out


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    core = None

    def log_message(self, *a):
        pass

    def send_json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def fail(self, e):
        if isinstance(e, NotFound):
            return self.send_json(404, {"error": str(e)})
        if isinstance(e, Busy):
            return self.send_json(503, {"error": str(e)})
        if isinstance(e, (vs.VoiceError, KeyError, ValueError, json.JSONDecodeError)):
            return self.send_json(400, {"error": str(e)})
        log(f"error {type(e).__name__}: {e}")
        return self.send_json(500, {"error": f"The server failed: {type(e).__name__}: {e}. Check the server log."})

    def wait_result(self, job):
        while True:
            kind, v = job.out.get()
            if kind == "result":
                res = v
            elif kind == "error":
                raise v
            elif kind == "end":
                return res

    # GET
    def do_GET(self):
        c = self.core
        try:
            if self.path == "/health":
                st = "ok" if c.task is None else "loading"
                return self.send_json(200, {"status": st, "model": c.engine.key if c.engine else None,
                                            "voice": c.default_voice(), "task": c.task})
            if self.path == "/models":
                return self.send_json(200, models_info(c))
            if self.path == "/voices":
                return self.send_json(200, {"voices": c.store.list()})
            self.send_json(404, {"error": "Unknown path. See README.md for the endpoints."})
        except Exception as e:
            self.fail(e)

    # POST
    def do_POST(self):
        t0 = time.time()
        c = self.core
        try:
            path = self.path.split("?")[0]
            fields, files = parse_body(self)
            if path == "/model":
                key = fields.get("model")
                if key not in ENGINES:
                    raise vs.VoiceError(f"Unknown model '{key}'. Choose one of: {', '.join(ENGINES)}.")
                return self.send_json(200, self.wait_result(c.job_model(key)))
            if path == "/voices":
                if "file" not in files:
                    raise vs.VoiceError("Send the WAV clip as a multipart field named 'file'.")
                a24, src_s = vs.clean_reference(files["file"])
                vid = (fields.get("id") or f"voice-{int(time.time())}").strip()
                c.store.dir(vid)
                return self.send_json(201, self.wait_result(c.job_voice(vid, a24, fields.get("text"), src_s)))
            m = re.fullmatch(r"/voices/([A-Za-z0-9_-]+)/styles", path)
            if m:
                vid = m.group(1)
                if not c.store.exists(vid):
                    raise NotFound(f"No voice named '{vid}'.")
                if c.maintenance:
                    raise Busy("The server is busy building styled references. Try again in a minute.")
                want = fields.get("styles") or list(style_refs.STYLES)
                if isinstance(want, str):
                    want = [want]
                bad = [s for s in want if s not in style_refs.STYLE_TEXT]
                if bad:
                    raise vs.VoiceError(f"Unknown style {bad}. Styles are: {', '.join(style_refs.STYLE_TEXT)}.")
                c.job_styles(vid, want)
                return self.send_json(202, {"status": "building", "voice": vid, "styles": want,
                                            "note": "higgs-v3 is loading in place of the current model; "
                                                    "the current model comes back when this ends. Watch GET /health."})
            if path == "/tts":
                return self.tts(fields, t0)
            self.send_json(404, {"error": "Unknown path. See README.md for the endpoints."})
        except Exception as e:
            self.fail(e)

    def tts(self, f, t0):
        c = self.core
        text = (f.get("text") or "").strip()
        if not text:
            raise vs.VoiceError("The 'text' field is required.")
        style = (f.get("style") or "neutral").strip().lower()
        if style not in STYLES:
            raise vs.VoiceError(f"Unknown style '{style}'. Styles are: {', '.join(STYLES)}.")
        temp = float(f["temperature"]) if f.get("temperature") not in (None, "") else None
        opts = {"context": parse_context(f.get("context"))}
        if f.get("seed") not in (None, ""):
            opts["seed"] = int(f["seed"])
        if f.get("reply") not in (None, ""):
            opts["reply"] = str(f["reply"])[:64]
        if str(f.get("cont") or "") == "1":
            opts["cont"] = True
        vid = f.get("voice") or None
        if c.maintenance:
            raise Busy("The server is busy building styled references. Try again in a minute.")
        model = c.engine.key if c.engine else "?"
        job = c.job_tts(text, vid, style, temp, opts)
        sent = 0
        ttfa = None
        started = False
        try:
            while True:
                kind, v = job.out.get()
                if kind == "audio":
                    if not started:
                        self.send_response(200)
                        self.send_header("Content-Type", "audio/wav")
                        self.send_header("Transfer-Encoding", "chunked")
                        self.send_header("Cache-Control", "no-store")
                        self.end_headers()
                        self.chunk(vs.wav_header(SR))
                        started = True
                        self.connection.setsockopt(__import__("socket").IPPROTO_TCP, __import__("socket").TCP_NODELAY, 1)
                    self.chunk(v)
                    if ttfa is None:
                        ttfa = (time.time() - t0) * 1000
                    sent += len(v)
                elif kind == "error":
                    if started:
                        self.close_connection = True
                        break
                    return self.fail(v)
                elif kind == "end":
                    break
            if started:
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            else:
                return self.fail(RuntimeError("The model returned no audio. Try different text."))
        except (BrokenPipeError, ConnectionResetError):
            job.cancel.set()  # the listener left: stop generating
            self.close_connection = True
        finally:
            total = (time.time() - t0) * 1000
            log(f"tts model={model} voice={vid or 'default'} style={style} chars={len(text)} "
                f"ttfa_ms={ttfa if ttfa is None else round(ttfa)} total_ms={round(total)} audio_s={sent / 2 / SR:.2f} "
                f"runaway={int(job.runaway)} text_edited={int(job.text_edited)}")

    def chunk(self, b):
        self.wfile.write(f"{len(b):x}\r\n".encode() + b + b"\r\n")
        self.wfile.flush()


def models_info(core):
    verdicts = {}
    p = os.path.join(HERE, "style_verdicts.json")
    if os.path.isfile(p):
        verdicts = json.load(open(p))
    out = {}
    for k, E in ENGINES.items():
        out[k] = {"supports_clone": True, "streams": E.streams, "slow": E.slow,
                  "tags": sorted(E.native_tags), "styles": sorted(set(E.native_styles) | set(E.native_instruct)),
                  "instructions": E.native_instruct,
                  "styles_by_reference": verdicts.get(k, {}),
                  "approx_memory_gb": E.mem_gb, "needs_transcript": E.needs_text,
                  "takes_context": E.takes_context, "runaway_guard": E.guard,
                  "has_builtin_voice": E.builtin_voice, "loaded": bool(core.engine and core.engine.key == k)}
    return {"default": DEFAULT_MODEL, "models": out}


def limit_mlx_memory():
    """Cap how much freed memory MLX keeps for reuse. Without a cap the server grew to 42 GB over a
    day of model switches and voice preparations, which pushed the whole machine into swap and made
    the job launcher pause the chat model. The cap costs a little speed after a model switch only."""
    try:
        import mlx.core as mx
        cap = int(os.environ.get("LAB_MLX_CACHE_GB", "2")) * 1024 ** 3
        setter = getattr(mx, "set_cache_limit", None) or getattr(getattr(mx, "metal", None), "set_cache_limit", None)
        if setter:
            setter(cap)
        print(f"mlx cache limit set to {cap // 1024 ** 3} GB", flush=True)
    except Exception as error:  # the server still works without the cap
        print(f"mlx cache limit not set: {type(error).__name__}", flush=True)


def main():
    limit_mlx_memory()
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL, choices=list(ENGINES))
    ap.add_argument("--port", type=int, default=9923)
    ap.add_argument("--store", default=os.path.abspath(os.path.join(HERE, "..", "..", "..", "data-scratch", "voices", "voices_store")))
    a = ap.parse_args()
    Handler.core = Core(a.store, a.model)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    srv.daemon_threads = True
    log(f"voice server on 127.0.0.1:{a.port}, model {a.model}, store {a.store}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
