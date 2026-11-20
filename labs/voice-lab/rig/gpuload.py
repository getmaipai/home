"""Stand-in for a hub video job: repeated heavy GPU steps (large half-precision matrix products, like a diffusion step), run with the lab's voice python.
Usage: python gpuload.py <seconds> <yield:0|1> [step_ms=250]
With yield=1 the job calls rig/yield/wait_if_talking.py between steps (the lab's turn-in-flight lease): it pauses while a conversation turn is in flight, at most 8 s per step (cooperative yielding).
Prints steps done and the longest pause it took, so the slowdown the yielding costs the heavy job can be read off."""
import sys, os, time, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "yield"))
from wait_if_talking import wait_if_talking
import mlx.core as mx
secs, yld = float(sys.argv[1]), sys.argv[2] == "1"; step_ms = float(sys.argv[3]) if len(sys.argv) > 3 else 250
n = 4096; a = mx.random.normal((n, n)).astype(mx.float16); b = mx.random.normal((n, n)).astype(mx.float16); mx.eval(a, b)
def step():
    t = time.time(); c = a
    while (time.time() - t) * 1000 < step_ms: c = mx.matmul(c, b) * 0.001; mx.eval(c)
t0 = time.time(); steps = 0; paused = 0.0; longest = 0.0
while time.time() - t0 < secs:
    if yld:
        r = wait_if_talking(max_wait=8.0)
        if r["waited_ms"] > 0: d = r["waited_ms"] / 1000; paused += d; longest = max(longest, d)
    step(); steps += 1
print(json.dumps({"steps": steps, "steps_per_s": round(steps / (time.time() - t0), 2), "paused_s": round(paused, 1), "longest_pause_s": round(longest, 1), "yield": yld}))
