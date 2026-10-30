import json, subprocess, sys, os, time
E = "/usr/local/maipai-home/stack/data/engines/video-gen/87db56a"; M = "/usr/local/maipai-home/stack/data/models"
S = os.path.dirname(os.path.abspath(__file__)); py = f"{E}/venv/bin/python"
env = dict(os.environ, PYTHONPATH=E, HF_HUB_OFFLINE="1")
p = subprocess.Popen([py, f"{E}/ltx_worker.py"], cwd=E, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(f"{S}/ltx.err", "w"), text=True, env=env)
print(p.stdout.readline().strip(), flush=True)
jobs = [("kitchen", "A ginger cat asleep on a wooden kitchen table beside a bowl of lemons, golden hour light through the window, gentle camera push in", 7),
        ("street", "A rainy neon-lit city street at night, a person with a clear umbrella walks past shop windows, reflections on wet pavement", 8)]
res = []
for name, prompt, seed in jobs:
    req = {"id": name, "prompt": prompt, "width": 768, "height": 448, "num_frames": 49, "seed": seed,
           "model_dir": f"{M}/ltx-2-3-distilled-mlx/LTX-2.3-distilled-MLX", "text_encoder_dir": f"{M}/video-gemma-3-12b-text-encoder/gemma-3-12b-it-bf16-text-encoder",
           "output": f"{S}/out/ltx-bf16-{name}.mp4", "poster": f"{S}/out/ltx-bf16-{name}.jpg", "ffmpeg": f"{M}/../engines/ffmpeg/current/ffmpeg"}
    os.makedirs(f"{S}/out", exist_ok=True)
    t = time.time(); p.stdin.write(json.dumps(req) + "\n"); p.stdin.flush()
    while True:
        l = json.loads(p.stdout.readline())
        if "ok" in l: break
    l["wall_s"] = round(time.time() - t, 1); l["peak_gb"] = round(l.get("peak_bytes", 0) / 1e9, 1); res.append(l); print(l, flush=True)
p.stdin.write('{"op":"quit"}\n'); p.stdin.flush(); p.wait()
json.dump(res, open(f"{S}/out/ltx-bf16.json", "w"), indent=1)
