"""Stand-in for a hub video job: repeated heavy GPU steps (large half-precision matrix products, like a diffusion step), run with the lab's voice python.
Usage: python gpuload.py <seconds> <yield:0|1> [step_ms=250]
With yield=1 the job checks the lab's /active flag between steps and pauses while a conversation turn is in flight (cooperative yielding).
Prints steps done and the longest pause it took, so the slowdown the yielding costs the heavy job can be read off."""
import sys, time, json, urllib.request
import mlx.core as mx
secs, yld = float(sys.argv[1]), sys.argv[2] == "1"; step_ms = float(sys.argv[3]) if len(sys.argv) > 3 else 250
n = 4096; a = mx.random.normal((n, n)).astype(mx.float16); b = mx.random.normal((n, n)).astype(mx.float16); mx.eval(a, b)
def active():
    try: return json.load(urllib.request.urlopen("http://127.0.0.1:9931/active", timeout=0.5)).get("active", 0) > 0
    except Exception: return False
def step():
    t = time.time(); c = a
    while (time.time() - t) * 1000 < step_ms: c = mx.matmul(c, b) * 0.001; mx.eval(c)
t0 = time.time(); steps = 0; paused = 0.0; longest = 0.0
while time.time() - t0 < secs:
    if yld and active():
        p0 = time.time()
        while active() and time.time() - p0 < 20: time.sleep(0.02)
        d = time.time() - p0; paused += d; longest = max(longest, d)
    step(); steps += 1
print(json.dumps({"steps": steps, "steps_per_s": round(steps / (time.time() - t0), 2), "paused_s": round(paused, 1), "longest_pause_s": round(longest, 1), "yield": yld}))
