# usage: bench_ltx.py <label> <model_dir> [quant_file_dir]   runs kitchen+street, 121 frames, 768x448, seed 7/8
import sys, os, json, time
E = os.path.expanduser("~/video-bench/engine"); sys.path.insert(0, E)
os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
import mlx.core as mx, mlx.nn as nn
label, model_dir = sys.argv[1], sys.argv[2]
OUT = os.path.expanduser("~/video-bench/out"); M = "/usr/local/maipai-home/stack/data/models"
import video_worker as vw
EV = []
def rec(o): EV.append((time.time(), o))
vw.emit = rec
import ltx_worker as lw
from mlx_video.models.ltx_2.ltx_2 import LTXModel
from mlx_video.utils import apply_quantization
from pathlib import Path
import json as _j
orig_fp = LTXModel.from_pretrained.__func__
def fp(cls, model_path, strict=True):
    model_path = Path(model_path); files = list(model_path.glob("*.safetensors"))
    w = {}
    for f in files: w.update(mx.load(str(f)))
    if not any(k.startswith("transformer.") for k in w) and not any(k.endswith(".scales") for k in w):
        return orig_fp(cls, model_path, strict)
    w = {(k[len("transformer."):] if k.startswith("transformer.") else k): v for k, v in w.items()}
    cfg = LTXModel.__init__.__globals__["LTXModelConfig"](**_j.load(open(model_path / "config.json")))
    m = cls(cfg)
    k = "transformer_blocks.0.attn1.to_q"; inf = w[k + ".weight"].shape[1] * 32 // 0 if False else None
    wq = w[k + ".weight"]; sc = w[k + ".scales"]; out_f = wq.shape[0]
    # in_features = group * scales.shape[1]; bits = 32 * wq.shape[1] / in_features; group in {32,64,128}
    inf_ = 4096; nb = 32 * wq.shape[1] // inf_; group = inf_ // sc.shape[1]
    print("detected quant", group, nb, flush=True)
    nn.quantize(m, group_size=group, bits=nb, class_predicate=lambda p, mod: hasattr(mod, "to_quantized") and f"{p}.scales" in w)
    w = {kk: (v.astype(mx.bfloat16) if v.dtype == mx.float32 else v) for kk, v in w.items()}
    m.load_weights(list(w.items()), strict=False); mx.eval(m.parameters()); m.eval(); return m
LTXModel.from_pretrained = classmethod(fp)
jobs = [("kitchen", "A ginger cat asleep on a wooden kitchen table beside a bowl of lemons, golden hour light through the window, gentle camera push in", 7),
        ("street", "A rainy neon-lit city street at night, a person with a clear umbrella walks past shop windows, reflections on wet pavement", 8)]
res = []
for name, prompt, seed in jobs:
    EV.clear()
    req = {"id": name, "prompt": prompt, "width": 768, "height": 448, "num_frames": 121, "seed": seed, "model_dir": model_dir,
           "text_encoder_dir": f"{M}/video-gemma-3-12b-text-encoder/gemma-3-12b-it-bf16-text-encoder",
           "output": f"{OUT}/ltx-{label}-{name}.mp4", "poster": f"{OUT}/ltx-{label}-{name}.jpg", "ffmpeg": f"{M}/../engines/ffmpeg/current/ffmpeg"}
    t = time.time(); r = lw.generate(req); wall = time.time() - t
    ts = [(round(x - t, 1), o.get("stage"), o.get("n"), o.get("of")) for x, o in EV if o.get("event") == "stage"]
    first = {}
    for x, s, n, of in ts: first.setdefault(s, x)
    # motion steps: time of step 8 start (index n==8) approximates stage-2 start
    m = [(x, n) for x, s, n, of in ts if s == "motion"]
    out = dict(label=label, clip=name, wall_s=round(wall, 1), peak_gb=round(r["peak_bytes"] / 1e9, 1), stages_first_s=first, motion=m)
    print(json.dumps(out), flush=True); res.append(out)
    open(f"{OUT}/ltx-results.jsonl", "a").write(json.dumps(out) + "\n")
