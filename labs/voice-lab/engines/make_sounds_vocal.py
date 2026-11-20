"""Stand-in sounds for kinds the speaker's own recordings do not give cleanly (laugh, cough, throat clear): isolated clips from the open
VocalSound corpus (female volunteers, one sound per clip). Picks the cleanest few by signal-to-noise and length.
Usage: python -I make_sounds_vocal.py <vocalsound.parquet> <out_dir>"""
import sys, io, json, os, numpy as np, soundfile as sf, pyarrow.parquet as pq
from scipy.signal import resample_poly
src, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
KIND = {"Laughter": ("laugh", 0.7, 2.4, 6), "Cough": ("cough", 0.3, 1.5, 4), "Throat clearing": ("throat", 0.3, 1.5, 4)}
idxp = f"{out}/index.json"; index = json.load(open(idxp)) if os.path.exists(idxp) else {}
rms = lambda x: float(np.sqrt(np.mean(x ** 2) + 1e-12))
pf = pq.ParquetFile(src); cands = {k: [] for k in KIND}
for g in range(pf.metadata.num_row_groups):
    for r in pf.read_row_group(g).to_pylist():
        if r["answer"] not in KIND or not r["spk_id"].startswith("f") or r["age_group"] not in (1, 2, 3): continue
        x, sr = sf.read(io.BytesIO(r["audio"]["bytes"]), dtype="float32")
        if x.ndim > 1: x = x.mean(1)
        f = int(sr * 0.02); env = np.array([rms(x[i:i + f]) for i in range(0, len(x) - f, f)])
        if len(env) < 10: continue
        act = np.where(env > env.max() * 0.15)[0]; s0, s1 = max(0, act[0] * f - int(sr * 0.03)), min(len(x), (act[-1] + 1) * f + int(sr * 0.05))
        clip = x[s0:s1]; d = len(clip) / sr; kind, lo, hi, _ = KIND[r["answer"]]
        if d < lo or d > hi or env.max() < 0.03: continue
        floor = np.percentile(env, 10); snr = 20 * np.log10(env.max() / max(floor, 1e-5))
        cands[r["answer"]].append((snr, r["spk_id"], clip, sr, d))
for ans, (kind, lo, hi, take) in KIND.items():
    best = sorted(cands[ans], key=lambda c: -c[0])[:take]; seen = set(); n = 0
    for snr, spk, clip, sr, d in best:
        if spk in seen: continue
        seen.add(spk); n += 1; clip = clip.copy(); fade = int(sr * 0.012); clip[:fade] *= np.linspace(0, 1, fade); clip[-fade:] *= np.linspace(1, 0, fade)
        y = resample_poly(clip, 3, 2) if sr == 16000 else resample_poly(clip, 24000, sr)
        k = "cough" if kind == "throat" else kind; name = f"{kind}_v{n}.wav"
        sf.write(f"{out}/{name}", np.clip(y * (0.3 / max(1e-6, np.abs(y).max())), -1, 1), 24000, subtype="PCM_16")
        index[name] = dict(kind=kind, seconds=round(d, 2), level_vs_speech=0.8, source=f"VocalSound {spk}", speaker="other", use=True, snr_db=round(float(snr), 1))
json.dump(index, open(idxp, "w"), indent=1); print({k: sum(1 for v in index.values() if v["kind"] == k) for k in set(v["kind"] for v in index.values())})
