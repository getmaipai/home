"""Cuts real non-word sounds (laugh, sigh, breath, cough) out of Expresso speaker ex02 clips (NonverbalTTS annotations mark where
the sound is; the recognizer's word times mark where speech ends). Output: sounds/<voice>/<kind>_<n>.wav (24 kHz mono 16-bit) and
sounds/<voice>/index.json with each clip's level relative to that speaker's speech, so the splice can match the voice's loudness.
Usage: python -I make_sounds.py <raw_dir> <out_dir>"""
import json, sys, os, numpy as np, soundfile as sf
from scipy.signal import resample_poly
raw, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
meta = json.load(open(f"{raw}/clips_meta.json")); asr = json.load(open(f"{raw}/asr.json"))
rms = lambda x: float(np.sqrt(np.mean(x ** 2) + 1e-12))
index = {}; counts = {}
for m in meta:
    a = asr[m["name"]]; ts = a["timestamps"] or []
    x, sr = sf.read(f"{raw}/clips/{m['name']}.wav", dtype="float32"); dur = len(x) / sr
    if m["pos"] == "end": lo, hi = (ts[-1] + 0.30 if ts else 0.0), dur
    else: lo, hi = 0.0, (ts[0] - 0.03 if ts else dur)
    if hi - lo < 0.25: continue
    seg = x[int(lo * sr):int(hi * sr)]
    # trim to the active part: frames above 12% of the segment's loudest 20 ms
    f = int(sr * 0.02); env = np.array([rms(seg[i:i + f]) for i in range(0, len(seg) - f, f)])
    if len(env) < 5 or env.max() < 0.01: continue
    act = np.where(env > env.max() * 0.12)[0]
    s0, s1 = max(0, act[0] * f - int(sr * 0.04)), min(len(seg), (act[-1] + 1) * f + int(sr * 0.06))
    clip = seg[s0:s1]; d = len(clip) / sr
    if d < 0.2 or d > 3.5: continue
    speech = x[int(ts[0] * sr):int(min(dur, ts[-1] + 0.3) * sr)] if ts else None
    ratio = rms(clip) / rms(speech) if speech is not None and len(speech) > sr * 0.2 else None
    clip = clip * np.minimum(1.0, np.linspace(0, 1, int(sr * 0.015) + 1)[:, None].T.ravel()[0] if False else 1.0)
    fade = int(sr * 0.012); clip[:fade] *= np.linspace(0, 1, fade); clip[-fade:] *= np.linspace(1, 0, fade)
    y = resample_poly(clip, 1, int(round(sr / 24000))) if sr != 24000 else clip
    k = m["kind"]; n = counts[k] = counts.get(k, 0) + 1; name = f"{k}_{n}.wav"
    sf.write(f"{out}/{name}", np.clip(y, -1, 1), 24000, subtype="PCM_16")
    index[name] = dict(kind=k, seconds=round(d, 2), level_vs_speech=None if ratio is None else round(ratio, 2), source=m["name"], text=m["text"][:80])
json.dump(index, open(f"{out}/index.json", "w"), indent=1)
print(counts)
for k, v in index.items(): print(k, v["seconds"], v["level_vs_speech"], v["text"][:60])
