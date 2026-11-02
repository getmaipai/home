# Wan 5B bench harness (scratch engine copy, no engine edits). Usage: bench_wan.py <label> <model_dir> <steps-mode: fast|std> <frames> <seed> [save_latent]
import sys, os, json, time
E = os.path.expanduser("~/video-bench/engine"); sys.path.insert(0, E)
os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
import mlx.core as mx
import video_worker as vw
label, model_dir, mode, frames, seed = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
save_lat = len(sys.argv) > 6
OUT = os.path.expanduser("~/video-bench/out")
M = "/usr/local/maipai-home/stack/data/models"
prompt = "A ginger cat asleep on a wooden kitchen table beside a bowl of lemons, golden hour light through the window, gentle camera push in"
import mlx_video.models.wan_2.scheduler as _sch
_orig_sched = _sch.FlowUniPCScheduler
gen = vw._install_patches()
if mode == 'std': _sch.FlowUniPCScheduler = _orig_sched
T = {}
import mlx_video.models.wan_2.generate as g
orig_load = g.load_vae_decoder
def load2(*a, **k):
    d = orig_load(*a, **k)
    od = d.decode_tiled
    def dt(z, *aa, **kk):
        if save_lat:
            import numpy as np; mx.eval(z); np.save(f"{OUT}/{label}-z.npy", np.array(z.astype(mx.float32)))
        if os.environ.get("SKIPDEC"):
            import numpy as np; mx.eval(z); np.save(f"{OUT}/{label}-z.npy", np.array(z.astype(mx.float32)))
            T["decode_s"] = 0.0; T["decode_skipped"] = True
            return mx.zeros((1, (z.shape[1] - 1) * 4 + 1, z.shape[2] * 16, z.shape[3] * 16, 3))
        t = time.time(); r = od(z, *aa, **kk); mx.eval(r); T["decode_s"] = round(time.time() - t, 1); return r
    d.decode_tiled = dt
    return d
g.load_vae_decoder = load2
vw._current.update(id=label, tokenizer_dir=f"{M}/video-umt5-tokenizer/umt5-xxl-tokenizer", poster=f"{OUT}/{label}.jpg", preview=None)
cfg = json.load(open(f"{model_dir}/config.json"))
steps = 20 if mode == "std" else 3
if mode == "fast":
    vw._current["dmd_sigmas"] = cfg["fastwan_dmd"]["sigmas"]
mx.reset_peak_memory()
import io; sink = vw._Sink(); vw.emit = lambda o: None
t0 = time.time(); old = sys.stdout; sys.stdout = sink
try:
    gen.generate_video(model_dir=model_dir, prompt=prompt, negative_prompt="", image=None, width=832, height=480, num_frames=frames,
        steps=(len(cfg["fastwan_dmd"]["sigmas"]) - 1) if mode == "fast" else 20, guide_scale=1.0 if mode == "fast" else 5.0, seed=seed,
        output_path=f"{OUT}/{label}.mp4", scheduler="unipc", loras=None, tiling="aggressive")
finally:
    sys.stdout = old
r = dict(label=label, mode=mode, frames=frames, seed=seed, total_s=round(time.time() - t0, 1), peak_gb=round(mx.get_peak_memory() / 1e9, 1), **T)
print(json.dumps(r)); open(f"{OUT}/results.jsonl", "a").write(json.dumps(r) + "\n")
