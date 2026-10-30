import json, subprocess, sys, os, time
label, ck, lm, py = sys.argv[1:5]
S = os.path.dirname(os.path.abspath(__file__))
songs = [
 {"id": "lofi", "caption": "calm lofi hip hop, soft piano, vinyl crackle, slow drums, warm bass", "lyrics": "", "instrumental": True, "duration_s": 40, "seed": 11},
 {"id": "pop", "caption": "upbeat pop song, female vocal, bright guitar, steady drums", "lyrics": "[Verse]\nWe walk home slow in the evening light\nThe porch lamp glows and the stars come out\n[Chorus]\nSing it loud, we are home tonight\nSing it loud, nothing to worry about", "instrumental": False, "language": "en", "duration_s": 40, "seed": 12, "lrc": False},
 {"id": "folk", "caption": "gentle acoustic folk ballad, male vocal, fingerpicked guitar, soft strings", "lyrics": "[Verse]\nThe river runs down past the old stone mill\nI carry your name and I carry it still\n[Chorus]\nLead me home, lead me home\nThrough the fields where the soft winds roam", "instrumental": False, "language": "en", "duration_s": 40, "seed": 13, "lrc": False},
]
env = dict(os.environ, MUSIC_WORKER_DEBUG="1")
p = subprocess.Popen([py, f"{S}/worker.py"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(f"{S}/{label}.err", "w"), text=True, env=env)
print(p.stdout.readline().strip(), flush=True)
res = []
for sg in songs:
    out = f"{S}/out/{label}-{sg['id']}.m4a"
    req = dict(sg, task="text2music", output=out, ckpt_dir=ck, lm=lm, ffmpeg="/usr/local/maipai-home/stack/data/engines/ffmpeg/current/ffmpeg", cache_gb=2, workdir=S)
    t = time.time(); p.stdin.write(json.dumps(req) + "\n"); p.stdin.flush()
    while True:
        l = json.loads(p.stdout.readline())
        if "ok" in l: break
    l["wall_s"] = round(time.time() - t, 1); l["peak_gb"] = round(l.get("peak_bytes", 0) / 1e9, 2); res.append((sg["id"], l)); print(sg["id"], l, flush=True)
p.stdin.write('{"op":"quit"}\n'); p.stdin.flush(); p.wait()
json.dump(res, open(f"{S}/out/{label}.json", "w"), indent=1)
