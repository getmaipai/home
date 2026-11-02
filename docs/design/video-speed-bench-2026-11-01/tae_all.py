import sys, os, time, json, numpy as np
sys.path.insert(0, os.path.expanduser("~/video-bench/engine")); sys.path.insert(0, os.path.expanduser("~/video-bench/drivers"))
import mlx.core as mx, imageio
from taehv_mlx import TAE
from mlx_video.models.wan_2.vae22 import normalize_latents
from PIL import Image
O = os.path.expanduser("~/video-bench/out")
tae = TAE(os.path.expanduser("~/video-bench/models/taehv/taew2_2_super.pth"), 48, 2, sup=True)
for label in sys.argv[1:]:
    z = normalize_latents(mx.array(np.load(f"{O}/{label}-z.npy")))[0]
    t = time.time(); v = tae.decode(z); mx.eval(v); s = time.time() - t
    a = (np.array(v) * 255).round().astype(np.uint8)
    w = imageio.get_writer(f"{O}/{label}-tiny.mp4", fps=24, codec="libx264", quality=8, macro_block_size=16, pixelformat="yuv420p", output_params=["-movflags", "+faststart", "-an"])
    for f in a: w.append_data(f)
    w.close()
    for k in (0, 60, len(a) - 1): Image.fromarray(a[k]).save(f"{O}/{label}-tiny-f{k}.png")
    print(json.dumps(dict(label=label, decode_s=round(s, 2), frames=len(a))), flush=True)
