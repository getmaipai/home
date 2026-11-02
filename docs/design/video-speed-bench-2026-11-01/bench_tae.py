import sys, os, time, json, numpy as np
sys.path.insert(0, os.path.expanduser("~/video-bench/engine")); sys.path.insert(0, os.path.expanduser("~/video-bench/drivers"))
import mlx.core as mx, imageio
from taehv_mlx import TAE
from mlx_video.models.wan_2.vae22 import normalize_latents
O = os.path.expanduser("~/video-bench/out"); label = sys.argv[1]
z = normalize_latents(mx.array(np.load(f"{O}/{label}-z.npy")))[0]
ref = np.stack([f for f in imageio.get_reader(f"{O}/{label}.mp4")]).astype(np.float32)
res = []
for name, sup, dt in [("taew2_2", False, mx.float16), ("taew2_2_super", True, mx.float16), ("taew2_2", False, mx.float32)]:
    tae = TAE(os.path.expanduser(f"~/video-bench/models/taehv/{name}.pth"), 48, 2, sup=sup, dtype=dt)
    mx.reset_peak_memory(); t = time.time(); v = tae.decode(z); mx.eval(v); s = time.time() - t
    peak = mx.get_peak_memory() / 1e9
    a = (np.array(v) * 255).round().astype(np.uint8); n = min(len(a), len(ref))
    mse = ((a[:n].astype(np.float32) - ref[:n]) ** 2).mean(axis=(1, 2, 3)); psnr = 10 * np.log10(255 ** 2 / mse)
    tag = f"{label}-{name}-{'fp16' if dt == mx.float16 else 'fp32'}"
    w = imageio.get_writer(f"{O}/{tag}.mp4", fps=24, codec="libx264", quality=8, macro_block_size=16, pixelformat="yuv420p", output_params=["-movflags", "+faststart", "-an"])
    for f in a: w.append_data(f)
    w.close()
    r = dict(tag=tag, decode_s=round(s, 2), peak_gb=round(peak, 1), frames=len(a), ref_frames=len(ref), psnr_mean=round(float(psnr.mean()), 1), psnr_min=round(float(psnr.min()), 1))
    print(json.dumps(r), flush=True); res.append(r)
    from PIL import Image
    for k in (0, 60, 120):
        Image.fromarray(np.concatenate([ref[k].astype(np.uint8), a[k]], axis=1)).save(f"{O}/cmp-{tag}-f{k}.png")
json.dump(res, open(f"{O}/bench_tae.json", "w"), indent=1)
