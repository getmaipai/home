import sys, glob, json, os, numpy as np, soundfile as sf
import mlx.core as mx
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import mlx_whisper
texts = {"short": "Dinner is ready, come and wash your hands.",
 "medium": "Today we have a dentist visit at four, then soccer practice. I packed your water bottle in the blue bag, so please do not forget it by the door.",
 "tags": "Oh, that is so funny [laugh] I did not expect that at all."}
import re
norm = lambda t: re.sub(r"[^a-z0-9 ]", "", t.lower().replace("[laugh]", "")).split()
def wer(r, h):
    d = list(range(len(h)+1))
    for i in range(1, len(r)+1):
        p = d[:]; d[0] = i
        for j in range(1, len(h)+1): d[j] = min(p[j]+1, d[j-1]+1, p[j-1]+(r[i-1]!=h[j-1]))
    return d[len(h)] / max(1, len(r))
out = {}
for f in sorted(glob.glob(f"{S}/tts-out/*.wav")):
    k = os.path.basename(f)[:-4]; tk = k.split("-")[-1]
    h = mlx_whisper.transcribe(f, path_or_hf_repo="mlx-community/whisper-large-v3-turbo")["text"]
    out[k] = {"heard": h.strip(), "wer": round(wer(norm(texts[tk]), norm(h)), 2)}
    print(k, out[k], flush=True)
json.dump(out, open(f"{S}/tts-out/judge-wer.json", "w"), indent=1)
