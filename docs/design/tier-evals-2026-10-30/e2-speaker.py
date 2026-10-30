import glob, os, json, numpy as np, soundfile as sf
from mlx_audio.tts.utils import load_model
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
m = load_model(f"{S}/models/turbo"); ve = m.ve
def emb(f):
    a, sr = sf.read(f, dtype="float32"); a = a if a.ndim == 1 else a.mean(1)
    e = ve.embeds_from_wavs([a], sample_rate=sr, as_spk=True); e = np.asarray(e).reshape(-1); return e / np.linalg.norm(e)
r = emb(f"{S}/ref/samantha.wav"); out = {}
for f in sorted(glob.glob(f"{S}/tts-out/*.wav")):
    k = os.path.basename(f)[:-4]; out[k] = round(float(np.dot(r, emb(f))), 3); print(k, out[k])
json.dump(out, open(f"{S}/tts-out/spk-cos.json", "w"), indent=1)
