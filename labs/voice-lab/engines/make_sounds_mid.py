"""Second pass of make_sounds.py: sounds in the middle of a clip (between two words). Region = from a little after the start of the word
before the tag to a little before the start of the word after it, then trimmed to the loud part. Usage:
python -I make_sounds_mid.py <raw_dir> <out_dir> (raw_dir holds clips2/, clips2_meta.json, asr2.json)"""
import json, sys, os, numpy as np, soundfile as sf
from scipy.signal import resample_poly
raw, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
meta = json.load(open(f"{raw}/clips2_meta.json")); asr = json.load(open(f"{raw}/asr2.json"))
idxp = f"{out}/index.json"; index = json.load(open(idxp)) if os.path.exists(idxp) else {}
counts = {}
for k in index.values(): counts[k["kind"]] = counts.get(k["kind"], 0) + 1
rms = lambda x: float(np.sqrt(np.mean(x ** 2) + 1e-12))
def words(tokens, ts):
    w = []
    for t, s in zip(tokens, ts):
        if t.startswith("▁") or not w: w.append(s)
    return w
added = 0
for m in meta:
    a = asr[m["name"]]; ts = a["timestamps"] or []; ws = words(a["tokens"], ts)
    x, sr = sf.read(f"{raw}/clips2/{m['name']}.wav", dtype="float32"); dur = len(x) / sr
    if not ws: continue
    wb = int(round(m["wb"] * len(ws) / max(1, m["nwords"])))
    if wb <= 0: lo, hi = 0.0, ws[0] - 0.03
    elif wb >= len(ws): lo, hi = ws[-1] + 0.35, dur
    else: lo, hi = ws[wb - 1] + 0.30, ws[wb] - 0.03
    if hi - lo < 0.3: continue
    seg = x[int(lo * sr):int(hi * sr)]; f = int(sr * 0.02)
    env = np.array([rms(seg[i:i + f]) for i in range(0, len(seg) - f, f)])
    if len(env) < 6 or env.max() < 0.01: continue
    act = np.where(env > env.max() * 0.12)[0]
    s0, s1 = max(0, act[0] * f - int(sr * 0.04)), min(len(seg), (act[-1] + 1) * f + int(sr * 0.06))
    clip = seg[s0:s1].copy(); d = len(clip) / sr
    if d < 0.25 or d > 3.0: continue
    speech = x[int(ws[0] * sr):int(min(dur, ts[-1] + 0.3) * sr)]
    ratio = rms(clip) / rms(speech) if len(speech) > sr * 0.2 else None
    fade = int(sr * 0.012); clip[:fade] *= np.linspace(0, 1, fade); clip[-fade:] *= np.linspace(1, 0, fade)
    y = resample_poly(clip, 1, int(round(sr / 24000))) if sr != 24000 else clip
    k = m["kind"]; n = counts[k] = counts.get(k, 0) + 1; name = f"{k}_{n}.wav"
    sf.write(f"{out}/{name}", np.clip(y, -1, 1), 24000, subtype="PCM_16")
    index[name] = dict(kind=k, seconds=round(d, 2), level_vs_speech=None if ratio is None else round(ratio, 2), source=m["name"], text=m["text"][:80], mid=True); added += 1
json.dump(index, open(idxp, "w"), indent=1); print("added", added, counts)
