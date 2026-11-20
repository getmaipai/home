#!/usr/bin/env python3
"""Cooperative yield for a heavy GPU job. Call between steps: returns at once when no conversation turn is in flight, otherwise waits until the lease clears or max_wait seconds pass.
Standard library only. Library: from wait_if_talking import wait_if_talking; r = wait_if_talking(); r == {"waited_ms": int, "reason": "none"|"clear"|"timeout"}.
Command line: wait_if_talking.py [--file PATH] [--max-wait 8] [--poll 0.1] [--log PATH]  (prints one line: waited_ms=N reason=R; also appended to --log).
The lease is the lab's data-scratch/turn-in-flight.json: {"inFlight": bool, "expires_at_ms": int}. A missing, unreadable or expired lease means nobody is talking."""
import json, os, sys, time
DEFAULT_FILE = os.environ.get("TURN_LEASE_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../../data-scratch/turn-in-flight.json"))
def _holds(path):
    try:
        s = json.load(open(path))
        return s.get("inFlight") is True and int(s.get("expires_at_ms", 0)) > time.time() * 1000
    except Exception:
        return False
def wait_if_talking(path=DEFAULT_FILE, max_wait=8.0, poll=0.1, log=None):
    t0 = time.time(); reason = "none"
    if _holds(path):
        reason = "timeout"
        mark = os.environ.get("HELPER_STARTED_FILE")  # tests: signals "I am now waiting" so they never race the interpreter start-up
        if mark: open(mark, "w").write("1")
        while time.time() - t0 < max_wait:
            time.sleep(poll)
            if not _holds(path): reason = "clear"; break
    ms = int((time.time() - t0) * 1000); r = {"waited_ms": ms, "reason": reason}
    if log and reason != "none":
        try: open(log, "a").write(json.dumps({"at_ms": int(time.time() * 1000), **r}) + "\n")
        except Exception: pass
    return r
if __name__ == "__main__":
    a = sys.argv[1:]; g = lambda k, d: a[a.index(k) + 1] if k in a else d
    r = wait_if_talking(g("--file", DEFAULT_FILE), float(g("--max-wait", "8")), float(g("--poll", "0.1")), g("--log", None))
    print(f"waited_ms={r['waited_ms']} reason={r['reason']}")
