import glob, os, re, json, mlx_whisper
S = os.path.dirname(os.path.abspath(__file__))
L = {"pop": "We walk home slow in the evening light The porch lamp glows and the stars come out Sing it loud we are home tonight Sing it loud nothing to worry about",
     "folk": "The river runs down past the old stone mill I carry your name and I carry it still Lead me home lead me home Through the fields where the soft winds roam"}
n = lambda t: re.sub(r"[^a-z' ]", "", t.lower()).split()
def wer(r, h):
    d = list(range(len(h)+1))
    for i in range(1, len(r)+1):
        p = d[:]; d[0] = i
        for j in range(1, len(h)+1): d[j] = min(p[j]+1, d[j-1]+1, p[j-1]+(r[i-1]!=h[j-1]))
    return d[len(h)]/len(r)
out = {}
for f in sorted(glob.glob(f"{S}/out/*-pop.m4a")+glob.glob(f"{S}/out/*-folk.m4a")):
    k = os.path.basename(f)[:-4]; t = mlx_whisper.transcribe(f, path_or_hf_repo="mlx-community/whisper-large-v3-turbo", language="en")["text"]
    out[k] = {"heard": t.strip(), "wer": round(wer(n(L[k.split("-")[-1]]), n(t)), 2)}; print(k, out[k], flush=True)
json.dump(out, open(f"{S}/out/sung-check.json", "w"), indent=1)
