import sys, time, json, os, resource, numpy as np, soundfile as sf, torch
from demucs.pretrained import get_model
from demucs.apply import apply_model
S = os.path.dirname(os.path.abspath(__file__))
name = sys.argv[1]; dev = sys.argv[2] if len(sys.argv) > 2 else "mps"
t = time.time(); m = get_model(name); m.eval(); load = round(time.time() - t, 1)
res = {"model": name, "device": dev, "load_s": load, "sources": m.sources, "songs": {}}
for song in ("pop", "folk", "lofi"):
    a, sr = sf.read(f"{S}/in/{song}.wav", dtype="float32"); x = torch.from_numpy(a.T)[None]
    ref = x.mean(1, keepdim=True)
    t = time.time()
    with torch.no_grad(): y = apply_model(m, x, device=dev, shifts=1, split=True, overlap=0.25, progress=False)[0]
    el = round(time.time() - t, 1)
    en = (y ** 2).mean(dim=(1, 2)).numpy(); tot = float(en.sum()) or 1e-9
    recon = float(((y.sum(0) - x[0]) ** 2).mean() / ((x[0] ** 2).mean() + 1e-12))
    os.makedirs(f"{S}/out/{name}", exist_ok=True)
    for i, s in enumerate(m.sources): sf.write(f"{S}/out/{name}/{song}-{s}.wav", y[i].numpy().T, sr)
    res["songs"][song] = {"seconds": el, "audio_s": round(a.shape[0] / sr, 1), "energy_share": {s: round(float(en[i]) / tot, 3) for i, s in enumerate(m.sources)}, "recon_err": round(recon, 5)}
    print(name, song, res["songs"][song], flush=True)
res["peak_rss_gb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9, 2)
json.dump(res, open(f"{S}/out/{name}.json", "w"), indent=1); print(name, "peak_rss_gb", res["peak_rss_gb"])
