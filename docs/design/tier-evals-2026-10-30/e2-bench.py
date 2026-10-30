import sys, time, json, os, resource, gc
import numpy as np, soundfile as sf
import mlx.core as mx
from mlx_audio.tts.utils import load_model
label, path = sys.argv[1], sys.argv[2]
ref = sys.argv[3] if len(sys.argv) > 3 else None
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
texts = {
 "short": "Dinner is ready, come and wash your hands.",
 "medium": "Today we have a dentist visit at four, then soccer practice. I packed your water bottle in the blue bag, so please do not forget it by the door.",
 "tags": "Oh, that is so funny [laugh] I did not expect that at all.",
}
res = {"label": label}
rss = lambda: round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9, 2)
t = time.time(); m = load_model(path); res["load_s"] = round(time.time() - t, 2)
res["sr"] = int(getattr(m, "sample_rate", 24000))
mx.reset_peak_memory()
def run(text, ref_audio=None, tag=""):
    t = time.time(); first = None; chunks = []
    kw = dict(text=text, stream=True, streaming_interval=1.0)
    if ref_audio: kw["ref_audio"] = ref_audio
    for r in m.generate(**kw):
        if first is None: first = time.time() - t
        chunks.append(np.array(r.audio).reshape(-1))
    tot = time.time() - t; a = np.concatenate(chunks); dur = len(a) / res["sr"]
    return a, {"ttfa_s": round(first, 2), "total_s": round(tot, 2), "audio_s": round(dur, 2), "rtf": round(tot / dur, 2), "chunks": len(chunks)}
run("Hello there. This is a warm-up.")  # kernel compile; the live engine primes the same way
res["after_prime_peak_gb"] = round(mx.get_peak_memory() / 1e9, 2); res["active_gb"] = round(mx.get_active_memory() / 1e9, 2)
res["runs"] = {}
for k, tx in texts.items():
    a, st = run(tx); sf.write(f"{S}/tts-out/{label}-default-{k}.wav", a, res["sr"]); res["runs"][f"default_{k}"] = st
if ref:
    t = time.time(); m.prepare_conditionals(ref); res["clone_prepare_s"] = round(time.time() - t, 2)
    for k in ("short", "medium"):
        a, st = run(texts[k]); sf.write(f"{S}/tts-out/{label}-clone-{k}.wav", a, res["sr"]); res["runs"][f"clone_{k}"] = st
res["peak_gb"] = round(mx.get_peak_memory() / 1e9, 2); res["process_peak_rss_gb"] = rss()
json.dump(res, open(f"{S}/tts-out/{label}.json", "w"), indent=1); print(json.dumps(res, indent=1))
